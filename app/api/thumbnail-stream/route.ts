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
          <stop offset="0%" style="stop-color:#1e1e1e"/>
          <stop offset="100%" style="stop-color:#0a0a0a"/>
        </linearGradient>
        <filter id="blur">
          <feGaussianBlur in="SourceGraphic" stdDeviation="4"/>
        </filter>
        <filter id="innerGlow">
          <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>

      <!-- Background gradient -->
      <rect width="100%" height="100%" fill="url(#bg)"/>

      <!-- Subtle noise texture -->
      <rect width="100%" height="100%" fill="url(#bg)" opacity="0.05"/>

      <!-- Large frosted glass rectangle (background blur) -->
      <rect x="210" y="100" width="220" height="160" rx="16" fill="#2a2a2a" opacity="0.3" filter="url(#blur)"/>

      <!-- Medium frosted glass rectangle -->
      <rect x="215" y="105" width="210" height="150" rx="14" fill="#252525" opacity="0.4" filter="url(#blur)"/>

      <!-- Glass border -->
      <rect x="215" y="105" width="210" height="150" rx="14" fill="none" stroke="#404040" stroke-width="1" opacity="0.6"/>

      <!-- Inner glow effect -->
      <rect x="220" y="110" width="200" height="140" rx="12" fill="none" stroke="#505050" stroke-width="0.5" opacity="0.3"/>

      <!-- Center play button container -->
      <rect x="255" y="135" width="130" height="90" rx="10" fill="#1a1a1a" opacity="0.7" filter="url(#innerGlow)"/>

      <!-- Play button outer border -->
      <rect x="255" y="135" width="130" height="90" rx="10" fill="none" stroke="#505050" stroke-width="2" opacity="0.5"/>

      <!-- Play button inner border (highlight) -->
      <rect x="258" y="138" width="124" height="84" rx="8" fill="none" stroke="#606060" stroke-width="1" opacity="0.3"/>

      <!-- Play icon triangle -->
      <path d="M 300 160 L 300 200 L 345 180 Z" fill="#e0e0e0" opacity="0.9"/>

      <!-- Subtle highlight on play icon -->
      <path d="M 303 165 L 303 195 L 335 180 Z" fill="#ffffff" opacity="0.15"/>

      <!-- Subtle top-left light reflection -->
      <ellipse cx="260" cy="130" rx="40" ry="25" fill="#ffffff" opacity="0.03" filter="url(#blur)"/>
    </svg>
  `;

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=604800, immutable',
    },
  });
}