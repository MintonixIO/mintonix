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
    let key = searchParams.get('key');

    // Fallback: construct key from userId/videoId/fileName if key not provided
    if (!key) {
      const userId = searchParams.get('userId');
      const videoId = searchParams.get('videoId');
      const fileName = searchParams.get('fileName');
      
      if (userId && videoId && fileName) {
        const environment = process.env.R2_ENVIRONMENT || 'dev';
        key = `${environment}/${userId}/${videoId}/${fileName}`;
      }
    }

    if (!key) {
      return NextResponse.json(
        { error: 'Missing file key parameter or userId/videoId/fileName' },
        { status: 400 }
      );
    }

    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const response = await r2Client.send(command);
    
    if (!response.Body) {
      return NextResponse.json(
        { error: 'File not found' },
        { status: 404 }
      );
    }

    // Convert the stream to a buffer
    const chunks: Uint8Array[] = [];
    const reader = response.Body.transformToWebStream().getReader();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    
    const buffer = Buffer.concat(chunks);

    // Determine content type based on file extension
    const contentType = getContentType(key);
    
    // Get filename from key
    const filename = key.split('/').pop() || 'download';

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': buffer.length.toString(),
      },
    });

  } catch (error) {
    console.error('Error streaming file:', error);
    return NextResponse.json(
      { error: 'Failed to stream file' },
      { status: 500 }
    );
  }
}

function getContentType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop();
  
  switch (ext) {
    case 'csv':
      return 'text/csv';
    case 'json':
      return 'application/json';
    case 'txt':
      return 'text/plain';
    case 'pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}