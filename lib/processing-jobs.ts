import { createAdminClient } from '@/lib/supabase/server';

export type JobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'worker_died'
  | 'cancelled'
  | 'timed_out';

export type JobType = 'unified_analysis' | 'process_video' | 'step_analysis';

export interface ProcessingJob {
  id: string;
  job_id: string;
  runpod_job_id: string | null;
  user_id: string;
  video_id: string;
  job_type: JobType;
  job_params: Record<string, unknown>;
  status: JobStatus;
  current_step: string | null;
  progress: number;
  retry_count: number;
  max_retries: number;
  parent_job_id: string | null;
  last_error: string | null;
  error_details: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  last_checked_at: string | null;
  webhook_url: string | null;
  webhook_received: boolean;
}

/**
 * Create a new processing job record
 */
export async function createProcessingJob({
  jobId,
  runpodJobId,
  userId,
  videoId,
  jobType,
  jobParams,
  webhookUrl,
  parentJobId,
}: {
  jobId: string;
  runpodJobId?: string;
  userId: string;
  videoId: string;
  jobType: JobType;
  jobParams: Record<string, unknown>;
  webhookUrl?: string;
  parentJobId?: string;
}): Promise<ProcessingJob | null> {
  // Use admin client to bypass RLS for server-side operations
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('processing_jobs')
    .insert({
      job_id: jobId,
      runpod_job_id: runpodJobId || null,
      user_id: userId,
      video_id: videoId,
      job_type: jobType,
      job_params: jobParams,
      status: 'queued',
      webhook_url: webhookUrl || null,
      parent_job_id: parentJobId || null,
    })
    .select()
    .single();

  if (error) {
    console.error('❌ Error creating processing job:', error);
    console.error('   Job ID:', jobId);
    console.error('   User ID:', userId);
    console.error('   Video ID:', videoId);
    console.error('   Error details:', JSON.stringify(error, null, 2));
    return null;
  }

  console.log('✅ Processing job created successfully:', jobId);
  return data;
}

/**
 * Update processing job status
 */
export async function updateJobStatus({
  jobId,
  status,
  runpodJobId,
  currentStep,
  progress,
  error,
  errorDetails,
}: {
  jobId: string;
  status?: JobStatus;
  runpodJobId?: string;
  currentStep?: string;
  progress?: number;
  error?: string;
  errorDetails?: Record<string, unknown>;
}): Promise<ProcessingJob | null> {
  // Use admin client to bypass RLS for server-side operations
  const supabase = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updates: Record<string, any> = {
    last_checked_at: new Date().toISOString(),
  };

  if (status) {
    updates.status = status;
    if (status === 'running' && !updates.started_at) {
      updates.started_at = new Date().toISOString();
    }
    if (['completed', 'failed', 'worker_died', 'cancelled', 'timed_out'].includes(status)) {
      updates.completed_at = new Date().toISOString();
    }
  }

  if (runpodJobId) updates.runpod_job_id = runpodJobId;
  if (currentStep !== undefined) updates.current_step = currentStep;
  if (progress !== undefined) updates.progress = progress;
  if (error !== undefined) updates.last_error = error;
  if (errorDetails !== undefined) updates.error_details = errorDetails;

  const { data, error: updateError } = await supabase
    .from('processing_jobs')
    .update(updates)
    .eq('job_id', jobId)
    .select()
    .single();

  if (updateError) {
    console.error('Error updating processing job:', updateError);
    return null;
  }

  return data;
}

/**
 * Get processing job by job_id
 */
export async function getProcessingJob(jobId: string): Promise<ProcessingJob | null> {
  // Use admin client to bypass RLS for server-side operations
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('processing_jobs')
    .select('*')
    .eq('job_id', jobId)
    .single();

  if (error) {
    console.error('Error fetching processing job:', error);
    return null;
  }

  return data;
}

/**
 * Get processing jobs for a user and video
 */
export async function getProcessingJobsForVideo(
  userId: string,
  videoId: string
): Promise<ProcessingJob[]> {
  // Use admin client to bypass RLS for server-side operations
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('processing_jobs')
    .select('*')
    .eq('user_id', userId)
    .eq('video_id', videoId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching processing jobs:', error);
    return [];
  }

  return data || [];
}

/**
 * Get the latest processing job for a video
 */
export async function getLatestProcessingJob(
  userId: string,
  videoId: string
): Promise<ProcessingJob | null> {
  const jobs = await getProcessingJobsForVideo(userId, videoId);
  return jobs.length > 0 ? jobs[0] : null;
}

/**
 * Increment retry count
 */
export async function incrementRetryCount(jobId: string): Promise<ProcessingJob | null> {
  // Use admin client to bypass RLS for server-side operations
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('increment_job_retry_count', {
    job_id_param: jobId,
  });

  if (error) {
    // Fallback to manual increment if RPC doesn't exist
    const job = await getProcessingJob(jobId);
    if (!job) return null;

    return updateJobStatus({
      jobId,
      status: 'queued', // Reset to queued for retry
    });
  }

  return data;
}

/**
 * Check if job can be retried
 */
export async function canRetryJob(jobId: string): Promise<boolean> {
  const job = await getProcessingJob(jobId);
  if (!job) return false;

  return (
    job.retry_count < job.max_retries &&
    ['failed', 'worker_died', 'timed_out'].includes(job.status)
  );
}

/**
 * Mark webhook as received
 */
export async function markWebhookReceived(jobId: string): Promise<void> {
  // Use admin client to bypass RLS for server-side operations
  const supabase = createAdminClient();

  await supabase
    .from('processing_jobs')
    .update({ webhook_received: true })
    .eq('job_id', jobId);
}
