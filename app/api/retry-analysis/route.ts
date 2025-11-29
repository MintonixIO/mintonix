import { NextRequest, NextResponse } from 'next/server';
import { getProcessingJob, canRetryJob, updateJobStatus } from '@/lib/processing-jobs';
import { getSignedVideoUrl, getUserVideos } from '@/lib/r2';
import { logJobInfo, logSuccess, logError } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 60; // 1 minute timeout (just for job submission)

/**
 * POST /api/retry-analysis
 *
 * Retry a failed processing job
 * Request body: { jobId: string }
 *
 * This endpoint will:
 * 1. Verify the job can be retried (retry_count < max_retries)
 * 2. Get the original job parameters
 * 3. Submit a new job to RunPod
 * 4. Create a new processing_jobs record with incremented retry_count
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { jobId } = body;

    if (!jobId) {
      return NextResponse.json(
        { error: 'Missing required field: jobId' },
        { status: 400 }
      );
    }

    // Get the original job
    const originalJob = await getProcessingJob(jobId);

    if (!originalJob) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }

    // Check if job can be retried
    const canRetry = await canRetryJob(jobId);

    if (!canRetry) {
      return NextResponse.json(
        {
          error: 'Job cannot be retried',
          reason: originalJob.retry_count >= originalJob.max_retries
            ? `Maximum retries (${originalJob.max_retries}) exceeded`
            : 'Job status does not allow retry',
          retryCount: originalJob.retry_count,
          maxRetries: originalJob.max_retries,
          status: originalJob.status,
        },
        { status: 400 }
      );
    }

    // Get job parameters
    const userId = originalJob.user_id;
    const videoId = originalJob.video_id;

    logJobInfo({
      'Retry Attempt': `${originalJob.retry_count + 1}/${originalJob.max_retries}`,
      jobId,
      userId,
      videoId,
      'Original Status': originalJob.status,
    });

    // Find the video file
    const videos = await getUserVideos(userId);
    const video = videos.find(v => v.videoId === videoId);

    if (!video) {
      return NextResponse.json(
        { error: `Video not found for ID: ${videoId}` },
        { status: 404 }
      );
    }

    // Get signed video URL for RunPod service
    const signedVideoUrl = await getSignedVideoUrl(video.key);

    // Call RunPod service based on job type
    const runpodEndpoint = process.env.RUNPOD_ENDPOINT_ID;
    const runpodApiKey = process.env.RUNPOD_API_KEY;

    if (!runpodEndpoint || !runpodApiKey) {
      throw new Error('RunPod configuration missing. Please set RUNPOD_ENDPOINT_ID and RUNPOD_API_KEY environment variables.');
    }

    // Construct webhook URL
    const webhookUrl = process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/api/webhook`
      : `${request.headers.get('origin') || 'http://localhost:3000'}/api/webhook`;

    // Generate new job ID for the retry
    const newJobId = `${originalJob.video_id}-retry-${originalJob.retry_count + 1}-${Date.now()}`;

    // Submit job to RunPod (Python will create the Supabase record)
    let runpodResponse;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout for submission

      runpodResponse = await fetch(`https://api.runpod.ai/v2/${runpodEndpoint}/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${runpodApiKey}`,
        },
        body: JSON.stringify({
          input: {
            video_url: signedVideoUrl,
            user_id: userId,
            session_id: videoId,
            webhook_url: webhookUrl,
            job_id: newJobId, // Pass our job ID to Python
            retry_attempt: originalJob.retry_count + 1,
            parent_job_id: jobId, // Link to original job
          }
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!runpodResponse.ok) {
        const errorText = await runpodResponse.text();
        logError('RunPod API request failed', {
          status: runpodResponse.status,
          statusText: runpodResponse.statusText,
          response: errorText,
        });

        throw new Error(`RunPod API error: ${runpodResponse.status} ${runpodResponse.statusText}`);
      }
    } catch (error) {
      logError('Failed to submit retry to RunPod', error);

      // Update original job with error
      await updateJobStatus({
        jobId,
        error: error instanceof Error ? error.message : 'Failed to submit retry',
        errorDetails: { retry_attempt: originalJob.retry_count + 1 },
      });

      throw error;
    }

    const runpodData = await runpodResponse.json();
    const runpodJobId = runpodData.id;

    console.log('✅ Retry job submitted to RunPod:', { newJobId, runpodJobId });
    console.log('📝 Note: Python worker will create Supabase record with retry info');

    // Mark original job as superseded
    await updateJobStatus({
      jobId,
      status: 'cancelled',
      error: `Superseded by retry job: ${newJobId}`,
    });

    logSuccess('Job retry submitted successfully');
    logJobInfo({
      'Original Job': jobId,
      'New Job ID': newJobId,
      runpodJobId,
      userId,
      videoId,
      'Retry Attempt': `${originalJob.retry_count + 1}/${originalJob.max_retries}`,
    });

    return NextResponse.json({
      success: true,
      message: `Job retry submitted (attempt ${originalJob.retry_count + 1}/${originalJob.max_retries})`,
      originalJobId: jobId,
      newJobId,
      runpodJobId,
      retryAttempt: originalJob.retry_count + 1,
      maxRetries: originalJob.max_retries,
      webhookUrl,
    });

  } catch (error: unknown) {
    logError('Job retry failed', error);
    return NextResponse.json(
      {
        error: 'Failed to retry job',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
