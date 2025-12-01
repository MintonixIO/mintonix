import { NextRequest, NextResponse } from 'next/server';
import { uploadAnalysisFile } from '@/lib/r2';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const { userId, videoId, thumbnailData, size, format } = await request.json();

    if (!userId || !videoId || !thumbnailData) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Convert base64 data to buffer
    const thumbnailBuffer = Buffer.from(thumbnailData, 'base64');

    // Determine filename based on size and format
    const imageFormat = format || 'jpeg';
    const extension = imageFormat === 'jpeg' ? 'jpeg' : imageFormat;
    const mimeType = `image/${extension}`;

    let filename: string;
    if (size === 'small') {
      filename = `thumbnail-sm.${extension}`;
    } else if (size === 'large') {
      filename = `thumbnail-lg.${extension}`;
    } else {
      // Default/medium size
      filename = `thumbnail.${extension}`;
    }

    // Upload new thumbnail to R2, overwriting existing one
    await uploadAnalysisFile(userId, videoId, filename, thumbnailBuffer, mimeType);

    const r2Environment = process.env.R2_ENVIRONMENT || 'dev';
    return NextResponse.json({
      success: true,
      thumbnailKey: `${r2Environment}/${userId}/${videoId}/${filename}`,
      size,
      format: imageFormat,
    });
  } catch (error) {
    console.error('Error regenerating thumbnail:', error);
    return NextResponse.json(
      { error: 'Failed to regenerate thumbnail' },
      { status: 500 }
    );
  }
}