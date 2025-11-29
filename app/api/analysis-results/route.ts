import { NextRequest, NextResponse } from 'next/server';
import { getSessionFiles } from '@/lib/r2';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT_URL,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME!;
// const R2_ENVIRONMENT = process.env.R2_ENVIRONMENT || 'dev';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const videoId = searchParams.get('videoId');
    const step = searchParams.get('step');

    if (!userId || !videoId || !step) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    // Get all files for this video session
    const files = await getSessionFiles(userId, videoId);
    
    if (step === 'calibration') {
      // Look for calibration summary file
      const summaryFile = files.find(f => f.fileName === 'calibration_summary.json');
      
      if (summaryFile) {
        try {
          // Fetch the summary data
          const command = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: summaryFile.key,
          });
          
          const response = await r2Client.send(command);
          const summaryText = await response.Body?.transformToString();
          const summary = summaryText ? JSON.parse(summaryText) : null;

          // Get download URLs for calibration files
          const calibrationFiles = files.filter(f => 
            f.fileName === 'court.csv' || 
            f.fileName === 'calibration.csv' ||
            f.fileName === 'calibration_summary.json'
          ).map(f => ({
            name: f.fileName,
            url: `/api/file-stream?key=${encodeURIComponent(f.key)}`
          }));

          // Look for additional calibration data files
          let detectedPoints = null;
          let calibrationData = null;
          
          // Try to get detected points from court.csv or from the Modal result
          if (summary?.detected_points) {
            detectedPoints = summary.detected_points;
          }
          
          if (summary?.calibration_data) {
            calibrationData = summary.calibration_data;
          }

          return NextResponse.json({
            summary,
            detected_points: detectedPoints,
            calibration_data: calibrationData,
            files: calibrationFiles,
            step
          });
        } catch (error) {
          console.error('Error reading calibration summary:', error);
          return NextResponse.json({
            error: 'Failed to read calibration results',
            files: files.filter(f => f.fileType === 'analysis').map(f => ({
              name: f.fileName,
              url: `/api/file-stream?key=${encodeURIComponent(f.key)}`
            }))
          });
        }
      } else {
        // No summary file found, just return file list
        const analysisFiles = files.filter(f => f.fileType === 'analysis').map(f => ({
          name: f.fileName,
          url: `/api/file-stream?key=${encodeURIComponent(f.key)}`
        }));

        return NextResponse.json({
          message: 'Calibration files available for download',
          files: analysisFiles,
          step
        });
      }
    }

    // For other steps, return basic file info
    const stepFiles = files.filter(f => f.fileType === 'analysis').map(f => ({
      name: f.fileName,
      url: `/api/file-stream?key=${encodeURIComponent(f.key)}`
    }));

    return NextResponse.json({
      message: `Results for ${step} step`,
      files: stepFiles,
      step
    });

  } catch (error) {
    console.error('Error fetching analysis results:', error);
    return NextResponse.json(
      { error: 'Failed to fetch analysis results' },
      { status: 500 }
    );
  }
}