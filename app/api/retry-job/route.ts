import { NextRequest, NextResponse } from 'next/server';
import { getProcessingJob } from '@/lib/processing-jobs';
import { logJobInfo, logSuccess, logError } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/retry-job
 *
 * User-triggered retry for stuck/failed jobs
 * This is simpler than /api/retry-analysis - it just re-triggers the existing job
 *
 * Request body: { jobId: string }
 *
 * Use cases:
 * - Job stuck in "queued" status
 * - Job failed and user wants to retry
 * - Immediate trigger didn't work
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

    logJobInfo({ 'User retry requested': jobId });

    // Get the job
    const job = await getProcessingJob(jobId);

    if (!job) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }

    // Check if job is in a retriable state
    const retriableStates = ['queued', 'failed', 'worker_died', 'timed_out'];

    if (!retriableStates.includes(job.status)) {
      return NextResponse.json(
        {
          error: 'Job cannot be retried',
          reason: `Job is currently ${job.status}`,
          currentStatus: job.status
        },
        { status: 400 }
      );
    }

    // Already has a runpod_job_id and just stuck? Check RunPod status first
    if (job.runpod_job_id && job.status === 'queued') {
      logJobInfo({
        'Checking RunPod status first': jobId,
        runpodJobId: job.runpod_job_id
      });

      return NextResponse.json({
        success: true,
        message: 'Job already has RunPod ID, check status first',
        jobId,
        runpodJobId: job.runpod_job_id,
        suggestion: 'Poll /api/runpod-status to check actual status'
      });
    }

    // Trigger the job
    const triggerUrl = process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/api/trigger-pending-jobs`
      : `${request.headers.get('origin') || 'http://localhost:3000'}/api/trigger-pending-jobs`;

    logJobInfo({
      'Triggering job': jobId,
      triggerUrl
    });

    const triggerResponse = await fetch(triggerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'MintonixUserRetry/1.0'
      },
      body: JSON.stringify({ jobId })
    });

    if (!triggerResponse.ok) {
      const errorText = await triggerResponse.text();
      logError('Failed to trigger job', {
        jobId,
        status: triggerResponse.status,
        error: errorText
      });

      return NextResponse.json(
        {
          error: 'Failed to trigger job',
          details: errorText,
          status: triggerResponse.status
        },
        { status: triggerResponse.status }
      );
    }

    const triggerData = await triggerResponse.json();

    logSuccess('User retry successful', {
      jobId,
      runpodJobId: triggerData.runpodJobId
    });

    return NextResponse.json({
      success: true,
      message: 'Job retry triggered successfully',
      jobId,
      runpodJobId: triggerData.runpodJobId,
      status: triggerData.status
    });

  } catch (error) {
    logError('Job retry failed', error);
    return NextResponse.json(
      {
        error: 'Failed to retry job',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
