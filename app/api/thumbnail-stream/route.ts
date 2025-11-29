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

    if (!key) {
      return NextResponse.json(
        { error: 'Missing key parameter' },
        { status: 400 }
      );
    }

    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    try {
      const response = await r2Client.send(command);
      
      if (!response.Body) {
        return createDefaultThumbnail();
      }

      const stream = response.Body as ReadableStream;
      
      return new NextResponse(stream, {
        headers: {
          'Content-Type': response.ContentType || 'image/svg+xml',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    } catch {
      // If thumbnail doesn't exist, generate one and return it
      console.log('Thumbnail not found, generating default');
      return createDefaultThumbnail();
    }
  } catch (error) {
    console.error('Error serving thumbnail:', error);
    return createDefaultThumbnail();
  }
}

function createDefaultThumbnail() {
  const svg = `
    <svg width="320" height="180" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#4f46e5"/>
          <stop offset="100%" style="stop-color:#7c3aed"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)"/>
      <circle cx="160" cy="90" r="35" fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.4)" stroke-width="2"/>
      <polygon points="150,75 150,105 180,90" fill="white" opacity="0.9"/>
      <text x="160" y="130" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-size="12" opacity="0.7">Video Thumbnail</text>
    </svg>
  `;
  
  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}