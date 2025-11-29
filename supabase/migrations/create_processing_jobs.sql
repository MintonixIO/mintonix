-- Create processing_jobs table to track RunPod job status and retries
CREATE TABLE IF NOT EXISTS processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id TEXT NOT NULL UNIQUE, -- Our internal job ID
  runpod_job_id TEXT, -- RunPod's job ID (may be null initially)
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL, -- R2 video ID (no FK constraint since videos are in R2)

  -- Job configuration
  job_type TEXT NOT NULL, -- 'unified_analysis', 'process_video', 'step_analysis'
  job_params JSONB, -- Store original job parameters for retry

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'queued',
    -- Possible values: 'queued', 'running', 'completed', 'failed', 'worker_died', 'cancelled', 'timed_out'
  current_step TEXT, -- Current processing step
  progress INTEGER DEFAULT 0, -- 0-100

  -- Retry management
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  parent_job_id TEXT, -- Reference to original job if this is a retry

  -- Error tracking
  last_error TEXT,
  error_details JSONB,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,

  -- Webhook tracking
  webhook_url TEXT,
  webhook_received BOOLEAN DEFAULT FALSE
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_processing_jobs_user_id ON processing_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_video_id ON processing_jobs(video_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_job_id ON processing_jobs(job_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_runpod_job_id ON processing_jobs(runpod_job_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_status ON processing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_created_at ON processing_jobs(created_at DESC);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_processing_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER processing_jobs_updated_at
  BEFORE UPDATE ON processing_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_processing_jobs_updated_at();

-- Enable RLS
ALTER TABLE processing_jobs ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can view their own jobs
CREATE POLICY "Users can view own processing jobs"
  ON processing_jobs
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own jobs
CREATE POLICY "Users can create own processing jobs"
  ON processing_jobs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own jobs
CREATE POLICY "Users can update own processing jobs"
  ON processing_jobs
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own jobs
CREATE POLICY "Users can delete own processing jobs"
  ON processing_jobs
  FOR DELETE
  USING (auth.uid() = user_id);

-- Comment: Videos are stored in R2, not in database
-- Video metadata would need to be fetched from R2 separately if needed
