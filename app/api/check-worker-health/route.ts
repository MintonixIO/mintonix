import { NextRequest, NextResponse } from 'next/server';
import { checkRunPodWorkerHealth } from '@/lib/runpod-health';
import { checkAnalysisProgress } from '@/lib/r2';
import { logError, logDebug } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/check-worker-health?runpodJobId=xxx&userId=xxx&videoId=xxx
 *
 * Real-time health check that:
 * 1. Checks R2 for output files (to determine progress)
 * 2. Checks RunPod API for worker status (to detect worker death)
 *
 * Note: Job recording/retry tracking handled by Python backend
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

    logDebug('Checking worker health', { runpodJobId, userId, videoId });

    // Check R2 files for progress
    let r2Progress;
    try {
      r2Progress = await checkAnalysisProgress(userId, videoId);
      const allComplete =
        r2Progress.calibration &&
        r2Progress.poseEstimation &&
        r2Progress.shuttleTracking &&
        r2Progress.positionCorrection &&
        r2Progress.visualization;

      // If all files exist, job is complete - no need to check RunPod
      if (allComplete) {
        return NextResponse.json({
          runpodJobId,
          status: 'completed',
          runpodStatus: 'COMPLETED',
          isAlive: false,
          workerDied: false,
          filesExist: true,
          recommendation: 'success',
          message: 'Analysis completed successfully',
          canRetry: false,
          retryCount: 0,
          maxRetries: 3,
          r2Progress,
        });
      }
    } catch (error) {
      logError('Failed to check R2 files', error);
      r2Progress = {
        calibration: false,
        poseEstimation: false,
        shuttleTracking: false,
        positionCorrection: false,
        visualization: false,
      };
    }

    // Check RunPod worker health
    const workerHealth = await checkRunPodWorkerHealth(runpodJobId);

    logDebug('Worker health result', {
      runpodJobId,
      runpodStatus: workerHealth.runpodStatus,
      isAlive: workerHealth.isAlive,
      workerDied: workerHealth.workerDied,
    });

    // Determine recommendation based on RunPod + R2 status
    let recommendation: 'wait' | 'retry' | 'success' | 'failed';
    let message: string;

    if (workerHealth.isAlive) {
      // Worker is still running
      recommendation = 'wait';
      message = `Worker is still processing (${workerHealth.runpodStatus})`;
    } else if (workerHealth.completedSuccessfully && r2Progress.visualization) {
      // Worker completed and files exist
      recommendation = 'success';
      message = 'Analysis completed successfully';
    } else if (workerHealth.workerDied || workerHealth.runpodStatus === 'FAILED') {
      // Worker died or failed
      recommendation = 'retry';
      message = workerHealth.errorMessage || 'Worker died - contact support or try uploading again';
    } else {
      // Unknown state or permanent failure
      recommendation = 'failed';
      message = workerHealth.errorMessage || 'Job failed';
    }

    return NextResponse.json({
      runpodJobId,
      status: workerHealth.workerDied ? 'worker_died' : 'running',
      runpodStatus: workerHealth.runpodStatus,
      isAlive: workerHealth.isAlive,
      workerDied: workerHealth.workerDied,
      filesExist: r2Progress.visualization || false,
      recommendation,
      message,
      errorMessage: workerHealth.errorMessage,
      r2Progress,
      details: {
        workerHealth,
      },
    });
  } catch (error: unknown) {
    logError('Worker health check failed', error);
    return NextResponse.json(
      {
        error: 'Failed to check worker health',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
