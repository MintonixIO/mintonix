import { NextRequest, NextResponse } from 'next/server';
import { createPresignedUpload } from '@/lib/r2';
import { createClient } from '@/lib/supabase/server';
import { logDebug, logSuccess, logError, logWarn } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 30;

function estimateVideoDuration(fileSize: number): number {
  const fileSizeMB = fileSize / (1024 * 1024);
  const estimatedMinutes = fileSizeMB / 15; // 15MB per minute estimate
  return Math.min(Math.max(estimatedMinutes, 0.5), 60);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, fileName, fileSize, fileType } = body;

    // Validation
    if (!userId || !fileName || !fileSize || !fileType) {
      return NextResponse.json(
        { error: 'Missing required fields: userId, fileName, fileSize, fileType' },
        { status: 400 }
      );
    }

    if (!fileType.startsWith('video/')) {
      return NextResponse.json(
        { error: 'File must be a video type' },
        { status: 400 }
      );
    }

    if (fileSize <= 0) {
      return NextResponse.json(
        { error: 'Invalid file size' },
        { status: 400 }
      );
    }

    // Check user subscription and quota
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

    // Estimate duration and check quota
    const estimatedDurationMinutes = estimateVideoDuration(fileSize);
    const minutesNeeded = estimatedDurationMinutes;

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
          },
          { status: 429 }
        );
      }
    }

    // Generate presigned URLs
    const uploadInfo = await createPresignedUpload(userId, fileName, fileSize, fileType);

    // Pre-create database record with "uploading" status
    const { data: videoRecord, error: videoError } = await supabase
      .from('videos')
      .insert({
        video_id: uploadInfo.videoId,
        user_id: userId,
        r2_key: uploadInfo.r2Key,
        original_filename: fileName,
        display_filename: fileName,
        file_size_bytes: fileSize,
        status: 'uploading', // New status for in-progress uploads
        uploaded_at: new Date().toISOString()
      })
      .select()
      .single();

    if (videoError) {
      logError('Failed to create video record', videoError);
      return NextResponse.json(
        { error: 'Failed to create video record in database' },
        { status: 500 }
      );
    }

    logSuccess('Upload initialized', {
      userId,
      videoId: uploadInfo.videoId,
      fileName,
      fileSize: `${(fileSize / 1024 / 1024).toFixed(2)} MB`,
      isMultipart: uploadInfo.isMultipart,
      totalParts: uploadInfo.totalParts,
    });

    return NextResponse.json({
      success: true,
      uploadInfo,
      videoId: uploadInfo.videoId,
      estimatedDurationMinutes: estimatedDurationMinutes.toFixed(1),
    });

  } catch (error) {
    logError('Upload initialization failed', error);
    return NextResponse.json(
      { error: 'Failed to initialize upload' },
      { status: 500 }
    );
  }
}
