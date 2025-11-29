/**
 * Analysis Progress Tracking with SSE and Polling Fallback
 * Connects to Server-Sent Events for real-time progress updates from RunPod webhooks
 * Falls back to polling if SSE connection fails
 */

export interface ProgressUpdate {
  step?: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress?: number;
  stage?: string;
  error?: string;
  results?: Record<string, unknown>;
}

export type ProgressCallback = (update: ProgressUpdate) => void;

/**
 * Start analysis job and track progress via SSE with polling fallback
 */
export async function trackAnalysisProgress(
  jobId: string,
  onProgress: ProgressCallback,
  options: {
    useSSE?: boolean;
    pollingInterval?: number;
    timeout?: number;
  } = {}
): Promise<void> {
  const {
    useSSE = true,
    pollingInterval = 3000,
    timeout = 1200000 // 20 minutes
  } = options;

  // Try SSE first if enabled
  if (useSSE) {
    try {
      console.log(`📡 Attempting SSE connection for job ${jobId}`);
      await trackViaSSE(jobId, onProgress, timeout);
      return; // SSE succeeded
    } catch (error) {
      console.warn(`⚠️ SSE failed, falling back to polling:`, error);
    }
  }

  // Fallback to polling
  console.log(`🔄 Using polling for job ${jobId}`);
  await trackViaPolling(jobId, onProgress, pollingInterval, timeout);
}

/**
 * Track progress via Server-Sent Events
 */
async function trackViaSSE(
  jobId: string,
  onProgress: ProgressCallback,
  timeout: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const eventSource = new EventSource(`/api/events/${jobId}`);

    // Set timeout
    const timeoutId = setTimeout(() => {
      eventSource.close();
      reject(new Error('SSE connection timed out'));
    }, timeout);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Ignore connection messages
        if (data.type === 'connected') {
          console.log(`📡 SSE connected for job ${jobId}`);
          return;
        }

        // Call progress callback
        onProgress(data);

        // Close on completion or failure
        if (data.status === 'completed' || data.status === 'failed') {
          clearTimeout(timeoutId);
          eventSource.close();
          resolve();
        }
      } catch (error) {
        console.error('Error parsing SSE message:', error);
      }
    };

    eventSource.onerror = (error) => {
      clearTimeout(timeoutId);
      eventSource.close();
      reject(error);
    };
  });
}

/**
 * Track progress via polling
 */
async function trackViaPolling(
  jobId: string,
  onProgress: ProgressCallback,
  interval: number,
  timeout: number
): Promise<void> {
  const startTime = Date.now();

  while (true) {
    // Check timeout
    if (Date.now() - startTime > timeout) {
      throw new Error('Polling timed out');
    }

    try {
      // Poll status endpoint
      const response = await fetch(`/api/analysis-job-status?jobId=${jobId}`);

      if (!response.ok) {
        throw new Error(`Polling failed: ${response.status}`);
      }

      const data = await response.json();

      // Call progress callback
      onProgress({
        step: data.currentStep,
        status: data.status as ProgressUpdate['status'],
        progress: data.progress,
        stage: data.currentStage,
        error: data.error,
        results: data.output
      });

      // Stop polling on completion or failure
      if (data.status === 'completed' || data.status === 'failed') {
        return;
      }

    } catch (error) {
      console.error('Polling error:', error);
      // Continue polling even on errors
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}

/**
 * Start unified analysis and track progress
 */
export async function startUnifiedAnalysis(
  userId: string,
  videoId: string,
  onProgress: ProgressCallback,
  options?: {
    useSSE?: boolean;
    pollingInterval?: number;
  }
): Promise<Record<string, unknown>> {
  // Start the job
  const response = await fetch('/api/analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, videoId })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
  }

  const result = await response.json();
  const jobId = result.jobId;

  if (!jobId) {
    throw new Error('No job ID returned from analysis API');
  }

  console.log(`🚀 Analysis job started: ${jobId}`);

  // Track progress
  await trackAnalysisProgress(jobId, onProgress, options);

  return result;
}
