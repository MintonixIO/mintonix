import { NextRequest, NextResponse } from 'next/server';
import { checkRunPodWorkerHealth } from '@/lib/runpod-health';
import { checkAnalysisProgress } from '@/lib/r2';
import { logError, logDebug } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Unified job status endpoint
 *
 * GET /api/job-status?runpodJobId=xxx&userId=xxx&videoId=xxx
 *
 * Returns:
 * - Progress based on R2 file availability
 * - Worker health from RunPod API
 * - Recommendation: 'processing' | 'completed' | 'retry'
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const runpodJobId = searchParams.get('runpodJobId');
    const userId = searchParams.get('userId');
    const videoId = searchParams.get('videoId');

    if (!runpodJobId || !userId || !videoId) {
      return NextResponse.json(
        { error: 'Missing required parameters: runpodJobId, userId, videoId' },
        { status: 400 }
      );
    }

    logDebug('Checking job status', { runpodJobId, userId, videoId });

    // Check R2 files for progress
    const progress = await checkAnalysisProgress(userId, videoId);

    // If all files exist, job is complete
    if (progress.allComplete) {
      return NextResponse.json({
        runpodJobId,
        progress,
        recommendation: 'completed',
        message: 'Analysis completed successfully',
        workerAlive: false,
        workerDied: false,
      });
    }

    // Check RunPod worker health
    const workerHealth = await checkRunPodWorkerHealth(runpodJobId);

    logDebug('Worker health result', {
      runpodJobId,
      status: workerHealth.runpodStatus,
      isAlive: workerHealth.isAlive,
      workerDied: workerHealth.workerDied,
    });

    // Determine recommendation
    let recommendation: 'processing' | 'completed' | 'retry';
    let message: string;

    if (workerHealth.isAlive) {
      // Worker is still running
      recommendation = 'processing';
      message = `Worker is processing (${workerHealth.runpodStatus})`;
    } else if (workerHealth.workerDied) {
      // Worker died - recommend retry
      recommendation = 'retry';
      message = workerHealth.errorMessage || 'Worker died - please retry';
    } else if (workerHealth.completedSuccessfully) {
      // Worker completed but files might still be uploading
      recommendation = 'processing';
      message = 'Worker completed, finalizing output files';
    } else {
      // Worker stopped but not in a "died" state (e.g., CANCELLED)
      recommendation = 'retry';
      message = workerHealth.errorMessage || 'Job stopped unexpectedly';
    }

    return NextResponse.json({
      runpodJobId,
      progress,
      recommendation,
      message,
      workerAlive: workerHealth.isAlive,
      workerDied: workerHealth.workerDied,
      runpodStatus: workerHealth.runpodStatus,
      errorMessage: workerHealth.errorMessage,
    });

  } catch (error: unknown) {
    logError('Job status check failed', error);
    return NextResponse.json(
      {
        error: 'Failed to check job status',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
