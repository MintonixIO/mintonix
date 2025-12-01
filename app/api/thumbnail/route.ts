import { NextRequest, NextResponse } from 'next/server';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { uploadAnalysisFile } from '@/lib/r2';

export const runtime = 'nodejs';

const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT_URL,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME!;

export async function POST(request: NextRequest) {
  let userId: string | undefined, videoId: string | undefined, videoKey: string | undefined;
  
  try {
    ({ userId, videoId, videoKey } = await request.json());

    if (!userId || !videoId || !videoKey) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Get the video file from R2
    const videoCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: videoKey,
    });

    const videoResponse = await r2Client.send(videoCommand);
    
    if (!videoResponse.Body) {
      throw new Error('Video not found');
    }

    // For now, we'll create a placeholder thumbnail since video extraction requires ffmpeg
    // In production, you'd use ffmpeg or similar for server-side video processing
    const placeholderData = createPlaceholderThumbnail();
    
    // Upload placeholder thumbnail to R2
    await uploadAnalysisFile(userId, videoId, 'thumbnail.svg', placeholderData, 'image/svg+xml');

    return NextResponse.json({ 
      success: true,
      thumbnailKey: `dev/${userId}/${videoId}/thumbnail.svg`
    });
  } catch (error) {
    console.error('Error generating thumbnail:', error);
    
    // If we don't have userId/videoId, return error
    if (!userId || !videoId) {
      return NextResponse.json(
        { error: 'Failed to generate thumbnail - missing parameters' },
        { status: 500 }
      );
    }
    
    // Fallback to placeholder
    const placeholderData = createPlaceholderThumbnail();
    await uploadAnalysisFile(userId, videoId, 'thumbnail.svg', placeholderData, 'image/svg+xml');
    
    return NextResponse.json({ 
      success: true,
      thumbnailKey: `dev/${userId}/${videoId}/thumbnail.svg`
    });
  }
}

// Note: Real video thumbnail extraction would require ffmpeg or similar tool
// This function is commented out as it tries to use browser APIs in server environment
// async function extractVideoThumbnail(videoStream: ReadableStream): Promise<Buffer> {
//   // This would need to be implemented with server-side video processing
//   // like ffmpeg, not browser APIs
//   throw new Error('Video thumbnail extraction not implemented');
// }

function createPlaceholderThumbnail(): string {
  // Create a professional SVG placeholder thumbnail with gray/black/white palette
  const svg = `<svg width="640" height="360" xmlns="http://www.w3.org/2000/svg">
<defs>
  <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" style="stop-color:#1a1a1a"/>
    <stop offset="100%" style="stop-color:#2d2d2d"/>
  </linearGradient>
  <filter id="shadow">
    <feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.3"/>
  </filter>
  <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
    <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#404040" stroke-width="0.5" opacity="0.3"/>
  </pattern>
</defs>
<rect width="100%" height="100%" fill="url(#bg)"/>
<rect width="100%" height="100%" fill="url(#grid)"/>
<g filter="url(#shadow)">
  <circle cx="320" cy="180" r="50" fill="#2d2d2d" stroke="#505050" stroke-width="2"/>
  <circle cx="320" cy="180" r="48" fill="none" stroke="#606060" stroke-width="1" opacity="0.5"/>
  <polygon points="305,165 305,195 340,180" fill="#e5e5e5"/>
</g>
<text x="320" y="280" text-anchor="middle" fill="#9ca3af" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="500" letter-spacing="0.5">Video Analysis</text>
<text x="320" y="305" text-anchor="middle" fill="#6b7280" font-family="system-ui, -apple-system, sans-serif" font-size="13" opacity="0.8">Thumbnail unavailable</text>
</svg>`;

  return svg;
}