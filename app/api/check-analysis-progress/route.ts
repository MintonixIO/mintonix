import { NextRequest, NextResponse } from 'next/server';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { r2Client } from '@/lib/r2';

// Real-time monitoring endpoint - checks R2 files directly
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const videoId = searchParams.get('videoId');

    if (!userId || !videoId) {
      return NextResponse.json(
        { error: 'Missing userId or videoId' },
        { status: 400 }
      );
    }

    const environment = process.env.R2_ENVIRONMENT || 'dev';
    const bucketName = process.env.R2_BUCKET_NAME!;

    // Check for existence of key files that indicate step completion
    const filesToCheck = [
      { step: 'calibration', file: 'calibration.csv' },
      { step: 'pose', file: 'pose.json' },
      { step: 'shuttle', file: 'shuttle.json' },
      { step: 'positions', file: 'corrected_positions.json' },
      { step: 'visualization', file: 'analyzed_video.mp4' }
    ];

    const results: Record<string, boolean> = {};

    for (const { step, file } of filesToCheck) {
      const key = `${environment}/${userId}/${videoId}/${file}`;

      try {
        const command = new HeadObjectCommand({
          Bucket: bucketName,
          Key: key,
        });

        await r2Client.send(command);
        results[step] = true;
      } catch {
        // File doesn't exist yet
        results[step] = false;
      }
    }

    const allComplete = Object.values(results).every(v => v === true);

    return NextResponse.json({
      progress: results,
      allComplete,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Error checking analysis progress:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
