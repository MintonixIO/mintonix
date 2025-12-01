import { NextRequest, NextResponse } from 'next/server';
import { abortMultipartUpload } from '@/lib/r2';
import { createClient } from '@/lib/supabase/server';
import { logWarn } from '@/lib/logger';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { videoId, r2Key, uploadId, isMultipart } = body;

    if (!videoId || !r2Key) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Abort multipart upload if applicable
    if (isMultipart && uploadId) {
      await abortMultipartUpload(r2Key, uploadId);
    }

    // Update video status to failed/cancelled
    const supabase = await createClient();
    await supabase
      .from('videos')
      .update({ status: 'failed', deleted_at: new Date().toISOString() })
      .eq('video_id', videoId);

    logWarn('Upload aborted', { videoId, r2Key });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to abort upload' },
      { status: 500 }
    );
  }
}
