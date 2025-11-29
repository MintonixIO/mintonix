# Mintonix

**Internal Badminton Video Analysis Platform**

AI-powered badminton video analysis using computer vision and machine learning to analyze gameplay, player movements, shot tracking, and tactical positioning.

## Tech Stack

**Frontend:**
- Next.js 14 (App Router)
- React 19 + TypeScript
- Tailwind CSS + shadcn/ui
- Supabase Auth & Realtime

**Backend:**
- Next.js API Routes
- PostgreSQL (Supabase)
- Cloudflare R2 (Object Storage)
- RunPod (GPU Processing)
- Stripe (Billing)

**Analysis Pipeline:**
- Python computer vision workers
- YOLOv8 for detection
- Pose estimation models
- Custom trajectory analysis

## Setup

### Prerequisites

- Node.js 18+
- Supabase account
- Cloudflare R2 bucket
- RunPod endpoint

### Installation

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env.local
   ```

   Edit `.env.local` with your credentials

3. **Set up database**
   - Run `supabase_setup.sql` in Supabase SQL Editor
   - Enable Realtime for `processing_jobs` table

4. **Create admin user**
   ```sql
   UPDATE user_profiles
   SET role = 'super_admin'
   WHERE email = 'your-email@example.com';
   ```

5. **Run development server**
   ```bash
   npm run dev
   ```

## Documentation

See [DOCUMENTATION.md](./DOCUMENTATION.md) for complete technical documentation including:
- API reference
- Database schema
- Processing pipeline details
- Troubleshooting guide

## Project Structure

```
mintonix/
├── app/                   # Next.js app directory
│   ├── api/              # API routes
│   ├── auth/             # Authentication
│   ├── dashboard/        # User dashboard
│   └── admin/            # Admin panel
├── components/           # React components
├── lib/                  # Utilities
├── supabase/            # Database migrations
└── scripts/             # Helper scripts
```

## Environment Variables

See `.env.example` for required configuration.
