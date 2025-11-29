import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { r2Client, getSessionFiles } from '@/lib/r2';
import { GetObjectCommand } from '@aws-sdk/client-s3';

export const runtime = 'nodejs';

const BUCKET_NAME = process.env.R2_BUCKET_NAME!;

// GET - Stream video for shared analysis (no authentication required)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    if (!token) {
      return NextResponse.json({ error: 'Invalid share link' }, { status: 400 });
    }

    // Use service role client to bypass RLS for public share access
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Find the share by token
    const { data: share, error: shareError } = await supabase
      .from('analysis_shares')
      .select('*')
      .eq('share_token', token)
      .single();

    if (shareError || !share) {
      return NextResponse.json({ error: 'Share link not found or expired' }, { status: 404 });
    }

    // Check if share has expired
    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Share link has expired' }, { status: 410 });
    }

    const { user_id: userId, video_id: videoId } = share;

    // Get session files to find the video
    const sessionFiles = await getSessionFiles(userId, videoId);

    // Prefer analyzed video, fallback to original
    const hasAnalyzedVideo = sessionFiles.some(f => f.fileName === 'analyzed_video.mp4');
    const videoFile = sessionFiles.find(f =>
      hasAnalyzedVideo
        ? f.fileName === 'analyzed_video.mp4'
        : f.fileName.startsWith('video.')
    );

    if (!videoFile) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    const key = videoFile.key;

    // Handle range requests for video streaming
    const range = request.headers.get('range');

    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Range: range || undefined,
    });

    const response = await r2Client.send(command);

    if (!response.Body) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    const headers = new Headers();
    headers.set('Content-Type', response.ContentType || 'video/mp4');
    headers.set('Accept-Ranges', 'bytes');

    if (response.ContentLength) {
      headers.set('Content-Length', response.ContentLength.toString());
    }
    if (response.ContentRange) {
      headers.set('Content-Range', response.ContentRange);
    }

    // Convert the response body to a ReadableStream
    const stream = response.Body.transformToWebStream();

    return new NextResponse(stream, {
      status: range ? 206 : 200,
      headers,
    });
  } catch (error) {
    console.error('Error streaming shared video:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
