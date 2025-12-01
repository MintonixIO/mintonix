import { NextRequest, NextResponse } from 'next/server';
import { getProcessingJob, updateJobStatus } from '@/lib/processing-jobs';
import { getSignedVideoUrl } from '@/lib/r2';
import { logJobInfo, logSuccess, logError } from '@/lib/logger';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 60; // 1 minute - just for triggering RunPod

/**
 * POST /api/trigger-pending-jobs
 *
 * Triggers a specific pending job by ID
 * Called immediately after upload or by cron for retry
 */
export async function POST(request: NextRequest) {
  try {
    const { jobId } = await request.json();

    if (!jobId) {
      return NextResponse.json(
        { error: 'Missing jobId' },
        { status: 400 }
      );
    }

    logJobInfo({ 'Processing job': jobId });

    // Get the pending job
    const job = await getProcessingJob(jobId);

    if (!job) {
      logError('Job not found', { jobId });
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }

    // Skip if already triggered
    if (job.status !== 'queued' || job.runpod_job_id) {
      logSuccess('Job already triggered', {
        jobId,
        status: job.status,
        runpodJobId: job.runpod_job_id
      });
      return NextResponse.json({
        success: true,
        message: 'Job already processed',
        status: job.status,
        runpodJobId: job.runpod_job_id
      });
    }

    const runpodEndpoint = process.env.RUNPOD_ENDPOINT_ID;
    const runpodApiKey = process.env.RUNPOD_API_KEY;

    if (!runpodEndpoint || !runpodApiKey) {
      const error = 'RunPod configuration missing (RUNPOD_ENDPOINT_ID or RUNPOD_API_KEY)';
      logError(error);

      await updateJobStatus({
        jobId: jobId,
        status: 'failed',
        error,
        errorDetails: { error_type: 'missing_config' }
      });

      return NextResponse.json(
        { error },
        { status: 503 }
      );
    }

    // Get signed video URL from job params
    const r2Key = job.job_params.r2_key as string;

    if (!r2Key) {
      const error = 'Missing r2_key in job params';
      logError(error, { jobId });

      await updateJobStatus({
        jobId: jobId,
        status: 'failed',
        error,
        errorDetails: { error_type: 'invalid_job_params' }
      });

      return NextResponse.json(
        { error },
        { status: 400 }
      );
    }

    const signedVideoUrl = await getSignedVideoUrl(r2Key);

    logJobInfo({
      'Triggering RunPod': jobId,
      userId: job.user_id,
      videoId: job.video_id,
      r2Key
    });

    // Trigger RunPod with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    try {
      const runpodResponse = await fetch(
        `https://api.runpod.ai/v2/${runpodEndpoint}/run`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${runpodApiKey}`,
          },
          body: JSON.stringify({
            input: {
              video_url: signedVideoUrl,
              user_id: job.user_id,
              video_id: job.video_id,
              job_id: jobId
            }
          }),
          signal: controller.signal
        }
      );

      clearTimeout(timeout);

      if (!runpodResponse.ok) {
        const errorText = await runpodResponse.text();
        const errorMessage = `RunPod API error: ${runpodResponse.status} - ${errorText}`;

        logError(errorMessage, {
          jobId,
          status: runpodResponse.status,
          response: errorText
        });

        throw new Error(errorMessage);
      }

      const runpodData = await runpodResponse.json();
      const runpodJobId = runpodData.id;

      if (!runpodJobId) {
        throw new Error('RunPod response missing job ID');
      }

      // Update job with RunPod job ID
      await updateJobStatus({
        jobId: jobId,
        runpodJobId: runpodJobId,
        status: 'running',
        currentStep: 'submitted_to_runpod'
      });

      logSuccess('RunPod job triggered successfully', {
        jobId,
        runpodJobId,
        videoId: job.video_id,
        userId: job.user_id
      });

      return NextResponse.json({
        success: true,
        jobId,
        runpodJobId,
        status: 'running',
        message: 'Job successfully submitted to RunPod'
      });

    } catch (fetchError) {
      clearTimeout(timeout);

      // Determine if this is a timeout or other error
      const isTimeout = fetchError instanceof Error && fetchError.name === 'AbortError';
      const errorMessage = isTimeout
        ? 'RunPod API request timeout (30s)'
        : fetchError instanceof Error ? fetchError.message : 'Unknown error';

      // Mark job as failed for retry
      await updateJobStatus({
        jobId: jobId,
        status: 'failed',
        error: errorMessage,
        errorDetails: {
          error_type: isTimeout ? 'timeout' : 'runpod_api_error',
          timestamp: new Date().toISOString(),
          retry_count: job.retry_count
        }
      });

      logError('Failed to trigger RunPod', {
        jobId,
        error: errorMessage,
        isTimeout
      });

      throw fetchError;
    }

  } catch (error) {
    logError('Job trigger failed', error);
    return NextResponse.json(
      {
        error: 'Failed to trigger job',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/trigger-pending-jobs
 *
 * Processes ALL pending jobs (called by Vercel cron)
 * Safe to call repeatedly - idempotent
 */
export async function GET() {
  try {
    logJobInfo({ 'Cron job': 'Processing pending jobs' });

    const supabase = await createClient();

    // Get all pending jobs (queued and no runpod_job_id)
    const { data: pendingJobs, error } = await supabase
      .from('processing_jobs')
      .select('*')
      .eq('status', 'queued')
      .is('runpod_job_id', null)
      .order('created_at', { ascending: true })
      .limit(10); // Process up to 10 at a time

    if (error) {
      logError('Failed to fetch pending jobs', error);
      throw error;
    }

    if (!pendingJobs || pendingJobs.length === 0) {
      logSuccess('No pending jobs to process');
      return NextResponse.json({
        success: true,
        message: 'No pending jobs',
        processed: 0
      });
    }

    logSuccess(`Found ${pendingJobs.length} pending job(s) to process`);

    // Trigger each job
    const triggerUrl = process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/api/trigger-pending-jobs`
      : 'http://localhost:3000/api/trigger-pending-jobs';

    const results = await Promise.allSettled(
      pendingJobs.map(async (job) => {
        try {
          const response = await fetch(triggerUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'MintonixCronJob/1.0'
            },
            body: JSON.stringify({ jobId: job.job_id })
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to trigger job ${job.job_id}: ${response.status} - ${errorText}`);
          }

          const data = await response.json();
          logSuccess('Job triggered by cron', { jobId: job.job_id, runpodJobId: data.runpodJobId });

          return { jobId: job.job_id, success: true };
        } catch (err) {
          logError('Cron failed to trigger job', { jobId: job.job_id, error: err });
          throw err;
        }
      })
    );

    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    logJobInfo({
      'Cron completed': `${succeeded}/${pendingJobs.length} jobs triggered`,
      succeeded,
      failed
    });

    return NextResponse.json({
      success: true,
      total: pendingJobs.length,
      succeeded,
      failed,
      results: results.map((r, i) => ({
        jobId: pendingJobs[i].job_id,
        status: r.status,
        error: r.status === 'rejected' ? r.reason?.message : undefined
      }))
    });

  } catch (error) {
    logError('Failed to process pending jobs', error);
    return NextResponse.json(
      {
        error: 'Failed to process pending jobs',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
