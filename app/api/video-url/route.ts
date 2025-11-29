import { NextRequest, NextResponse } from 'next/server';
import { getSignedVideoUrl } from '@/lib/r2';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (!key) {
      return NextResponse.json(
        { error: 'Missing key parameter' },
        { status: 400 }
      );
    }

    // Generate signed URL from R2
    const signedUrl = await getSignedVideoUrl(key);

    return NextResponse.json({
      url: signedUrl,
      expiresIn: 3600 // 1 hour
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to generate video URL' },
      { status: 500 }
    );
  }
}
