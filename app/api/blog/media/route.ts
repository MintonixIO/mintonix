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
      return NextResponse.json({ error: 'Missing key parameter' }, { status: 400 });
    }

    // Validate that the key is for blog media
    if (!key.includes('/blog/media/')) {
      return NextResponse.json({ error: 'Invalid media key' }, { status: 403 });
    }

    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const response = await r2Client.send(command);

    if (!response.Body) {
      return NextResponse.json({ error: 'Media not found' }, { status: 404 });
    }

    // Convert the stream to a buffer
    const buffer = Buffer.from(await response.Body.transformToByteArray());

    // Determine content type
    const contentType = response.ContentType || 'application/octet-stream';

    // Set appropriate headers
    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
    headers.set('Content-Length', buffer.length.toString());

    return new NextResponse(buffer, { headers });
  } catch (error) {
    console.error('Error serving blog media:', error);
    return NextResponse.json({ error: 'Failed to serve media' }, { status: 500 });
  }
}