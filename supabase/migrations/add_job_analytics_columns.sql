-- Add comprehensive analytics columns to processing_jobs table
-- These store detailed metrics, timings, and resource usage for job analytics

-- Worker specifications
ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS worker_specs JSONB;
COMMENT ON COLUMN processing_jobs.worker_specs IS 'GPU type, memory, CPU specs, region, etc.';

-- Input video parameters
ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS input_params JSONB;
COMMENT ON COLUMN processing_jobs.input_params IS 'Video metadata: size, fps, resolution, codec, etc.';

-- Detailed step-by-step metrics
ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS step_metrics JSONB;
COMMENT ON COLUMN processing_jobs.step_metrics IS 'Timing, throughput, and output for each pipeline step';

-- Output file summary
ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS output_summary JSONB;
COMMENT ON COLUMN processing_jobs.output_summary IS 'Files created, sizes, R2 paths, upload stats';

-- Resource usage during execution
ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS resource_usage JSONB;
COMMENT ON COLUMN processing_jobs.resource_usage IS 'Peak GPU/RAM usage, CPU utilization, disk I/O';

-- Billing and cost tracking
ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS billing JSONB;
COMMENT ON COLUMN processing_jobs.billing IS 'Compute time, GPU hours, estimated cost';

-- Quality metrics for ML models
ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS quality_metrics JSONB;
COMMENT ON COLUMN processing_jobs.quality_metrics IS 'Detection confidence, accuracy, coverage stats';

-- Enhanced error information
ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS error_info JSONB;
COMMENT ON COLUMN processing_jobs.error_info IS 'Detailed error context: type, step, traceback, category';

-- Retry tracking
ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS retry_info JSONB;
COMMENT ON COLUMN processing_jobs.retry_info IS 'Retry attempt, parent job, reason, changes made';

-- Performance indexes for analytics queries
CREATE INDEX IF NOT EXISTS idx_processing_jobs_status ON processing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_created_date ON processing_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_user_video ON processing_jobs(user_id, video_id);

-- JSONB indexes - using GIN for better performance on JSON queries
CREATE INDEX IF NOT EXISTS idx_processing_jobs_worker_specs_gin ON processing_jobs USING GIN (worker_specs);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_error_info_gin ON processing_jobs USING GIN (error_info);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_billing_gin ON processing_jobs USING GIN (billing);
