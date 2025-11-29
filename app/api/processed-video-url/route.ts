import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { r2Client } from '@/lib/r2';
import { HeadObjectCommand } from '@aws-sdk/client-s3';

const BUCKET_NAME = process.env.R2_BUCKET_NAME!;
const R2_ENVIRONMENT = process.env.R2_ENVIRONMENT || 'dev';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: userData, error: authError } = await supabase.auth.getUser();

    if (authError || !userData.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get('videoId');

    if (!videoId) {
      return NextResponse.json({ error: 'videoId is required' }, { status: 400 });
    }

    const userId = userData.user.id;
    const key = `${R2_ENVIRONMENT}/${userId}/${videoId}/analyzed_video.mp4`;

    try {
      // Check if the processed video exists
      const headCommand = new HeadObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      });

      await r2Client.send(headCommand);

      // Return a proxy URL through our API instead of a direct signed URL
      const proxyUrl = `/api/video-stream?key=${encodeURIComponent(key)}`;

      return NextResponse.json({
        url: proxyUrl,
        exists: true
      });
    } catch (error: unknown) {
      // If file doesn't exist, return exists: false
      if (error && typeof error === 'object' && 'name' in error && error.name === 'NotFound') {
        return NextResponse.json({
          exists: false
        });
      }

      console.error('Error checking processed video:', error);
      return NextResponse.json({
        exists: false
      });
    }

  } catch (error) {
    console.error('Error getting processed video URL:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
