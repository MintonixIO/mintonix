import { NextRequest, NextResponse } from 'next/server';
import { completeMultipartUpload, verifyUpload, getSignedVideoUrl } from '@/lib/r2';
import { createClient } from '@/lib/supabase/server';
import { logSuccess, logError } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 60;

function estimateVideoDuration(fileSize: number): number {
  const fileSizeMB = fileSize / (1024 * 1024);
  const estimatedMinutes = fileSizeMB / 15;
  return Math.min(Math.max(estimatedMinutes, 0.5), 60);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, videoId, r2Key, uploadId, parts, thumbnail, isMultipart } = body;

    if (!userId || !videoId || !r2Key) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // If multipart, complete the upload
    if (isMultipart) {
      if (!uploadId || !parts || !Array.isArray(parts)) {
        return NextResponse.json(
          { error: 'Multipart upload requires uploadId and parts' },
          { status: 400 }
        );
      }

      await completeMultipartUpload(r2Key, uploadId, parts);
    }

    // Verify upload with retries
    let verificationResult: { exists: boolean; size?: number } = { exists: false };
    for (let i = 0; i < 5; i++) {
      verificationResult = await verifyUpload(r2Key);
      if (verificationResult.exists) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (!verificationResult.exists) {
      logError('Upload verification failed after 5 retries');

      // Update video status to failed
      await supabase
        .from('videos')
        .update({ status: 'failed' })
        .eq('video_id', videoId);

      return NextResponse.json(
        { error: 'Upload verification failed' },
        { status: 500 }
      );
    }

    // Update video record to "uploaded" status
    const { data: videoRecord, error: updateError } = await supabase
      .from('videos')
      .update({ status: 'uploaded' })
      .eq('video_id', videoId)
      .select()
      .single();

    if (updateError) {
      logError('Failed to update video status', updateError);
      return NextResponse.json(
        { error: 'Failed to update video status' },
        { status: 500 }
      );
    }

    // Get file size from verification
    const fileSize = verificationResult.size ?? 0;
    const estimatedDurationMinutes = estimateVideoDuration(fileSize);

    // Deduct usage minutes
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (subscription) {
      const { error: usageError } = await supabase
        .rpc('track_video_usage', {
          p_user_id: userId,
          p_video_id: videoId,
          p_minutes_consumed: estimatedDurationMinutes
        });

      if (usageError) {
        logError('Failed to track video usage', usageError);
      }
    }

    // Save thumbnail if provided
    if (thumbnail) {
      try {
        const base64Data = thumbnail.replace(/^data:image\/jpeg;base64,/, '');
        const thumbnailBuffer = Buffer.from(base64Data, 'base64');
        const { uploadAnalysisFile } = await import('@/lib/r2');
        await uploadAnalysisFile(userId, videoId, 'thumbnail.jpg', thumbnailBuffer, 'image/jpeg');
      } catch (thumbnailError) {
        logError('Failed to save thumbnail', thumbnailError);
      }
    }

    // Trigger RunPod processing
    try {
      const runpodEndpoint = process.env.RUNPOD_ENDPOINT_ID;
      const runpodApiKey = process.env.RUNPOD_API_KEY;

      if (runpodEndpoint && runpodApiKey) {
        (async () => {
          try {
            const signedVideoUrl = await getSignedVideoUrl(r2Key);

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
                  video_id: videoId
                }
              })
            });

            if (runpodResponse.ok) {
              logSuccess('Auto-processing initiated', { videoId });
            }
          } catch (error) {
            logError('Auto-processing failed', error);
          }
        })();
      }
    } catch (error) {
      logError('Failed to trigger auto-processing', error);
    }

    logSuccess('Upload completed', { userId, videoId, fileSize: `${(fileSize / 1024 / 1024).toFixed(2)} MB` });

    return NextResponse.json({
      success: true,
      videoId,
      videoRecord,
      minutes_consumed: estimatedDurationMinutes.toFixed(2),
    });

  } catch (error) {
    logError('Upload completion failed', error);
    return NextResponse.json(
      { error: 'Failed to complete upload' },
      { status: 500 }
    );
  }
}
