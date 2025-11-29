export interface Subscription {
  id: string;
  user_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string | null;
  plan_type: 'FREE' | 'STARTER' | 'PRO' | 'ENTERPRISE';
  status: 'active' | 'canceled' | 'past_due' | 'incomplete' | 'trialing';
  current_period_start: string;
  current_period_end: string;
  minutes_included: number;
  minutes_used: number;
  minutes_remaining: number;
  overage_minutes: number;
  created_at: string;
  updated_at: string;
}

export interface UsageRecord {
  id: string;
  user_id: string;
  subscription_id: string;
  video_id: string;
  minutes_consumed: number;
  billing_period_start: string;
  billing_period_end: string;
  created_at: string;
}

export interface BillingHistory {
  id: string;
  user_id: string;
  subscription_id: string;
  stripe_invoice_id: string;
  amount: number;
  status: 'paid' | 'open' | 'void' | 'uncollectible';
  invoice_url: string;
  billing_period_start: string;
  billing_period_end: string;
  minutes_billed: number;
  overage_amount: number;
  created_at: string;
}

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: 'user' | 'admin' | 'super_admin';
  created_at: string;
  updated_at: string;
}

export interface Video {
  id: string;
  video_id: string;
  user_id: string;
  r2_key: string;
  original_filename: string;
  display_filename: string;
  file_size_bytes: number;
  duration_seconds: number | null;
  resolution: string | null;
  fps: number | null;
  codec: string | null;
  status: 'uploaded' | 'processing' | 'completed' | 'failed' | 'archived' | 'deleted';
  deleted_at: string | null;
  uploaded_at: string;
  created_at: string;
  updated_at: string;
}

export interface AnalysisShare {
  id: string;
  user_id: string;
  video_id: string;
  share_token: string;
  view_count: number;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content_key: string;
  featured_image: string | null;
  status: 'draft' | 'published';
  tags: string[];
  author: string;
  author_id: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export type JobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'worker_died'
  | 'cancelled'
  | 'timed_out';

export interface ProcessingJob {
  id: string;
  runpod_job_id: string | null;
  user_id: string;
  video_id: string;
  job_params: Record<string, unknown>;
  status: JobStatus;
  current_step: string | null;
  progress: number;
  retry_count: number;
  parent_job_id: string | null;
  last_error: string | null;
  error_details: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  last_checked_at: string | null;

  // Analytics JSONB
  worker_specs?: Record<string, unknown>;
  input_params?: Record<string, unknown>;
  step_metrics?: Record<string, unknown>;
  output_summary?: Record<string, unknown>;
  resource_usage?: Record<string, unknown>;
  billing?: Record<string, unknown>;
  error_info?: Record<string, unknown>;
  retry_info?: Record<string, unknown>;
}
