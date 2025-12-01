-- Add "uploading" status to videos table to track in-progress uploads
-- This enables tracking of uploads that are in progress but not yet complete

-- Drop existing constraint if it exists
ALTER TABLE public.videos
  DROP CONSTRAINT IF EXISTS videos_status_check;

-- Add new constraint with "uploading" status
ALTER TABLE public.videos
  ADD CONSTRAINT videos_status_check CHECK (status IN (
    'uploading',   -- Upload in progress (direct-to-R2 upload)
    'uploaded',    -- Upload complete, not yet processed
    'processing',  -- Currently being analyzed
    'completed',   -- Analysis finished successfully
    'failed',      -- Analysis failed
    'archived',    -- User archived it
    'deleted'      -- Soft deleted
  ));

-- Add comment to document the status field
COMMENT ON COLUMN public.videos.status IS
  'Current video processing status. uploading = upload in progress, uploaded = upload complete but not analyzed, processing = being analyzed, completed = analysis finished, failed = analysis failed, archived = user archived, deleted = soft deleted';
