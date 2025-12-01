import { NextRequest, NextResponse } from 'next/server';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

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

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');
    const size = searchParams.get('size') || 'medium'; // small, medium, large

    if (!key) {
      return NextResponse.json(
        { error: 'Missing key parameter' },
        { status: 400 }
      );
    }

    // Parse the key to extract userId and videoId
    // Expected format: dev/{userId}/{videoId}/thumbnail.jpg or similar
    const keyParts = key.split('/');
    const videoId = keyParts.length >= 3 ? keyParts[keyParts.length - 2] : null;
    const userId = keyParts.length >= 3 ? keyParts[keyParts.length - 3] : null;

    if (!userId || !videoId) {
      console.warn('Could not extract userId/videoId from key:', key);
      return createDefaultThumbnail();
    }

    // Build smart fallback chain based on requested size
    const r2Environment = process.env.R2_ENVIRONMENT || 'dev';
    const basePath = `${r2Environment}/${userId}/${videoId}`;

    const thumbnailKeys = (() => {
      switch (size) {
        case 'small':
          return [
            `${basePath}/thumbnail-sm.webp`,
            `${basePath}/thumbnail-sm.jpeg`,
            `${basePath}/thumbnail.webp`,
            `${basePath}/thumbnail.jpeg`,
            `${basePath}/thumbnail.jpg`,
            `${basePath}/thumbnail.svg`,
          ];
        case 'large':
          return [
            `${basePath}/thumbnail-lg.webp`,
            `${basePath}/thumbnail-lg.jpeg`,
            `${basePath}/thumbnail.webp`,
            `${basePath}/thumbnail.jpeg`,
            `${basePath}/thumbnail.jpg`,
            `${basePath}/thumbnail.svg`,
          ];
        case 'medium':
        default:
          return [
            `${basePath}/thumbnail.webp`,
            `${basePath}/thumbnail.jpeg`,
            `${basePath}/thumbnail.jpg`,
            `${basePath}/thumbnail-sm.webp`,
            `${basePath}/thumbnail-sm.jpeg`,
            `${basePath}/thumbnail.svg`,
          ];
      }
    })();

    // Try each thumbnail key in order until one is found
    for (const thumbnailKey of thumbnailKeys) {
      try {
        const command = new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: thumbnailKey,
        });

        const response = await r2Client.send(command);

        if (response.Body) {
          const stream = response.Body as ReadableStream;

          return new NextResponse(stream, {
            headers: {
              'Content-Type': response.ContentType || 'image/jpeg',
              'Cache-Control': 'public, max-age=604800, immutable', // 7 days cache
              'ETag': `"${videoId}-${thumbnailKey.split('/').pop()}"`,
            },
          });
        }
      } catch {
        // Try next key
        continue;
      }
    }

    // If no thumbnail found, return default
    console.log('No thumbnail found for video:', videoId);
    return createDefaultThumbnail();
  } catch (error) {
    console.error('Error serving thumbnail:', error);
    return createDefaultThumbnail();
  }
}

function createDefaultThumbnail() {
  const svg = `
    <svg width="640" height="360" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#1a1a1a"/>
          <stop offset="100%" style="stop-color:#2d2d2d"/>
        </linearGradient>
        <filter id="shadow">
          <feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.3"/>
        </filter>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)"/>

      <!-- Grid pattern -->
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#404040" stroke-width="0.5" opacity="0.3"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid)"/>

      <!-- Center play icon -->
      <g filter="url(#shadow)">
        <circle cx="320" cy="180" r="50" fill="#2d2d2d" stroke="#505050" stroke-width="2"/>
        <circle cx="320" cy="180" r="48" fill="none" stroke="#606060" stroke-width="1" opacity="0.5"/>
        <polygon points="305,165 305,195 340,180" fill="#e5e5e5"/>
      </g>

      <!-- Bottom text -->
      <text x="320" y="280" text-anchor="middle" fill="#9ca3af" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="500" letter-spacing="0.5">
        Video Analysis
      </text>
      <text x="320" y="305" text-anchor="middle" fill="#6b7280" font-family="system-ui, -apple-system, sans-serif" font-size="13" opacity="0.8">
        Thumbnail unavailable
      </text>
    </svg>
  `;

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}