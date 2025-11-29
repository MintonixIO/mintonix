import { NextRequest, NextResponse } from 'next/server';
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { r2Client } from '@/lib/r2';

export const runtime = 'nodejs';

const BUCKET_NAME = process.env.R2_BUCKET_NAME!;

// HEAD request handler for pre-flight checks
export async function HEAD(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    console.log(`[VIDEO-STREAM HEAD] Request for key: ${key}`);

    if (!key) {
      console.error('[VIDEO-STREAM HEAD] Missing key parameter');
      return new NextResponse(null, { status: 400 });
    }

    const command = new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    console.log(`[VIDEO-STREAM HEAD] Checking file in bucket: ${BUCKET_NAME}, key: ${key}`);
    const response = await r2Client.send(command);
    console.log(`[VIDEO-STREAM HEAD] File exists - Size: ${response.ContentLength} bytes`);

    return new NextResponse(null, {
      status: 200,
      headers: {
        'Content-Type': response.ContentType || 'video/mp4',
        'Content-Length': response.ContentLength?.toString() || '0',
        'Accept-Ranges': 'bytes',
      },
    });
  } catch (error: unknown) {
    console.error('[VIDEO-STREAM HEAD] Error:', error);

    if (error && typeof error === 'object') {
      console.error('[VIDEO-STREAM HEAD] Error details:', {
        name: 'name' in error ? error.name : 'unknown',
        message: error instanceof Error ? error.message : 'unknown',
        code: 'Code' in error ? error.Code : 'unknown'
      });
    }

    if (error && typeof error === 'object' && 'name' in error) {
      if (error.name === 'NoSuchKey' || ('Code' in error && error.Code === 'NoSuchKey')) {
        console.error('[VIDEO-STREAM HEAD] File not found in R2 bucket');
        return new NextResponse(null, { status: 404 });
      }
    }
    return new NextResponse(null, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');
    const download = searchParams.get('download') === 'true';
    const filename = searchParams.get('filename');

    console.log(`[VIDEO-STREAM] Request for key: ${key}`);

    if (!key) {
      console.error('[VIDEO-STREAM] Missing key parameter');
      return NextResponse.json(
        { error: 'Missing key parameter' },
        { status: 400 }
      );
    }

    // Get the Range header for partial content requests (required for video streaming)
    const rangeHeader = request.headers.get('range');

    // First, get the file metadata to know the total size
    const headCommand = new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    console.log(`[VIDEO-STREAM] Fetching metadata from bucket: ${BUCKET_NAME}, key: ${key}`);
    const headResponse = await r2Client.send(headCommand);
    const fileSize = headResponse.ContentLength || 0;
    const contentType = headResponse.ContentType || 'video/mp4';
    console.log(`[VIDEO-STREAM] File found - Size: ${fileSize} bytes, Type: ${contentType}`);

    // Handle Range requests (required for video streaming)
    if (rangeHeader) {
      // Parse range header: "bytes=0-1023"
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (!match) {
        return NextResponse.json(
          { error: 'Invalid range header' },
          { status: 416 }
        );
      }

      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

      // Validate range
      if (start >= fileSize || end >= fileSize || start > end) {
        return new NextResponse(null, {
          status: 416,
          headers: {
            'Content-Range': `bytes */${fileSize}`,
          },
        });
      }

      const chunkSize = end - start + 1;

      // Get the requested range from R2
      const getCommand = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Range: `bytes=${start}-${end}`,
      });

      const response = await r2Client.send(getCommand);

      if (!response.Body) {
        return NextResponse.json(
          { error: 'Video not found' },
          { status: 404 }
        );
      }

      // Convert AWS SDK stream to Web Stream for browser compatibility
      if (!response.Body) {
        throw new Error('No response body from R2');
      }

      // Transform the AWS SDK stream to a web-compatible stream
      const webStream = response.Body.transformToWebStream();

      const headers: Record<string, string> = {
        'Content-Type': contentType,
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize.toString(),
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Content-Type',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
      };

      return new NextResponse(webStream, {
        status: 206,
        headers
      });
    } else {
      // No range header - return entire file (for downloads)
      const getCommand = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      });

      const response = await r2Client.send(getCommand);

      if (!response.Body) {
        return NextResponse.json(
          { error: 'Video not found' },
          { status: 404 }
        );
      }

      if (!response.Body) {
        throw new Error('No response body from R2');
      }

      // Transform the AWS SDK stream to a web-compatible stream
      const webStream = response.Body.transformToWebStream();

      const headers: Record<string, string> = {
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Content-Length': fileSize.toString(),
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Content-Type',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
      };

      // Add Content-Disposition header for downloads
      if (download) {
        const downloadFilename = filename || 'video.mp4';
        headers['Content-Disposition'] = `attachment; filename="${downloadFilename}"`;
      }

      return new NextResponse(webStream, { headers });
    }
  } catch (error: unknown) {
    // Log the full error for debugging
    console.error('[VIDEO-STREAM] Error streaming video:', error);

    // Log detailed error information
    if (error && typeof error === 'object') {
      console.error('[VIDEO-STREAM] Error details:', {
        name: 'name' in error ? error.name : 'unknown',
        message: error instanceof Error ? error.message : 'unknown',
        code: 'Code' in error ? error.Code : 'unknown',
        statusCode: '$metadata' in error && error.$metadata && typeof error.$metadata === 'object' && 'httpStatusCode' in error.$metadata
          ? error.$metadata.httpStatusCode
          : 'unknown'
      });
    }

    // Check if it's a NoSuchKey error (file not found)
    if (error && typeof error === 'object' && 'name' in error) {
      if (error.name === 'NoSuchKey' || ('Code' in error && error.Code === 'NoSuchKey')) {
        console.error('[VIDEO-STREAM] File not found in R2 bucket');
        return NextResponse.json(
          { error: 'Video file not found. It may still be processing.' },
          { status: 404 }
        );
      }
    }

    // Check for credential errors
    if (error && typeof error === 'object' && 'name' in error) {
      if (error.name === 'InvalidAccessKeyId' || error.name === 'SignatureDoesNotMatch') {
        console.error('[VIDEO-STREAM] R2 authentication error - check credentials');
        return NextResponse.json(
          { error: 'Storage authentication error' },
          { status: 500 }
        );
      }
    }

    // Return more detailed error info in development
    const errorMessage = error instanceof Error ? error.message : 'Failed to stream video';
    const errorDetails = process.env.NODE_ENV === 'development'
      ? { error: errorMessage, details: error }
      : { error: 'Failed to stream video' };

    return NextResponse.json(
      errorDetails,
      { status: 500 }
    );
  }
}
