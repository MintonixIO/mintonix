import { NextRequest, NextResponse } from 'next/server';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { r2Client } from '@/lib/r2';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const videoId = searchParams.get('videoId');

    console.log(`Position data request: userId=${userId}, videoId=${videoId}`);

    if (!userId || !videoId) {
      return NextResponse.json(
        { error: 'Missing userId or videoId' },
        { status: 400 }
      );
    }

    // Try different possible keys for position data
    const possibleKeys = [
      `${process.env.R2_ENVIRONMENT || 'dev'}/${userId}/${videoId}/corrected_positions.json`,
      `dev/${userId}/${videoId}/corrected_positions.json`,
      `analysis/${userId}/${videoId}/unified_pose_position_artifacts.json`,
      `${process.env.R2_ENVIRONMENT || 'dev'}/${userId}/${videoId}/unified_pose_position_artifacts.json`
    ];
    
    for (const positionDataKey of possibleKeys) {
      try {
        console.log(`Trying to fetch position data from key: ${positionDataKey}`);
        
        const command = new GetObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME!,
          Key: positionDataKey,
        });

        const response = await r2Client.send(command);
        
        if (!response.Body) {
          console.log(`No body found for key: ${positionDataKey}`);
          continue;
        }

        // Convert stream to string
        const bodyContents = await response.Body.transformToString();
        
        // Parse and return the JSON data
        const positionData = JSON.parse(bodyContents);
        
        console.log(`Successfully loaded position data from key: ${positionDataKey}`);
        return NextResponse.json(positionData);
        
      } catch (r2Error) {
        console.log(`Error with key ${positionDataKey}:`, r2Error);
        
        if ((r2Error as Error & { name?: string }).name === 'NoSuchKey') {
          continue; // Try next key
        }
        
        // For other errors, log and continue
        console.error('R2 error:', r2Error);
        continue;
      }
    }

    // If we get here, none of the keys worked
    return NextResponse.json(
      { error: 'Position data not available. Run pose analysis first.' },
      { status: 404 }
    );

  } catch (error) {
    console.error('Error fetching position data:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}