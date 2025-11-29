import { NextRequest, NextResponse } from 'next/server';
import { uploadVideo, getSignedVideoUrl } from '@/lib/r2';
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


export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const userId = formData.get('userId') as string;
    const fileName = formData.get('fileName') as string;
    const thumbnail = formData.get('thumbnail') as string;

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

    // Save thumbnail if provided
    if (thumbnail) {
      try {
        // Convert data URL to buffer
        const base64Data = thumbnail.replace(/^data:image\/jpeg;base64,/, '');
        const thumbnailBuffer = Buffer.from(base64Data, 'base64');

        // Upload thumbnail
        const { uploadAnalysisFile } = await import('@/lib/r2');
        await uploadAnalysisFile(userId, result.videoId, 'thumbnail.jpg', thumbnailBuffer, 'image/jpeg');
      } catch (thumbnailError) {
        logWarn('Failed to save thumbnail (continuing anyway)', thumbnailError);
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
    try {
      const runpodEndpoint = process.env.RUNPOD_ENDPOINT_ID;
      const runpodApiKey = process.env.RUNPOD_API_KEY;

      if (runpodEndpoint && runpodApiKey) {
        // Trigger async processing directly (no HTTP call needed)
        (async () => {
          try {
            // Get signed video URL (use same key as uploaded video)
            const signedVideoUrl = await getSignedVideoUrl(r2Key);

            // Construct webhook URL
            const webhookUrl = process.env.NEXT_PUBLIC_APP_URL
              ? `${process.env.NEXT_PUBLIC_APP_URL}/api/webhook`
              : 'http://localhost:3000/api/webhook';

            // Submit job to RunPod
            const runpodResponse = await fetch(`https://api.runpod.ai/v2/${runpodEndpoint}/run`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${runpodApiKey}`,
              },
              body: JSON.stringify({
                input: {
                  video_url: signedVideoUrl,
                  user_id: userId,
                  video_id: result.videoId,
                  webhook_url: webhookUrl
                }
              })
            });

            if (!runpodResponse.ok) {
              throw new Error(`RunPod API error: ${runpodResponse.status}`);
            }

            const runpodData = await runpodResponse.json();
            const runpodJobId = runpodData.id;
            const internalJobId = `unified-${result.videoId}-${Date.now()}`;

            // Python worker will create the processing job record
            logSuccess('Auto-processing initiated', { jobId: internalJobId, runpodJobId });
          } catch (error) {
            logError('Auto-processing failed', error);
          }
        })();
      } else {
        logWarn('RunPod not configured - skipping auto-processing');
      }
    } catch (autoProcessError) {
      logError('Failed to trigger auto-processing', autoProcessError);
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