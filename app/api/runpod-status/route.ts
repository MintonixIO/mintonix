import { NextRequest, NextResponse } from 'next/server';
import { updateJobStatus, getProcessingJob } from '@/lib/processing-jobs';
import { logError, logJobInfo } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 30; // 30 seconds

/**
 * GET /api/runpod-status?runpodJobId={id}&jobId={id}
 *
 * Polls RunPod for job status and updates our database
 * Called by frontend every few seconds until job completes
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const runpodJobId = searchParams.get('runpodJobId');
    const jobId = searchParams.get('jobId');

    if (!runpodJobId && !jobId) {
      return NextResponse.json(
        { error: 'Missing runpodJobId or jobId parameter' },
        { status: 400 }
      );
    }

    const runpodEndpoint = process.env.RUNPOD_ENDPOINT_ID;
    const runpodApiKey = process.env.RUNPOD_API_KEY;

    if (!runpodEndpoint || !runpodApiKey) {
      return NextResponse.json(
        { error: 'RunPod not configured' },
        { status: 503 }
      );
    }

    // If we have jobId, get the runpodJobId from database
    let actualRunpodJobId = runpodJobId;
    let ourJob = null;

    if (jobId) {
      ourJob = await getProcessingJob(jobId);
      if (!ourJob) {
        return NextResponse.json(
          { error: 'Job not found' },
          { status: 404 }
        );
      }
      actualRunpodJobId = ourJob.runpod_job_id;
    }

    if (!actualRunpodJobId) {
      return NextResponse.json(
        {
          error: 'Job not yet submitted to RunPod',
          status: 'queued',
          message: 'Job is pending, will be triggered shortly'
        },
        { status: 202 }
      );
    }

    // Poll RunPod status API
    const statusUrl = `https://api.runpod.ai/v2/${runpodEndpoint}/status/${actualRunpodJobId}`;

    const response = await fetch(statusUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${runpodApiKey}`,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        // Job not found in RunPod (may have expired)
        if (jobId && ourJob) {
          await updateJobStatus({
            jobId,
            status: 'failed',
            error: 'Job not found in RunPod (may have expired)',
            errorDetails: {
              error_type: 'job_not_found',
              runpod_status: 404
            }
          });
        }

        return NextResponse.json({
          status: 'FAILED',
          error: 'Job not found in RunPod',
          runpodJobId: actualRunpodJobId
        });
      }

      throw new Error(`RunPod API error: ${response.status}`);
    }

    const data = await response.json();
    const runpodStatus = data.status; // IN_QUEUE, IN_PROGRESS, COMPLETED, FAILED, CANCELLED, TIMED_OUT

    // Map RunPod status to our status
    let ourStatus: 'queued' | 'running' | 'completed' | 'failed' | 'worker_died' | 'cancelled' | 'timed_out' = 'running';
    let shouldUpdate = false;

    switch (runpodStatus) {
      case 'IN_QUEUE':
        ourStatus = 'queued';
        shouldUpdate = true;
        break;
      case 'IN_PROGRESS':
        ourStatus = 'running';
        shouldUpdate = true;
        break;
      case 'COMPLETED':
        ourStatus = 'completed';
        shouldUpdate = true;
        break;
      case 'FAILED':
        ourStatus = 'failed';
        shouldUpdate = true;
        break;
      case 'TIMED_OUT':
        ourStatus = 'timed_out';
        shouldUpdate = true;
        break;
      case 'CANCELLED':
        ourStatus = 'cancelled';
        shouldUpdate = true;
        break;
    }

    // Update our database if status changed
    if (jobId && shouldUpdate && ourJob && ourJob.status !== ourStatus) {
      await updateJobStatus({
        jobId,
        status: ourStatus,
        error: data.error || undefined,
        errorDetails: runpodStatus === 'FAILED' || runpodStatus === 'TIMED_OUT'
          ? { runpod_status: runpodStatus, runpod_error: data.error }
          : undefined
      });

      logJobInfo({
        'Status updated': jobId,
        oldStatus: ourJob.status,
        newStatus: ourStatus,
        runpodStatus
      });
    }

    // Return comprehensive status
    return NextResponse.json({
      success: true,
      runpodJobId: actualRunpodJobId,
      jobId: jobId || undefined,
      runpodStatus,
      status: ourStatus,
      output: data.output || undefined,
      error: data.error || undefined,
      executionTime: data.executionTime || undefined,
      delayTime: data.delayTime || undefined,
      isComplete: ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'].includes(runpodStatus),
      isFailed: ['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(runpodStatus)
    });

  } catch (error) {
    logError('RunPod status check failed', error);
    return NextResponse.json(
      {
        error: 'Failed to check RunPod status',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
