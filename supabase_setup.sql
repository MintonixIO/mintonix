-- ============================================================================
-- MINTONIX DATABASE SETUP - REFACTORED
-- ============================================================================
-- This script sets up the refactored Supabase database schema for Mintonix
--
-- Key changes:
-- - NEW: videos table for centralized video metadata (was only in R2)
-- - Minute-based billing (10 minutes free tier)
-- - Simplified processing_jobs (no job_id, job_type, webhooks, quality_metrics)
-- - Foreign key constraints on video_id (referential integrity)
-- - Soft delete support for videos
-- - Improved indexing and referential integrity
--
-- Tables: user_profiles, subscriptions, videos, usage_records, billing_history,
--         analysis_shares, blog_posts, processing_jobs
--
-- Usage: Run this on a clean Supabase database
-- ============================================================================

-- ============================================================================
-- EXTENSIONS
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- TABLES
-- ============================================================================

-- USER PROFILES
-- Extends auth.users with application-specific profile data
CREATE TABLE public.user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'super_admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.user_profiles IS 'User profiles with role-based access control';
COMMENT ON COLUMN public.user_profiles.role IS 'User role: user (default), admin, or super_admin';

-- ============================================================================

-- SUBSCRIPTIONS
-- Manages user subscription plans and MINUTE-based usage tracking
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT UNIQUE,
  plan_type TEXT NOT NULL DEFAULT 'FREE' CHECK (plan_type IN ('FREE', 'STARTER', 'PRO', 'ENTERPRISE')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled', 'past_due', 'incomplete', 'trialing')),
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,

  -- Minute-based usage tracking
  minutes_included NUMERIC(10, 2) NOT NULL DEFAULT 10.00,  -- FREE tier = 10 minutes
  minutes_used NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  minutes_remaining NUMERIC(10, 2) GENERATED ALWAYS AS (GREATEST(0, minutes_included - minutes_used)) STORED,
  overage_minutes NUMERIC(10, 2) GENERATED ALWAYS AS (GREATEST(0, minutes_used - minutes_included)) STORED,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT one_subscription_per_user UNIQUE(user_id),
  CONSTRAINT minutes_non_negative CHECK (minutes_used >= 0 AND minutes_included >= 0),
  CONSTRAINT valid_period CHECK (current_period_end IS NULL OR current_period_end > current_period_start)
);

COMMENT ON TABLE public.subscriptions IS 'User subscription plans with minute-based usage tracking and Stripe integration';
COMMENT ON COLUMN public.subscriptions.minutes_included IS 'Minutes included in plan per billing period (e.g., 10 for FREE, 300 for STARTER, 3000 for PRO)';

-- ============================================================================

-- VIDEOS
-- Central table for video metadata (videos stored in R2)
CREATE TABLE public.videos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id TEXT NOT NULL UNIQUE,  -- Matches R2 folder name (e.g., "1705328553789-k2j9f1")
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,

  -- File metadata
  r2_key TEXT NOT NULL,             -- Full R2 path: dev/{userId}/{videoId}/video.mp4
  original_filename TEXT NOT NULL,  -- User's original upload name
  display_filename TEXT NOT NULL,   -- Current display name (can be renamed)
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0),

  -- Video properties (populated after analysis)
  duration_seconds NUMERIC(10, 2),  -- Actual duration from video metadata
  resolution TEXT,                  -- e.g., "1920x1080"
  fps NUMERIC(5, 2),               -- Frame rate
  codec TEXT,                       -- e.g., "h264"

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN (
    'uploading',   -- Upload in progress (direct-to-R2 upload)
    'uploaded',    -- Just uploaded, not yet processed
    'processing',  -- Currently being analyzed
    'completed',   -- Analysis finished successfully
    'failed',      -- Analysis failed
    'archived',    -- User archived it
    'deleted'      -- Soft deleted
  )),

  -- Soft delete support
  deleted_at TIMESTAMPTZ,

  -- Timestamps
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT valid_deleted CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);

COMMENT ON TABLE public.videos IS 'Video metadata and status tracking (actual files stored in R2)';
COMMENT ON COLUMN public.videos.video_id IS 'Unique video identifier matching R2 folder name';
COMMENT ON COLUMN public.videos.r2_key IS 'Full R2 object path including environment prefix';
COMMENT ON COLUMN public.videos.status IS 'Current video processing status (uploading = upload in progress, uploaded = upload complete but not analyzed, processing = being analyzed, completed = analysis finished, failed = analysis failed, archived = user archived, deleted = soft deleted)';
COMMENT ON COLUMN public.videos.deleted_at IS 'Soft delete timestamp - NULL means active';

-- ============================================================================

-- USAGE RECORDS
-- Tracks individual video processing usage per billing period (in minutes)
CREATE TABLE public.usage_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES public.videos(video_id) ON DELETE SET NULL,
  minutes_consumed NUMERIC(10, 2) NOT NULL CHECK (minutes_consumed >= 0),
  billing_period_start TIMESTAMPTZ NOT NULL,
  billing_period_end TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT valid_billing_period CHECK (billing_period_end > billing_period_start)
);

COMMENT ON TABLE public.usage_records IS 'Individual video processing usage records in minutes for billing analytics';
COMMENT ON COLUMN public.usage_records.minutes_consumed IS 'Minutes of video processing consumed (e.g., 27.5 for a 27min 30sec video)';

-- ============================================================================

-- BILLING HISTORY
-- Stores completed billing transactions from Stripe (minute-based)
CREATE TABLE public.billing_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  stripe_invoice_id TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL CHECK (status IN ('paid', 'open', 'void', 'uncollectible')),
  invoice_url TEXT,
  billing_period_start TIMESTAMPTZ NOT NULL,
  billing_period_end TIMESTAMPTZ NOT NULL,
  minutes_billed NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  overage_amount INTEGER DEFAULT 0 CHECK (overage_amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT valid_billing_period CHECK (billing_period_end > billing_period_start)
);

COMMENT ON TABLE public.billing_history IS 'Historical billing records from Stripe invoices with minute-based usage';
COMMENT ON COLUMN public.billing_history.minutes_billed IS 'Total minutes billed this period (included + overage)';

-- ============================================================================

-- ANALYSIS SHARES
-- Manages public share links for video analyses
CREATE TABLE public.analysis_shares (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES public.videos(video_id) ON DELETE CASCADE,
  share_token TEXT NOT NULL UNIQUE,
  view_count INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_user_video_share UNIQUE(user_id, video_id),
  CONSTRAINT valid_expiration CHECK (expires_at IS NULL OR expires_at > created_at)
);

COMMENT ON TABLE public.analysis_shares IS 'Public share links for video analyses with view tracking';

-- ============================================================================

-- BLOG POSTS
-- Stores blog content metadata with R2 storage references
CREATE TABLE public.blog_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  excerpt TEXT,
  content_key TEXT NOT NULL,
  featured_image TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  tags TEXT[] DEFAULT '{}',
  author TEXT NOT NULL,
  author_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.blog_posts IS 'Blog posts with content stored in R2';

-- ============================================================================

-- PROCESSING JOBS
-- Simplified RunPod job tracking with analytics
CREATE TABLE public.processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  runpod_job_id TEXT UNIQUE,  -- RunPod's job ID (may be null initially)
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES public.videos(video_id) ON DELETE CASCADE,

  -- Job configuration
  job_params JSONB,  -- Store original job parameters for retry

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'running', 'completed', 'failed', 'worker_died', 'cancelled', 'timed_out'
  )),
  current_step TEXT,  -- Current processing step (e.g., 'calibration', 'pose_estimation')
  progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),  -- 0-100

  -- Retry management (max_retries hardcoded to 3 in application logic)
  retry_count INTEGER DEFAULT 0 CHECK (retry_count >= 0),
  parent_job_id UUID,  -- Reference to parent job if this is a retry

  -- Error tracking
  last_error TEXT,
  error_details JSONB,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,

  -- Analytics columns (stored as JSONB for flexibility)
  worker_specs JSONB,      -- GPU type, memory, CPU specs, region
  input_params JSONB,      -- Video metadata: size, fps, resolution, codec
  step_metrics JSONB,      -- Timing, throughput, and output for each pipeline step
  output_summary JSONB,    -- Files created, sizes, R2 paths, upload stats
  resource_usage JSONB,    -- Peak GPU/RAM usage, CPU utilization, disk I/O
  billing JSONB,           -- Compute time, GPU minutes, estimated cost
  error_info JSONB,        -- Detailed error context: type, step, traceback, category
  retry_info JSONB,        -- Retry attempt, parent job, reason, changes made

  CONSTRAINT fk_parent_job FOREIGN KEY (parent_job_id) REFERENCES processing_jobs(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.processing_jobs IS 'RunPod video analysis job tracking with retry support (max 3 retries hardcoded)';
COMMENT ON COLUMN public.processing_jobs.runpod_job_id IS 'RunPod job identifier for status polling';
COMMENT ON COLUMN public.processing_jobs.parent_job_id IS 'UUID of original job if this is a retry';
COMMENT ON COLUMN public.processing_jobs.retry_count IS 'Number of retry attempts (max 3 hardcoded in app logic)';
COMMENT ON COLUMN public.processing_jobs.worker_specs IS 'GPU type, memory, CPU specs, region, etc.';
COMMENT ON COLUMN public.processing_jobs.input_params IS 'Video metadata: size, fps, resolution, codec, etc.';
COMMENT ON COLUMN public.processing_jobs.step_metrics IS 'Timing, throughput, and output for each pipeline step';
COMMENT ON COLUMN public.processing_jobs.output_summary IS 'Files created, sizes, R2 paths, upload stats';
COMMENT ON COLUMN public.processing_jobs.resource_usage IS 'Peak GPU/RAM usage, CPU utilization, disk I/O';
COMMENT ON COLUMN public.processing_jobs.billing IS 'Compute time, GPU minutes, estimated cost';
COMMENT ON COLUMN public.processing_jobs.error_info IS 'Detailed error context: type, step, traceback, category';
COMMENT ON COLUMN public.processing_jobs.retry_info IS 'Retry attempt, parent job, reason, changes made';

-- ============================================================================
-- INDEXES
-- ============================================================================

-- User Profiles
CREATE INDEX idx_user_profiles_role ON public.user_profiles(role);
CREATE INDEX idx_user_profiles_email ON public.user_profiles(email);

-- Subscriptions
CREATE INDEX idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX idx_subscriptions_stripe_customer_id ON public.subscriptions(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX idx_subscriptions_status ON public.subscriptions(status);

-- Videos
CREATE INDEX idx_videos_user_id ON public.videos(user_id);
CREATE INDEX idx_videos_video_id ON public.videos(video_id);
CREATE INDEX idx_videos_status ON public.videos(status);
CREATE INDEX idx_videos_user_status ON public.videos(user_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_videos_uploaded_at ON public.videos(uploaded_at DESC);
CREATE INDEX idx_videos_deleted_at ON public.videos(deleted_at) WHERE deleted_at IS NOT NULL;

-- Usage Records
CREATE INDEX idx_usage_records_user_id ON public.usage_records(user_id);
CREATE INDEX idx_usage_records_subscription_id ON public.usage_records(subscription_id);
CREATE INDEX idx_usage_records_created_at ON public.usage_records(created_at DESC);
CREATE INDEX idx_usage_records_user_created ON public.usage_records(user_id, created_at DESC);

-- Billing History
CREATE INDEX idx_billing_history_user_id ON public.billing_history(user_id);
CREATE INDEX idx_billing_history_subscription_id ON public.billing_history(subscription_id);
CREATE INDEX idx_billing_history_created_at ON public.billing_history(created_at DESC);

-- Analysis Shares
CREATE INDEX idx_analysis_shares_user_id ON public.analysis_shares(user_id);
CREATE INDEX idx_analysis_shares_video_id ON public.analysis_shares(video_id);
CREATE INDEX idx_analysis_shares_user_video ON public.analysis_shares(user_id, video_id);
CREATE INDEX idx_analysis_shares_expires ON public.analysis_shares(expires_at) WHERE expires_at IS NOT NULL;

-- Blog Posts
CREATE INDEX idx_blog_posts_status ON public.blog_posts(status);
CREATE INDEX idx_blog_posts_slug ON public.blog_posts(slug);
CREATE INDEX idx_blog_posts_published_at ON public.blog_posts(published_at DESC) WHERE status = 'published';

-- Processing Jobs
CREATE INDEX idx_processing_jobs_user_id ON public.processing_jobs(user_id);
CREATE INDEX idx_processing_jobs_video_id ON public.processing_jobs(video_id);
CREATE INDEX idx_processing_jobs_runpod_job_id ON public.processing_jobs(runpod_job_id) WHERE runpod_job_id IS NOT NULL;
CREATE INDEX idx_processing_jobs_status ON public.processing_jobs(status);
CREATE INDEX idx_processing_jobs_user_status ON public.processing_jobs(user_id, status);
CREATE INDEX idx_processing_jobs_status_created ON public.processing_jobs(status, created_at DESC);
CREATE INDEX idx_processing_jobs_created_at ON public.processing_jobs(created_at DESC);

-- JSONB indexes for processing_jobs (GIN for better JSON query performance)
CREATE INDEX idx_processing_jobs_worker_specs_gin ON public.processing_jobs USING GIN (worker_specs);
CREATE INDEX idx_processing_jobs_error_info_gin ON public.processing_jobs USING GIN (error_info);
CREATE INDEX idx_processing_jobs_billing_gin ON public.processing_jobs USING GIN (billing);

-- ============================================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_videos_updated_at
  BEFORE UPDATE ON public.videos
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_analysis_shares_updated_at
  BEFORE UPDATE ON public.analysis_shares
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_blog_posts_updated_at
  BEFORE UPDATE ON public.blog_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_processing_jobs_updated_at
  BEFORE UPDATE ON public.processing_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================

-- Auto-create user profile and subscription on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Create user profile
  INSERT INTO public.user_profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    'user'
  );

  -- Create FREE subscription for new user (10 minutes)
  INSERT INTO public.subscriptions (
    user_id,
    plan_type,
    status,
    minutes_included,
    minutes_used,
    current_period_start,
    current_period_end
  )
  VALUES (
    NEW.id,
    'FREE',
    'active',
    10.00,  -- 10 minutes for free tier
    0.00,
    NOW(),
    NOW() + INTERVAL '1 month'
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================

-- Track video usage in minutes (handles overage limits and atomic updates)
CREATE OR REPLACE FUNCTION public.track_video_usage(
  p_user_id UUID,
  p_video_id TEXT,
  p_minutes_consumed NUMERIC
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_subscription_id UUID;
  v_current_minutes_used NUMERIC;
  v_minutes_included NUMERIC;
  v_overage_limit NUMERIC := 6000.00;  -- 6000 minutes = 100 hours max overage
  v_new_minutes_used NUMERIC;
  v_billing_start TIMESTAMPTZ;
  v_billing_end TIMESTAMPTZ;
BEGIN
  -- Get active subscription
  SELECT id, minutes_used, minutes_included, current_period_start, current_period_end
  INTO v_subscription_id, v_current_minutes_used, v_minutes_included, v_billing_start, v_billing_end
  FROM public.subscriptions
  WHERE user_id = p_user_id AND status = 'active'
  LIMIT 1;

  IF v_subscription_id IS NULL THEN
    RAISE EXCEPTION 'No active subscription found for user';
  END IF;

  v_new_minutes_used := v_current_minutes_used + p_minutes_consumed;

  -- Check overage limit (6000 minutes = 100 hours)
  IF (v_new_minutes_used - v_minutes_included) > v_overage_limit THEN
    RAISE EXCEPTION 'Overage limit exceeded. Maximum overage: % minutes', v_overage_limit;
  END IF;

  -- Update subscription minutes
  UPDATE public.subscriptions
  SET minutes_used = v_new_minutes_used
  WHERE id = v_subscription_id;

  -- Record usage
  INSERT INTO public.usage_records (
    user_id,
    subscription_id,
    video_id,
    minutes_consumed,
    billing_period_start,
    billing_period_end
  )
  VALUES (
    p_user_id,
    v_subscription_id,
    p_video_id,
    p_minutes_consumed,
    v_billing_start,
    v_billing_end
  );

  RETURN json_build_object(
    'success', true,
    'minutes_used', v_new_minutes_used,
    'minutes_remaining', GREATEST(0, v_minutes_included - v_new_minutes_used),
    'overage_minutes', GREATEST(0, v_new_minutes_used - v_minutes_included)
  );
END;
$$;

COMMENT ON FUNCTION public.track_video_usage IS 'Atomically track video usage in minutes with overage protection (max 6000 minutes overage)';

-- ============================================================================

-- Increment share view count
CREATE OR REPLACE FUNCTION public.increment_share_view_count(p_share_token TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.analysis_shares
  SET view_count = view_count + 1
  WHERE share_token = p_share_token
  AND (expires_at IS NULL OR expires_at > NOW());
END;
$$;

COMMENT ON FUNCTION public.increment_share_view_count IS 'Safely increment share view count with expiration check';

-- ============================================================================

-- Auto-set published_at timestamp
CREATE OR REPLACE FUNCTION public.set_blog_published_at()
RETURNS TRIGGER AS $$
BEGIN
  -- Set published_at when status changes to 'published'
  IF NEW.status = 'published' AND (OLD.status IS NULL OR OLD.status != 'published') THEN
    NEW.published_at = COALESCE(NEW.published_at, NOW());
  END IF;

  -- Clear published_at when unpublished
  IF NEW.status = 'draft' AND OLD.status = 'published' THEN
    NEW.published_at = NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_blog_published_at
  BEFORE UPDATE ON public.blog_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_blog_published_at();

-- ============================================================================
-- HELPER FUNCTIONS FOR RLS
-- ============================================================================
-- These SECURITY DEFINER functions bypass RLS to prevent infinite recursion

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'super_admin')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
    AND role = 'super_admin'
  );
END;
$$;

COMMENT ON FUNCTION public.is_admin IS 'Check if current user has admin or super_admin role (bypasses RLS)';
COMMENT ON FUNCTION public.is_super_admin IS 'Check if current user has super_admin role (bypasses RLS)';

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processing_jobs ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- USER PROFILES POLICIES
-- ============================================================================

CREATE POLICY "Users can view own profile"
  ON public.user_profiles
  FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles"
  ON public.user_profiles
  FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Users can update own profile"
  ON public.user_profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id AND
    role = (SELECT role FROM public.user_profiles WHERE id = auth.uid())
  );

CREATE POLICY "Super admins can update any profile"
  ON public.user_profiles
  FOR UPDATE
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- ============================================================================
-- SUBSCRIPTIONS POLICIES
-- ============================================================================

CREATE POLICY "Users can view own subscription"
  ON public.subscriptions
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all subscriptions"
  ON public.subscriptions
  FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Admins can update subscriptions"
  ON public.subscriptions
  FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================================================================
-- VIDEOS POLICIES
-- ============================================================================

CREATE POLICY "Users can view own videos"
  ON public.videos
  FOR SELECT
  USING (auth.uid() = user_id AND deleted_at IS NULL);

CREATE POLICY "Users can create own videos"
  ON public.videos
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own videos"
  ON public.videos
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own videos"
  ON public.videos
  FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all videos"
  ON public.videos
  FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Admins can update all videos"
  ON public.videos
  FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================================================================
-- USAGE RECORDS POLICIES
-- ============================================================================

CREATE POLICY "Users can view own usage"
  ON public.usage_records
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all usage"
  ON public.usage_records
  FOR SELECT
  USING (public.is_admin());

-- ============================================================================
-- BILLING HISTORY POLICIES
-- ============================================================================

CREATE POLICY "Users can view own billing history"
  ON public.billing_history
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all billing history"
  ON public.billing_history
  FOR SELECT
  USING (public.is_admin());

-- ============================================================================
-- ANALYSIS SHARES POLICIES
-- ============================================================================

CREATE POLICY "Users can view own shares"
  ON public.analysis_shares
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create shares"
  ON public.analysis_shares
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own shares"
  ON public.analysis_shares
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own shares"
  ON public.analysis_shares
  FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all shares"
  ON public.analysis_shares
  FOR SELECT
  USING (public.is_admin());

-- ============================================================================
-- BLOG POSTS POLICIES
-- ============================================================================

CREATE POLICY "Anyone can view published blogs"
  ON public.blog_posts
  FOR SELECT
  USING (status = 'published');

CREATE POLICY "Admins can view all blogs"
  ON public.blog_posts
  FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Admins can create blogs"
  ON public.blog_posts
  FOR INSERT
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update blogs"
  ON public.blog_posts
  FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete blogs"
  ON public.blog_posts
  FOR DELETE
  USING (public.is_admin());

-- ============================================================================
-- PROCESSING JOBS POLICIES
-- ============================================================================

CREATE POLICY "Users can view own processing jobs"
  ON public.processing_jobs
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own processing jobs"
  ON public.processing_jobs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own processing jobs"
  ON public.processing_jobs
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own processing jobs"
  ON public.processing_jobs
  FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all processing jobs"
  ON public.processing_jobs
  FOR SELECT
  USING (public.is_admin());

-- ============================================================================
-- SETUP COMPLETE
-- ============================================================================

-- Grant usage on schema
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Grant table permissions
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;

-- Note: RLS policies will still enforce access control
-- service_role can bypass RLS for webhooks and background jobs

SELECT 'Refactored database setup complete! ✅

Tables created (8 total):
  1. user_profiles - User accounts & RBAC
  2. subscriptions - Minute-based billing (10 min free tier)
  3. videos - Centralized video metadata (NEW!)
  4. usage_records - Video processing usage tracking
  5. billing_history - Stripe invoice records
  6. analysis_shares - Public share links
  7. blog_posts - Blog CMS
  8. processing_jobs - Simplified job tracking

Key improvements:
  ✅ Videos table with soft delete support
  ✅ Foreign key constraints (referential integrity)
  ✅ Minute-based billing (10 minutes free, 6000 min overage limit)
  ✅ Simplified processing_jobs (removed job_id, webhooks, quality_metrics)
  ✅ Comprehensive RLS policies
  ✅ Optimized indexes

Next steps:
  1. Update your app code to insert into videos table on upload
  2. Update video queries to use videos table instead of R2 listing
  3. Implement soft delete for videos (set deleted_at instead of R2 delete)' as status;
