# Mintonix Video Analysis Platform - Comprehensive Documentation

**Last Updated:** November 26, 2025
**Version:** 2.0

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [File Verification Fix](#file-verification-fix)
4. [Worker Health Monitoring & Retry System](#worker-health-monitoring--retry-system)
5. [Database Schema & Setup](#database-schema--setup)
6. [API Endpoints](#api-endpoints)
7. [Frontend Components](#frontend-components)
8. [Video Processing Pipeline](#video-processing-pipeline)
9. [Logging System](#logging-system)
10. [Troubleshooting](#troubleshooting)
11. [Deployment](#deployment)

---

## System Overview

Mintonix is a badminton video analysis platform that uses computer vision to analyze gameplay. The system processes videos through a RunPod worker that performs:
- Court detection and calibration
- Pose estimation for player tracking
- Shuttlecock tracking
- Position analysis and movement metrics
- Video visualization with overlays

### Key Features
✅ Async video processing with job tracking
✅ Worker health monitoring with automatic retry capability
✅ Real-time progress updates via Supabase Realtime
✅ Comprehensive analytics and logging
✅ Share links for analysis results
✅ User subscription and usage tracking

---

## Architecture

### Frontend (Next.js 14 + TypeScript)
- **Framework:** Next.js 14 with App Router
- **UI:** React + Tailwind CSS + shadcn/ui
- **State:** React hooks + Supabase Realtime
- **Storage:** Cloudflare R2 (S3-compatible)
- **Authentication:** Supabase Auth

### Backend
- **API:** Next.js API Routes
- **Database:** PostgreSQL (Supabase)
- **File Storage:** Cloudflare R2
- **Processing:** RunPod GPU workers (Python)
- **Error Tracking:** Sentry

### Processing Pipeline
```
User Upload → R2 Storage → RunPod Worker → Analysis → R2 Output → Frontend Display
                 ↓                ↓                      ↓
              Database      Job Tracking           Progress Updates
```

---

## File Verification Fix

### Issue (Fixed: Nov 26, 2025)

The frontend was checking for `court.csv` but the worker uploads `calibration.csv`, causing the system to incorrectly show "worker died" errors even when jobs completed successfully.

### Files Changed

All references to `court.csv` have been updated to `calibration.csv`:

| File | Line(s) | Change |
|------|---------|--------|
| `lib/r2.ts` | 427 | `'court.csv'` → `'calibration.csv'` |
| `lib/runpod-health.ts` | 210, 228 | Updated in both locations |
| `app/api/check-analysis-progress/route.ts` | 24 | Updated file check |
| `app/api/analysis-status/route.ts` | 20 | Updated status check |
| `app/api/analysis/route.ts` | 77, 212 | Updated both instances |

### Expected Files

The system now correctly checks for these files in R2:

```typescript
const filesToCheck = [
  { step: 'calibration', file: 'calibration.csv' },
  { step: 'poseEstimation', file: 'pose.json' },
  { step: 'shuttleTracking', file: 'shuttle.json' },
  { step: 'positionCorrection', file: 'corrected_positions.json' },
  { step: 'visualization', file: 'analyzed_video.mp4' },
];
```

### Verification

The `app/api/analysis-results/route.ts` already handles both filenames for backwards compatibility:

```typescript
const calibrationFiles = files.filter(f =>
  f.fileName === 'court.csv' ||       // Old format (legacy)
  f.fileName === 'calibration.csv' ||  // New format (current)
  f.fileName === 'calibration_summary.json'
);
```

---

## Worker Health Monitoring & Retry System

### Overview

The system tracks all RunPod jobs in the database and provides automatic retry capability when workers fail.

### Database Layer

**Table:** `processing_jobs`

```sql
CREATE TABLE processing_jobs (
  job_id TEXT PRIMARY KEY,
  runpod_job_id TEXT,
  user_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER DEFAULT 0,
  current_step TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  parent_job_id TEXT,
  job_params JSONB,
  last_error TEXT,
  error_details JSONB,
  webhook_url TEXT,
  webhook_received BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Key Fields:**
- `job_id`: Internal unique identifier (`unified-{videoId}-{timestamp}`)
- `runpod_job_id`: RunPod's job identifier
- `status`: queued | running | completed | failed | worker_died | cancelled | timed_out
- `retry_count` / `max_retries`: Retry tracking (default max: 3)

### Backend APIs

#### `/api/check-worker-health` (GET)
**Purpose:** Check if RunPod worker is alive and output files exist

**Parameters:**
- `runpodJobId`: RunPod job ID
- `userId`: User ID
- `videoId`: Video ID

**Response:**
```json
{
  "runpodJobId": "xyz-abc-123",
  "status": "worker_died",
  "runpodStatus": "FAILED",
  "isAlive": false,
  "workerDied": true,
  "filesExist": false,
  "recommendation": "retry",
  "message": "Worker died - retry recommended",
  "errorMessage": "Job failed with error: Out of memory"
}
```

**Recommendations:**
- `wait`: Worker still processing
- `retry`: Worker died, retry allowed
- `success`: Job completed successfully
- `failed`: Permanent failure

#### `/api/retry-analysis` (POST)
**Purpose:** Retry a failed job

**Body:**
```json
{
  "jobId": "unified-video123-1234567890"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Job retry submitted (attempt 2/3)",
  "originalJobId": "unified-video123-1234567890",
  "newJobId": "unified-video123-1234567890-retry-2-1234567900",
  "runpodJobId": "xyz-abc-def",
  "retryAttempt": 2,
  "maxRetries": 3
}
```

### Frontend Component

**`WorkerHealthMonitor`** (`components/dashboard/WorkerHealthMonitor.tsx`)

Automatically monitors job health and displays retry UI when needed.

**Usage:**
```tsx
import { WorkerHealthMonitor } from '@/components/dashboard/WorkerHealthMonitor';

<WorkerHealthMonitor
  runpodJobId={runpodJobId}
  userId={userId}
  videoId={videoId}
  checkInterval={30000}  // Optional: 30s default
/>
```

**Features:**
- ✅ **Supabase Realtime** for instant status updates
- ✅ **Fallback polling** (30s) if Realtime unavailable
- ✅ **Visual states:**
  - Blue: Worker processing (⚡ Live badge when Realtime active)
  - Orange: Worker died (with retry button)
  - Red: Permanent failure
  - Auto-hides when completed

### Flow Diagrams

#### Normal Flow (Success)
```
1. User starts analysis → /api/unified-analysis
2. Create processing_jobs record (status='queued')
3. Submit to RunPod
4. Update record (status='running', runpod_job_id set)
5. WorkerHealthMonitor polls every 30s
6. Worker completes, files appear in R2
7. Status → 'completed'
8. Monitor stops checking (success)
```

#### Failure Flow (Worker Dies)
```
1. Worker crashes mid-processing
2. Health check detects: RunPod status=FAILED, R2 files missing
3. Database updated: status='worker_died'
4. WorkerHealthMonitor shows retry button INSTANTLY (via Realtime)
5. User clicks "Retry Job"
6. /api/retry-analysis creates new job
7. New job submitted to RunPod with same parameters
8. retry_count incremented, old job marked 'cancelled'
9. Monitor starts tracking new job
```

### Integration Example

**In your video page (`app/dashboard/video/[videoId]/page.tsx`):**

```typescript
const [currentRunpodJobId, setCurrentRunpodJobId] = useState<string | null>(null);

// Fetch runpodJobId from processing_jobs
const fetchRunpodJobId = async () => {
  const supabase = createClient();
  const { data } = await supabase
    .from('processing_jobs')
    .select('runpod_job_id')
    .eq('user_id', userId)
    .eq('video_id', videoId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (data?.runpod_job_id) {
    setCurrentRunpodJobId(data.runpod_job_id);
  }
};

// Call in useEffect
useEffect(() => {
  if (userId && videoId) {
    fetchRunpodJobId();
  }
}, [userId, videoId]);

// Render monitor
{currentRunpodJobId && (
  <WorkerHealthMonitor
    runpodJobId={currentRunpodJobId}
    userId={userId}
    videoId={videoId}
  />
)}
```

---

## Database Schema & Setup

### Tables

#### 1. `user_profiles`
User account information and roles.

```sql
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin', 'super_admin')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 2. `subscriptions`
User subscription plans and usage tracking.

```sql
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  plan_type TEXT DEFAULT 'FREE',
  hours_included NUMERIC(10, 2) DEFAULT 5.00,
  hours_used NUMERIC(10, 2) DEFAULT 0.00,
  hours_remaining NUMERIC(10, 2) GENERATED ALWAYS AS (
    GREATEST(0, hours_included - hours_used)
  ) STORED,
  overage_hours NUMERIC(10, 2) GENERATED ALWAYS AS (
    GREATEST(0, hours_used - hours_included)
  ) STORED,
  billing_period_start TIMESTAMPTZ DEFAULT NOW(),
  billing_period_end TIMESTAMPTZ,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 3. `processing_jobs`
RunPod job tracking and retry management.

See "Worker Health Monitoring" section for full schema.

#### 4. `usage_records`
Historical usage tracking per video.

```sql
CREATE TABLE usage_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  video_id TEXT NOT NULL,
  hours_consumed NUMERIC(10, 2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 5. `analysis_shares`
Share links for analysis results.

```sql
CREATE TABLE analysis_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  share_token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ,
  view_count INTEGER DEFAULT 0,
  max_views INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Setup Instructions

1. **Run Migration:**
   ```bash
   # In Supabase SQL Editor
   # Copy and run: supabase_setup.sql
   ```

2. **Enable Supabase Realtime:**
   - Go to: https://supabase.com/dashboard/project/{PROJECT_ID}/database/replication
   - Enable replication for `processing_jobs` table

3. **Create First Super Admin:**
   ```sql
   UPDATE user_profiles
   SET role = 'super_admin'
   WHERE email = 'your-email@example.com';
   ```

### Helper Functions

```sql
-- Track video usage (atomic operation)
SELECT track_video_usage(
  p_user_id := 'user-uuid',
  p_video_id := 'video-123',
  p_hours_consumed := 1.5
);

-- Increment share view count (with expiration check)
SELECT increment_share_view_count(
  p_share_token := 'abc123xyz'
);

-- Check user role
SELECT is_admin();        -- Returns boolean
SELECT is_super_admin();  -- Returns boolean
```

---

## API Endpoints

### Video Upload & Processing

#### `POST /api/upload-video`
**Purpose:** Upload video to R2 and auto-trigger analysis

**Body:** FormData with `file` field

**Response:**
```json
{
  "success": true,
  "video": {
    "key": "dev/user-id/video-id/video.mp4",
    "fileName": "my-video.mp4",
    "size": 257387520,
    "sessionId": "1234567890-abc123"
  }
}
```

**Auto-triggers:** `/api/unified-analysis` for async processing

#### `POST /api/unified-analysis`
**Purpose:** Submit video for complete analysis

**Body:**
```json
{
  "userId": "user-uuid",
  "videoId": "video-session-id"
}
```

**Response:**
```json
{
  "success": true,
  "jobId": "unified-video123-1234567890",
  "runpodJobId": "xyz-abc-123",
  "status": "IN_QUEUE"
}
```

**Process:**
1. Creates `processing_jobs` record
2. Submits to RunPod async endpoint
3. Returns job IDs for tracking

### Analysis Progress

#### `GET /api/check-analysis-progress`
**Purpose:** Check which files exist in R2

**Parameters:**
- `userId`: User ID
- `videoId`: Video ID

**Response:**
```json
{
  "progress": {
    "calibration": true,
    "pose": true,
    "shuttle": true,
    "positions": true,
    "visualization": false
  },
  "allComplete": false,
  "timestamp": "2025-11-26T12:00:00Z"
}
```

#### `GET /api/analysis-status`
**Purpose:** Get human-readable analysis status

**Parameters:**
- `userId`: User ID
- `videoId`: Video ID

**Response:**
```json
{
  "state": "processing",
  "status": "Tracking Shuttlecock",
  "progress": 70,
  "currentStep": "Tracking Shuttlecock",
  "files": 4
}
```

**States:**
- `pending`: Not started
- `processing`: In progress
- `completed`: Done
- `failed`: Error

**Status Progression:**
1. Queued for Analysis (0%)
2. Court Detection (5%)
3. Detecting Poses (10%)
4. Calculating Positions (25%)
5. Removing Artifacts (40%)
6. Tracking Shuttlecock (55%)
7. Analyzing Positions (70%)
8. Generating Visualization (85%)
9. Analysis Complete (100%)

### Worker Health

#### `GET /api/check-worker-health`
See "Worker Health Monitoring" section

#### `POST /api/retry-analysis`
See "Worker Health Monitoring" section

### Data Retrieval

#### `GET /api/shuttle-data`
**Purpose:** Get shuttlecock tracking data

**Parameters:**
- `userId`: User ID
- `videoId`: Video ID

**Response:**
```json
{
  "shuttleData": {
    "frame_1": { "x": 100, "y": 200, "confidence": 0.95 },
    "frame_2": { "x": 105, "y": 195, "confidence": 0.92 }
  }
}
```

#### `GET /api/position-analysis`
**Purpose:** Get player position analysis

**Response:**
```json
{
  "players": {
    "player_0": {
      "total_distance_m": 125.5,
      "average_speed_m_s": 1.2,
      "time_tracked_seconds": 104.5,
      "court_occupancy_percent": {
        "front_left": 15,
        "front_right": 20,
        "middle_left": 25,
        "middle_right": 10,
        "back_left": 20,
        "back_right": 10
      },
      "movement_efficiency": { ... },
      "positioning_strategy": { ... },
      "rally_dynamics": { ... }
    }
  }
}
```

### Share Links

#### `POST /api/share`
**Purpose:** Create share link for analysis

**Body:**
```json
{
  "videoId": "video-123"
}
```

**Response:**
```json
{
  "shareUrl": "https://app.com/share/abc123xyz",
  "token": "abc123xyz"
}
```

#### `GET /api/share?videoId={videoId}`
**Purpose:** Check if video already shared

**Response:**
```json
{
  "shared": true,
  "shareUrl": "https://app.com/share/abc123xyz"
}
```

---

## Frontend Components

### WorkerHealthMonitor

See "Worker Health Monitoring" section

### VideoPlayer

**Location:** `components/dashboard/VideoPlayer.tsx`

**Purpose:** Play original or processed video with timeline markers

**Props:**
```typescript
interface VideoPlayerProps {
  video: Video;
  videoId: string;
  showProcessed: boolean;
  onDurationChange?: (duration: number) => void;
  onVideoElementReady?: () => void;
  shotMarkers?: ShotMarker[];
  onTimeUpdate?: (time: number) => void;
}
```

**Features:**
- Plays from R2 via `/api/video-stream`
- Switches between original and processed video
- Timeline markers (optional)
- Time tracking callbacks

---

## Video Processing Pipeline

### Overview

```
Upload → Calibration → Pose → Positions → Artifact Removal → Shuttle Tracking → Analysis → Visualization
```

### Steps

1. **Court Detection & Calibration** (calibration.csv)
   - Detects court boundaries
   - Establishes coordinate system
   - Outputs: `calibration.csv`

2. **Pose Estimation** (pose.json)
   - Tracks player skeletons
   - Identifies joints and body positions
   - Outputs: `pose.json`

3. **Position Calculation** (corrected_positions.json)
   - Maps 2D poses to 3D court positions
   - Corrects perspective distortion
   - Outputs: `corrected_positions.json`

4. **Shuttlecock Tracking** (shuttle.json)
   - Tracks shuttlecock frame-by-frame
   - Identifies trajectory
   - Outputs: `shuttle.json`

5. **Position Analysis** (position_analysis.json)
   - Calculates movement metrics
   - Court occupancy analysis
   - Movement efficiency patterns
   - Outputs: `position_analysis.json`

6. **Video Visualization** (analyzed_video.mp4)
   - Overlays analysis on video
   - Adds player tracking
   - Adds shuttlecock trajectory
   - Outputs: `analyzed_video.mp4`

### File Structure in R2

```
dev/
  ├── {userId}/
  │   ├── {videoId}/
  │   │   ├── video.mp4                    # Original upload
  │   │   ├── calibration.csv              # Step 1 output
  │   │   ├── pose.json                    # Step 2 output
  │   │   ├── corrected_positions.json     # Step 3 output
  │   │   ├── shuttle.json                 # Step 4 output
  │   │   ├── position_analysis.json       # Step 5 output
  │   │   └── analyzed_video.mp4           # Step 6 output
```

---

## Logging System

### Overview

Centralized logging utility in `lib/logger.ts` provides clean, structured logging.

### Functions

```typescript
import { logJobInfo, logSuccess, logError, logWarn, logDebug } from '@/lib/logger';

// Log important IDs in a box
logJobInfo({
  jobId: 'abc-123',
  userId: 'user-456',
  videoId: 'video-789',
  status: 'running'
});

// Success messages
logSuccess('Operation completed', { data: 'value' });

// Errors with stack traces (in dev)
logError('Operation failed', error);

// Warnings
logWarn('This might be an issue', { details: '...' });

// Debug (only in development)
logDebug('Debug information', { data: '...' });
```

### Output Examples

**Job Info:**
```
✅ Unified analysis job created
┌─────────────────────────────────────────
│ Job ID:        unified-1234567890-abc123-1700000000000
│ RunPod Job:    xyz-abc-123-def-456
│ User ID:       a1b2c3d4-e5f6-7890-1234-567890abcdef
│ Video ID:      1234567890-abc123
│ Status:        IN_QUEUE
└─────────────────────────────────────────
```

**Error:**
```
❌ Video upload failed
   File size exceeds maximum allowed size
```

### Environment Control

- **Production** (`NODE_ENV=production`):
  - Debug logs: Hidden ❌
  - Error logs: No stack traces

- **Development** (`NODE_ENV=development`):
  - All logs visible ✅
  - Full stack traces ✅

---

## Troubleshooting

### "Worker Died" Message on Completed Jobs (FIXED)

**Symptom:** Orange retry card shows even though job completed

**Cause:** Filename mismatch (`court.csv` vs `calibration.csv`)

**Status:** ✅ **FIXED** (Nov 26, 2025) - All files updated to check for `calibration.csv`

**Verification:**
```bash
# Check if fix is applied
grep -r "court\.csv" app/api lib/
# Should only show analysis-results (backwards compat)
```

### Realtime Not Working

**Symptom:** No "⚡ Live" badge, 30s delay before retry button

**Solution:**
1. Enable Realtime in Supabase Dashboard
2. Go to: Database → Replication
3. Toggle ON for `processing_jobs` table
4. Verify in browser console: `✅ Realtime subscription active`

### Jobs Not Saving to Database

**Check:**
```sql
-- Verify table exists
SELECT * FROM processing_jobs LIMIT 1;

-- Check RLS policies
SELECT * FROM pg_policies WHERE tablename = 'processing_jobs';
```

**Common Issues:**
- RLS blocking inserts → Run `fix_rls_recursion.sql`
- Wrong Supabase service key → Check `.env.local`
- Table doesn't exist → Run migration

### Infinite Recursion in RLS Policies

**Error:** `infinite recursion detected in policy for relation "user_profiles"`

**Cause:** Admin policies checking `user_profiles` creates recursive loop

**Solution:** Use `SECURITY DEFINER` helper functions

**Fix:**
```bash
# Run in Supabase SQL Editor
# Copy contents of: fix_rls_recursion.sql
```

### RunPod Worker Times Out

**Check:**
1. Video length (very long videos may exceed timeout)
2. RunPod worker health (check dashboard)
3. Network connectivity to RunPod API

**Mitigation:**
- System auto-retries up to 3 times
- Use WorkerHealthMonitor for visibility

### Files Missing from R2

**Debug:**
```typescript
// Check R2 file existence
const response = await fetch(
  `/api/check-analysis-progress?userId=${userId}&videoId=${videoId}`
);
const { progress } = await response.json();
console.log('Files in R2:', progress);
```

**Common Causes:**
- Worker died before completion → Retry
- Wrong videoId → Check session ID
- R2 credentials incorrect → Check env vars

---

## Deployment

### Environment Variables

**Required:**
```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx  # MUST match project URL!

# Cloudflare R2
R2_ENDPOINT_URL=https://xxx.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=xxx
R2_SECRET_ACCESS_KEY=xxx
R2_BUCKET_NAME=xxx
R2_ENVIRONMENT=dev  # or 'prod'

# RunPod
RUNPOD_ENDPOINT_ID=xxx
RUNPOD_API_KEY=xxx

# App
NEXT_PUBLIC_APP_URL=https://your-app.com
```

### Deployment Steps

1. **Deploy Frontend:**
   ```bash
   npm run build
   # Deploy to Vercel/Netlify
   ```

2. **Run Database Migrations:**
   ```sql
   -- In Supabase SQL Editor
   -- Run: supabase_setup.sql
   -- Run: create_processing_jobs.sql
   ```

3. **Enable Realtime:**
   - Go to Supabase → Database → Replication
   - Enable `processing_jobs` table

4. **Create Super Admin:**
   ```sql
   UPDATE user_profiles
   SET role = 'super_admin'
   WHERE email = 'admin@example.com';
   ```

5. **Verify:**
   - Upload test video
   - Check logs for clean output
   - Verify Realtime connection ("⚡ Live" badge)
   - Test retry button (simulate worker death)

---

## Appendix

### Supabase Queries

**Get Latest Job Status:**
```sql
SELECT
  job_id, runpod_job_id, status, retry_count,
  progress, current_step, last_error, created_at
FROM processing_jobs
WHERE user_id = 'USER_ID' AND video_id = 'VIDEO_ID'
ORDER BY created_at DESC
LIMIT 1;
```

**Check Retry Eligibility:**
```sql
SELECT
  job_id, status, retry_count, max_retries,
  (max_retries - retry_count) as retries_remaining,
  CASE
    WHEN retry_count < max_retries
      AND status IN ('worker_died', 'failed', 'timed_out')
    THEN 'YES - CAN RETRY ✅'
    WHEN retry_count >= max_retries
    THEN 'NO - MAX RETRIES EXCEEDED ❌'
    ELSE 'NO'
  END as can_retry
FROM processing_jobs
WHERE user_id = 'USER_ID' AND video_id = 'VIDEO_ID'
ORDER BY created_at DESC
LIMIT 1;
```

**View All Jobs for Video:**
```sql
SELECT job_id, status, retry_count, created_at, completed_at
FROM processing_jobs
WHERE user_id = 'USER_ID' AND video_id = 'VIDEO_ID'
ORDER BY created_at DESC;
```

### File Locations

**Frontend:**
```
mintonix/
├── app/
│   ├── api/
│   │   ├── upload-video/route.ts
│   │   ├── unified-analysis/route.ts
│   │   ├── check-worker-health/route.ts
│   │   ├── retry-analysis/route.ts
│   │   ├── check-analysis-progress/route.ts
│   │   └── analysis-status/route.ts
│   └── dashboard/video/[videoId]/page.tsx
├── components/dashboard/
│   ├── WorkerHealthMonitor.tsx
│   └── VideoPlayer.tsx
├── lib/
│   ├── processing-jobs.ts
│   ├── runpod-health.ts
│   ├── r2.ts
│   └── logger.ts
└── supabase/migrations/
    ├── create_processing_jobs.sql
    └── add_job_analytics_columns.sql
```

### Status Reference

**Job Status Values:**
- `queued`: Submitted, waiting to start
- `running`: Currently processing
- `completed`: Finished successfully ✅
- `failed`: Failed permanently ❌
- `worker_died`: Worker crashed, can retry ⚠️
- `timed_out`: Exceeded timeout ⏱️
- `cancelled`: Superseded by retry

**RunPod Status Values:**
- `IN_QUEUE`: Waiting for worker
- `IN_PROGRESS`: Processing
- `COMPLETED`: Done
- `FAILED`: Error occurred
- `CANCELLED`: User cancelled
- `TIMED_OUT`: Exceeded timeout

---

## Support & Resources

- **GitHub Issues:** Report bugs and request features
- **Supabase Dashboard:** Monitor database and logs
- **RunPod Dashboard:** Monitor worker health and logs
- **Sentry:** Track errors in production

**Key Documentation Files:**
- This file: Comprehensive overview
- `SCHEMA_DECISIONS.md`: Database design rationale
- `WORKER_RETRY_USAGE.md`: Detailed retry system usage
- `DATABASE_SETUP_INSTRUCTIONS.md`: Step-by-step setup

---

**Documentation Maintained By:** Claude Code
**Last Major Update:** November 26, 2025 - File verification fix
