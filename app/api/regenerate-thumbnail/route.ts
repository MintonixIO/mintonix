import { NextRequest, NextResponse } from 'next/server';
import { uploadAnalysisFile } from '@/lib/r2';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const { userId, videoId, thumbnailData } = await request.json();

    if (!userId || !videoId || !thumbnailData) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Convert base64 data to buffer
    const thumbnailBuffer = Buffer.from(thumbnailData, 'base64');
    
    // Upload new thumbnail to R2, overwriting existing one
    await uploadAnalysisFile(userId, videoId, 'thumbnail.jpg', thumbnailBuffer, 'image/jpeg');

    return NextResponse.json({ 
      success: true,
      thumbnailKey: `dev/${userId}/${videoId}/thumbnail.jpg`
    });
  } catch (error) {
    console.error('Error regenerating thumbnail:', error);
    return NextResponse.json(
      { error: 'Failed to regenerate thumbnail' },
      { status: 500 }
    );
  }
}