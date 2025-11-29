/**
 * Logging utilities for clean, organized console output
 */

const ENABLE_DEBUG = process.env.NODE_ENV === 'development';

/**
 * Format a job/video/user ID block for logging
 */
export function logJobInfo(data: {
  jobId?: string;
  runpodJobId?: string;
  userId?: string;
  videoId?: string;
  status?: string;
  retryCount?: number;
  [key: string]: string | number | boolean | undefined;
}) {
  const lines: string[] = [];

  lines.push('┌─────────────────────────────────────────');

  if (data.jobId) lines.push(`│ Job ID:        ${data.jobId}`);
  if (data.runpodJobId) lines.push(`│ RunPod Job:    ${data.runpodJobId}`);
  if (data.userId) lines.push(`│ User ID:       ${data.userId}`);
  if (data.videoId) lines.push(`│ Video ID:      ${data.videoId}`);
  if (data.status) lines.push(`│ Status:        ${data.status}`);
  if (data.retryCount !== undefined) lines.push(`│ Retry Count:   ${data.retryCount}`);

  // Add any other custom fields
  Object.keys(data).forEach(key => {
    if (!['jobId', 'runpodJobId', 'userId', 'videoId', 'status', 'retryCount'].includes(key)) {
      const value = data[key];
      const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
      lines.push(`│ ${label.padEnd(14)} ${value}`);
    }
  });

  lines.push('└─────────────────────────────────────────');

  console.log(lines.join('\n'));
}

/**
 * Log a section header
 */
export function logSection(title: string) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`  ${title}`);
  console.log('='.repeat(50));
}

/**
 * Log a success message
 */
export function logSuccess(message: string, data?: Record<string, unknown>) {
  console.log(`✅ ${message}`);
  if (data && ENABLE_DEBUG) {
    console.log(data);
  }
}

/**
 * Log an error message
 */
export function logError(message: string, error?: unknown) {
  console.error(`❌ ${message}`);
  if (error) {
    if (error instanceof Error) {
      console.error(`   ${error.message}`);
      if (ENABLE_DEBUG && error.stack) {
        console.error(error.stack);
      }
    } else {
      console.error(error);
    }
  }
}

/**
 * Log a warning message
 */
export function logWarn(message: string, data?: unknown) {
  console.warn(`⚠️  ${message}`);
  if (data && ENABLE_DEBUG) {
    console.warn(data);
  }
}

/**
 * Log an info message (only in debug mode)
 */
export function logDebug(message: string, data?: unknown) {
  if (ENABLE_DEBUG) {
    console.log(`ℹ️  ${message}`);
    if (data) {
      console.log(data);
    }
  }
}

/**
 * Log API request details
 */
export function logApiRequest(method: string, endpoint: string, params?: Record<string, unknown>) {
  if (!ENABLE_DEBUG) return;

  console.log(`\n📨 ${method} ${endpoint}`);
  if (params && Object.keys(params).length > 0) {
    console.log('   Parameters:', params);
  }
}

/**
 * Log API response
 */
export function logApiResponse(status: number, data?: unknown) {
  if (!ENABLE_DEBUG) return;

  const icon = status >= 200 && status < 300 ? '✅' : '❌';
  console.log(`${icon} Response ${status}`);
  if (data) {
    console.log('   Data:', data);
  }
}

/**
 * Create a minimal progress logger
 */
export function createProgressLogger(operation: string) {
  const startTime = Date.now();

  return {
    log(message: string) {
      if (ENABLE_DEBUG) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`   [${elapsed}s] ${message}`);
      }
    },
    complete(message?: string) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      logSuccess(`${operation} completed in ${duration}s${message ? ': ' + message : ''}`);
    },
    error(message: string, error?: unknown) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      logError(`${operation} failed after ${duration}s: ${message}`, error);
    }
  };
}
