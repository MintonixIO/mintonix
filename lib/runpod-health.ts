/**
 * RunPod Worker Health Check Utilities
 *
 * These functions help determine if a RunPod worker is:
 * - Still running
 * - Completed successfully
 * - Failed/timed out
 * - Died unexpectedly
 */

export interface RunPodJobStatus {
  id: string;
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT';
  output?: Record<string, unknown>;
  error?: string;
  executionTime?: number;
  delayTime?: number;
  stream?: Array<{ timestamp: string; output: string }>;
}

export interface WorkerHealthResult {
  isAlive: boolean;
  runpodStatus: RunPodJobStatus['status'] | 'NOT_FOUND';
  hasOutput: boolean;
  completedSuccessfully: boolean;
  workerDied: boolean;
  shouldRetry: boolean;
  errorMessage?: string;
  details?: RunPodJobStatus;
}

/**
 * Check RunPod worker health by querying the job status
 */
export async function checkRunPodWorkerHealth(
  runpodJobId: string
): Promise<WorkerHealthResult> {
  const endpointId = process.env.RUNPOD_ENDPOINT_ID;
  const apiKey = process.env.RUNPOD_API_KEY;

  if (!endpointId || !apiKey) {
    return {
      isAlive: false,
      runpodStatus: 'NOT_FOUND',
      hasOutput: false,
      completedSuccessfully: false,
      workerDied: false,
      shouldRetry: false,
      errorMessage: 'RunPod configuration missing',
    };
  }

  try {
    // Query RunPod status API
    const statusUrl = `https://api.runpod.ai/v2/${endpointId}/status/${runpodJobId}`;

    const response = await fetch(statusUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        // Job not found - either expired or never existed
        return {
          isAlive: false,
          runpodStatus: 'NOT_FOUND',
          hasOutput: false,
          completedSuccessfully: false,
          workerDied: true,
          shouldRetry: true,
          errorMessage: 'Job not found in RunPod (may have expired)',
        };
      }

      throw new Error(`RunPod API error: ${response.status}`);
    }

    const data = await response.json();
    const jobStatus: RunPodJobStatus = data;

    // Analyze the job status
    const result = analyzeWorkerHealth(jobStatus);

    return result;
  } catch (error: unknown) {
    console.error('Error checking RunPod worker health:', error);
    return {
      isAlive: false,
      runpodStatus: 'NOT_FOUND',
      hasOutput: false,
      completedSuccessfully: false,
      workerDied: false,
      shouldRetry: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Analyze RunPod job status to determine worker health
 */
function analyzeWorkerHealth(jobStatus: RunPodJobStatus): WorkerHealthResult {
  const status = jobStatus.status;
  const hasOutput = !!(jobStatus.output && Object.keys(jobStatus.output).length > 0);

  switch (status) {
    case 'IN_QUEUE':
    case 'IN_PROGRESS':
      // Worker is still alive and working
      return {
        isAlive: true,
        runpodStatus: status,
        hasOutput: false,
        completedSuccessfully: false,
        workerDied: false,
        shouldRetry: false,
        details: jobStatus,
      };

    case 'COMPLETED':
      if (hasOutput) {
        // Worker completed successfully with output
        return {
          isAlive: false,
          runpodStatus: status,
          hasOutput: true,
          completedSuccessfully: true,
          workerDied: false,
          shouldRetry: false,
          details: jobStatus,
        };
      } else {
        // Worker completed but no output - may have died during final steps
        return {
          isAlive: false,
          runpodStatus: status,
          hasOutput: false,
          completedSuccessfully: false,
          workerDied: true,
          shouldRetry: true,
          errorMessage: 'Job completed but no output received (worker may have died)',
          details: jobStatus,
        };
      }

    case 'FAILED':
      // Worker failed - should retry
      return {
        isAlive: false,
        runpodStatus: status,
        hasOutput: hasOutput,
        completedSuccessfully: false,
        workerDied: true,
        shouldRetry: true,
        errorMessage: jobStatus.error || 'Job failed',
        details: jobStatus,
      };

    case 'TIMED_OUT':
      // Worker timed out - should retry
      return {
        isAlive: false,
        runpodStatus: status,
        hasOutput: hasOutput,
        completedSuccessfully: false,
        workerDied: true,
        shouldRetry: true,
        errorMessage: 'Job timed out',
        details: jobStatus,
      };

    case 'CANCELLED':
      // Job was cancelled - don't retry
      return {
        isAlive: false,
        runpodStatus: status,
        hasOutput: false,
        completedSuccessfully: false,
        workerDied: false,
        shouldRetry: false,
        errorMessage: 'Job was cancelled',
        details: jobStatus,
      };

    default:
      // Unknown status
      return {
        isAlive: false,
        runpodStatus: 'NOT_FOUND',
        hasOutput: false,
        completedSuccessfully: false,
        workerDied: false,
        shouldRetry: false,
        errorMessage: `Unknown status: ${status}`,
        details: jobStatus,
      };
  }
}

/**
 * Check if R2 files exist for a given video analysis
 */
export async function checkR2FilesExist(
  userId: string,
  videoId: string,
  requiredFiles: string[] = ['calibration.csv', 'pose.json', 'shuttle.json', 'analyzed_video.mp4']
): Promise<{ exists: boolean; foundFiles: string[]; missingFiles: string[] }> {
  try {
    const response = await fetch(
      `/api/check-analysis-progress?userId=${userId}&videoId=${videoId}`
    );

    if (!response.ok) {
      return { exists: false, foundFiles: [], missingFiles: requiredFiles };
    }

    const data = await response.json();

    const foundFiles: string[] = [];
    const missingFiles: string[] = [];

    // Map the response to file existence
    const fileChecks: Record<string, boolean> = {
      'calibration.csv': data.progress.calibration,
      'pose.json': data.progress.pose,
      'shuttle.json': data.progress.shuttle,
      'corrected_positions.json': data.progress.positions,
      'analyzed_video.mp4': data.progress.visualization,
    };

    for (const file of requiredFiles) {
      if (fileChecks[file]) {
        foundFiles.push(file);
      } else {
        missingFiles.push(file);
      }
    }

    return {
      exists: missingFiles.length === 0,
      foundFiles,
      missingFiles,
    };
  } catch (error) {
    console.error('Error checking R2 files:', error);
    return { exists: false, foundFiles: [], missingFiles: requiredFiles };
  }
}
