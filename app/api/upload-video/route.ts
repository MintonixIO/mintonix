import { NextRequest, NextResponse } from 'next/server';
import { uploadVideo } from '@/lib/r2';
import { createClient } from '@/lib/supabase/server';
import { logJobInfo, logSuccess, logError, logWarn } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes for video upload

// Server-side duration estimation (since we can't use DOM APIs on server)

function estimateVideoDuration(file: File): number {
  // Fallback estimation based on file size
  // This is a rough estimate: assume average bitrate of 2 Mbps
  const fileSizeMB = file.size / (1024 * 1024);
  const estimatedMinutes = fileSizeMB / 15; // Rough estimate: 15MB per minute for good quality video
  return Math.min(Math.max(estimatedMinutes, 0.5), 60); // Min 0.5 min, max 60 min
}

function createDefaultThumbnail(): string {
  // Create a modern glassmorphism SVG placeholder thumbnail
  const svg = `<svg width="640" height="360" xmlns="http://www.w3.org/2000/svg">
<defs>
  <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" style="stop-color:#1e1e1e"/>
    <stop offset="100%" style="stop-color:#0a0a0a"/>
  </linearGradient>
  <filter id="blur">
    <feGaussianBlur in="SourceGraphic" stdDeviation="4"/>
  </filter>
  <filter id="innerGlow">
    <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
    <feMerge>
      <feMergeNode in="coloredBlur"/>
      <feMergeNode in="SourceGraphic"/>
    </feMerge>
  </filter>
</defs>
<rect width="100%" height="100%" fill="url(#bg)"/>
<rect width="100%" height="100%" fill="url(#bg)" opacity="0.05"/>
<rect x="210" y="100" width="220" height="160" rx="16" fill="#2a2a2a" opacity="0.3" filter="url(#blur)"/>
<rect x="215" y="105" width="210" height="150" rx="14" fill="#252525" opacity="0.4" filter="url(#blur)"/>
<rect x="215" y="105" width="210" height="150" rx="14" fill="none" stroke="#404040" stroke-width="1" opacity="0.6"/>
<rect x="220" y="110" width="200" height="140" rx="12" fill="none" stroke="#505050" stroke-width="0.5" opacity="0.3"/>
<rect x="255" y="135" width="130" height="90" rx="10" fill="#1a1a1a" opacity="0.7" filter="url(#innerGlow)"/>
<rect x="255" y="135" width="130" height="90" rx="10" fill="none" stroke="#505050" stroke-width="2" opacity="0.5"/>
<rect x="258" y="138" width="124" height="84" rx="8" fill="none" stroke="#606060" stroke-width="1" opacity="0.3"/>
<path d="M 300 160 L 300 200 L 345 180 Z" fill="#e0e0e0" opacity="0.9"/>
<path d="M 303 165 L 303 195 L 335 180 Z" fill="#ffffff" opacity="0.15"/>
<ellipse cx="260" cy="130" rx="40" ry="25" fill="#ffffff" opacity="0.03" filter="url(#blur)"/>
</svg>`;
  return svg;
}


export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const userId = formData.get('userId') as string;
    const fileName = formData.get('fileName') as string;
    const thumbnailSmall = formData.get('thumbnailSmall') as string | null;
    const thumbnailMedium = formData.get('thumbnailMedium') as string | null;
    const thumbnailLarge = formData.get('thumbnailLarge') as string | null;
    // Legacy support for old single thumbnail format
    const thumbnail = formData.get('thumbnail') as string | null;

    if (!file || !userId || !fileName) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Check user subscription and hours remaining before upload
    const supabase = await createClient();
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (subError && subError.code !== 'PGRST116') {
      logError('Failed to fetch subscription', subError);
      return NextResponse.json(
        { error: 'Failed to check subscription status' },
        { status: 500 }
      );
    }

    // Estimate video duration and calculate minutes needed
    const estimatedDurationMinutes = estimateVideoDuration(file);
    const minutesNeeded = estimatedDurationMinutes;

    // Check if user has enough minutes
    if (subscription) {
      const minutesRemaining = subscription.minutes_remaining || 0;

      if (minutesRemaining <= 0 || minutesNeeded > minutesRemaining) {
        logWarn('Upload rejected - insufficient minutes', {
          minutesRemaining,
          minutesNeeded,
          userId
        });
        return NextResponse.json(
          {
            error: 'Insufficient minutes remaining',
            minutesNeeded: minutesNeeded.toFixed(2),
            minutesRemaining: minutesRemaining.toFixed(2),
            minutesUsed: subscription.minutes_used.toFixed(2),
            minutesIncluded: subscription.minutes_included.toFixed(2)
          },
          { status: 429 }
        );
      }
    }

    const result = await uploadVideo(userId, file, fileName);

    // Create video record in database
    const r2Environment = process.env.R2_ENVIRONMENT || 'dev';
    const r2Key = `${r2Environment}/${userId}/${result.videoId}/video.mp4`;

    const { data: videoRecord, error: videoError } = await supabase
      .from('videos')
      .insert({
        video_id: result.videoId,
        user_id: userId,
        r2_key: r2Key,
        original_filename: fileName,
        display_filename: fileName,
        file_size_bytes: file.size,
        status: 'uploaded',
        uploaded_at: new Date().toISOString()
      })
      .select()
      .single();

    if (videoError) {
      logError('Failed to create video record', videoError);
      // Optionally: delete from R2 to keep things clean
      return NextResponse.json(
        { error: 'Failed to create video record in database' },
        { status: 500 }
      );
    }

    // Immediately deduct estimated minutes from user's balance
    if (subscription) {
      // Use the track_video_usage function which bypasses RLS and handles updates atomically
      const { data: usageResult, error: usageError } = await supabase
        .rpc('track_video_usage', {
          p_user_id: userId,
          p_video_id: result.videoId,
          p_minutes_consumed: minutesNeeded
        });

      if (usageError) {
        logError('Failed to track video usage', usageError);
        // Continue anyway - we already uploaded the video
      } else {
        logSuccess('Usage tracked', usageResult);
      }
    } else {
      // Create a default FREE subscription if none exists (10 minutes)
      // Note: This shouldn't normally happen as subscriptions are auto-created on signup
      const newSubscription = {
        user_id: userId,
        plan_type: 'FREE',
        status: 'active',
        minutes_included: 10,
        minutes_used: 0, // Start at 0, will be updated by track_video_usage
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        stripe_customer_id: 'default_free'
      };

      const { data: createdSub, error: createError } = await supabase
        .from('subscriptions')
        .insert(newSubscription)
        .select()
        .single();

      if (createError) {
        logError('Failed to create subscription', createError);
      } else if (createdSub) {
        // Track usage using the RPC function
        const { data: usageResult, error: usageError } = await supabase
          .rpc('track_video_usage', {
            p_user_id: userId,
            p_video_id: result.videoId,
            p_minutes_consumed: minutesNeeded
          });

        if (usageError) {
          logError('Failed to track video usage for new subscription', usageError);
        } else {
          logSuccess('Usage tracked for new subscription', usageResult);
        }
      }
    }

    // Save thumbnails if provided
    const { uploadAnalysisFile } = await import('@/lib/r2');
    let thumbnailUploaded = false;

    // Helper function to extract format and data from data URL
    const parseThumbnailData = (dataUrl: string) => {
      const match = dataUrl.match(/^data:image\/(jpeg|jpg|webp);base64,(.+)$/);
      if (!match) return null;
      const format = match[1] === 'jpg' ? 'jpeg' : match[1];
      const base64Data = match[2];
      const buffer = Buffer.from(base64Data, 'base64');
      const mimeType = `image/${format}`;
      return { buffer, format, mimeType };
    };

    // Try to upload multi-resolution thumbnails
    if (thumbnailSmall || thumbnailMedium || thumbnailLarge) {
      try {
        const uploadPromises: Promise<void>[] = [];

        if (thumbnailSmall) {
          const parsed = parseThumbnailData(thumbnailSmall);
          if (parsed) {
            uploadPromises.push(
              uploadAnalysisFile(userId, result.videoId, `thumbnail-sm.${parsed.format}`, parsed.buffer, parsed.mimeType)
            );
          }
        }

        if (thumbnailMedium) {
          const parsed = parseThumbnailData(thumbnailMedium);
          if (parsed) {
            uploadPromises.push(
              uploadAnalysisFile(userId, result.videoId, `thumbnail.${parsed.format}`, parsed.buffer, parsed.mimeType)
            );
          }
        }

        if (thumbnailLarge) {
          const parsed = parseThumbnailData(thumbnailLarge);
          if (parsed) {
            uploadPromises.push(
              uploadAnalysisFile(userId, result.videoId, `thumbnail-lg.${parsed.format}`, parsed.buffer, parsed.mimeType)
            );
          }
        }

        await Promise.all(uploadPromises);
        thumbnailUploaded = true;
        logSuccess('Multi-resolution thumbnails uploaded successfully', { videoId: result.videoId, count: uploadPromises.length });
      } catch (thumbnailError) {
        logWarn('Failed to save multi-resolution thumbnails', thumbnailError);
      }
    }

    // Legacy single thumbnail support
    if (!thumbnailUploaded && thumbnail) {
      try {
        const parsed = parseThumbnailData(thumbnail);
        if (parsed) {
          await uploadAnalysisFile(userId, result.videoId, `thumbnail.${parsed.format}`, parsed.buffer, parsed.mimeType);
          thumbnailUploaded = true;
          logSuccess('Legacy thumbnail uploaded successfully', { videoId: result.videoId });
        }
      } catch (thumbnailError) {
        logWarn('Failed to save legacy thumbnail', thumbnailError);
      }
    }

    // If no thumbnails were uploaded, use default SVG
    if (!thumbnailUploaded) {
      try {
        const defaultThumbnail = createDefaultThumbnail();
        await uploadAnalysisFile(userId, result.videoId, 'thumbnail.svg', defaultThumbnail, 'image/svg+xml');
        logSuccess('Default SVG thumbnail uploaded');
      } catch (fallbackError) {
        logError('Failed to upload default thumbnail', fallbackError);
      }
    }

    // Log upload success
    logSuccess('Video uploaded successfully');
    logJobInfo({
      userId,
      videoId: result.videoId,
      fileName: fileName,
      fileSize: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
      estimatedDuration: `${estimatedDurationMinutes.toFixed(1)} min`,
      minutesConsumed: minutesNeeded.toFixed(2),
    });

    // Automatically trigger full video processing via RunPod
    // PHASE 1: Create pending job record (fast, reliable)
    try {
      const runpodEndpoint = process.env.RUNPOD_ENDPOINT_ID;
      const runpodApiKey = process.env.RUNPOD_API_KEY;

      if (runpodEndpoint && runpodApiKey) {
        const internalJobId = `unified-${result.videoId}-${Date.now()}`;

        // Create pending job record in database (fast, <100ms)
        const { createProcessingJob } = await import('@/lib/processing-jobs');

        const job = await createProcessingJob({
          jobId: internalJobId,
          userId: userId,
          videoId: result.videoId,
          jobType: 'unified_analysis',
          jobParams: {
            r2_key: r2Key
          }
        });

        if (job) {
          logSuccess('Pending job created', { jobId: internalJobId, videoId: result.videoId });

          // PHASE 2: Trigger the processing endpoint (fire-and-forget HTTP call)
          // This returns immediately but the separate endpoint will process the job
          const triggerUrl = process.env.NEXT_PUBLIC_APP_URL
            ? `${process.env.NEXT_PUBLIC_APP_URL}/api/trigger-pending-jobs`
            : `${request.headers.get('origin') || 'http://localhost:3000'}/api/trigger-pending-jobs`;

          // Non-blocking HTTP request to trigger Phase 2
          fetch(triggerUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'MintonixUploadTrigger/1.0'
            },
            body: JSON.stringify({ jobId: internalJobId })
          }).catch(err => {
            // If immediate trigger fails, cron job will pick it up
            logError('Failed to trigger job processor (cron will retry)', err);
          });

        } else {
          logError('Failed to create pending job record');
        }
      } else {
        logWarn('RunPod not configured - skipping auto-processing');
      }
    } catch (autoProcessError) {
      logError('Failed to create pending job', autoProcessError);
    }

    return NextResponse.json({
      success: true,
      video: result,
      videoRecord: videoRecord,
      auto_processing: true,
      minutes_consumed: minutesNeeded.toFixed(2),
      estimated_duration_minutes: estimatedDurationMinutes.toFixed(1)
    });
  } catch (error) {
    logError('Video upload failed', error);
    return NextResponse.json(
      { error: 'Upload failed' },
      { status: 500 }
    );
  }
}