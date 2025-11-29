/**
 * Webhook Store - In-memory storage for job updates and SSE connections
 * For production, consider using Redis for multi-instance deployments
 */

export interface JobUpdate {
  step?: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress?: number;
  stage?: string;
  error?: string;
  timestamp: number;
  results?: Record<string, unknown>;
}

export type SSEListener = (data: JobUpdate) => void;

class WebhookStore {
  private jobUpdates: Map<string, JobUpdate[]> = new Map();
  private eventEmitters: Map<string, Set<SSEListener>> = new Map();

  /**
   * Store a job update from webhook
   */
  addUpdate(jobId: string, update: Omit<JobUpdate, 'timestamp'>): void {
    if (!this.jobUpdates.has(jobId)) {
      this.jobUpdates.set(jobId, []);
    }

    const fullUpdate: JobUpdate = {
      ...update,
      timestamp: Date.now()
    };

    this.jobUpdates.get(jobId)!.push(fullUpdate);

    // Notify all SSE listeners
    this.notifyListeners(jobId, fullUpdate);

    // Cleanup completed jobs after 1 hour
    if (update.status === 'completed' || update.status === 'failed') {
      setTimeout(() => {
        this.cleanup(jobId);
      }, 60 * 60 * 1000);
    }
  }

  /**
   * Get all updates for a job
   */
  getUpdates(jobId: string): JobUpdate[] {
    return this.jobUpdates.get(jobId) || [];
  }

  /**
   * Get the latest update for a job
   */
  getLatestUpdate(jobId: string): JobUpdate | null {
    const updates = this.getUpdates(jobId);
    return updates.length > 0 ? updates[updates.length - 1] : null;
  }

  /**
   * Register an SSE listener for a job
   */
  addListener(jobId: string, listener: SSEListener): void {
    if (!this.eventEmitters.has(jobId)) {
      this.eventEmitters.set(jobId, new Set());
    }
    this.eventEmitters.get(jobId)!.add(listener);
  }

  /**
   * Remove an SSE listener
   */
  removeListener(jobId: string, listener: SSEListener): void {
    const listeners = this.eventEmitters.get(jobId);
    if (listeners) {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.eventEmitters.delete(jobId);
      }
    }
  }

  /**
   * Notify all listeners for a job
   */
  private notifyListeners(jobId: string, update: JobUpdate): void {
    const listeners = this.eventEmitters.get(jobId);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(update);
        } catch (error) {
          console.error(`Error notifying listener for job ${jobId}:`, error);
        }
      });
    }
  }

  /**
   * Cleanup old job data
   */
  private cleanup(jobId: string): void {
    this.jobUpdates.delete(jobId);
    this.eventEmitters.delete(jobId);
    console.log(`🧹 Cleaned up job data for ${jobId}`);
  }

  /**
   * Get count of active listeners
   */
  getListenerCount(jobId: string): number {
    return this.eventEmitters.get(jobId)?.size || 0;
  }

  /**
   * Get all active job IDs
   */
  getActiveJobs(): string[] {
    return Array.from(this.jobUpdates.keys());
  }
}

// Singleton instance
export const webhookStore = new WebhookStore();
