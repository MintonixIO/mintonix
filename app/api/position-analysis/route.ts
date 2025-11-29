import { NextRequest, NextResponse } from 'next/server';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { r2Client } from '@/lib/r2';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const videoId = searchParams.get('videoId');

    console.log(`Position analysis request: userId=${userId}, videoId=${videoId}`);

    if (!userId || !videoId) {
      return NextResponse.json(
        { error: 'Missing userId or videoId' },
        { status: 400 }
      );
    }

    // Try different possible keys for position analysis data
    const possibleKeys = [
      `${process.env.R2_ENVIRONMENT || 'dev'}/${userId}/${videoId}/position_analysis.json`,
      `dev/${userId}/${videoId}/position_analysis.json`,
    ];

    for (const analysisDataKey of possibleKeys) {
      try {
        console.log(`Trying to fetch position analysis from key: ${analysisDataKey}`);

        const command = new GetObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME!,
          Key: analysisDataKey,
        });

        const response = await r2Client.send(command);

        if (!response.Body) {
          console.log(`No body found for key: ${analysisDataKey}`);
          continue;
        }

        // Convert stream to string
        const bodyContents = await response.Body.transformToString();

        // Parse and return the JSON data
        // Handle invalid JSON (e.g., Infinity values) by sanitizing
        let analysisData;
        try {
          // First try direct parse
          analysisData = JSON.parse(bodyContents);
        } catch {
          // If parsing fails, try to sanitize the JSON
          console.log('Initial JSON parse failed, attempting to sanitize...');
          const sanitized = bodyContents
            .replace(/:\s*Infinity/g, ': null')
            .replace(/:\s*-Infinity/g, ': null')
            .replace(/:\s*NaN/g, ': null');
          analysisData = JSON.parse(sanitized);
          console.log('Successfully parsed sanitized JSON');
        }

        console.log(`Successfully loaded position analysis from key: ${analysisDataKey}`);
        console.log(`Players analyzed: ${Object.keys(analysisData.players || {}).length}`);

        return NextResponse.json(analysisData);

      } catch (r2Error) {
        console.log(`Error with key ${analysisDataKey}:`, r2Error);

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
      { error: 'Position analysis not available. Run analysis pipeline first.' },
      { status: 404 }
    );

  } catch (error) {
    console.error('Error fetching position analysis:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
