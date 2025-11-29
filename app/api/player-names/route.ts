import { NextRequest, NextResponse } from 'next/server';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { r2Client } from '@/lib/r2';

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

    const key = `${process.env.R2_ENVIRONMENT || 'dev'}/${userId}/${videoId}/player_names.json`;

    try {
      const command = new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: key,
      });

      const response = await r2Client.send(command);

      if (!response.Body) {
        // No player names saved yet, return empty object
        return NextResponse.json({});
      }

      const bodyContents = await response.Body.transformToString();
      const playerNames = JSON.parse(bodyContents);

      return NextResponse.json(playerNames);

    } catch (r2Error) {
      const errorWithName = r2Error as Error & { name?: string };
      if (errorWithName.name === 'NoSuchKey') {
        // No player names saved yet, return empty object
        return NextResponse.json({});
      }
      throw r2Error;
    }

  } catch (error) {
    console.error('Error fetching player names:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId, videoId, playerNames } = await request.json();

    if (!userId || !videoId || !playerNames) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const key = `${process.env.R2_ENVIRONMENT || 'dev'}/${userId}/${videoId}/player_names.json`;

    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Body: JSON.stringify(playerNames),
      ContentType: 'application/json',
    });

    await r2Client.send(command);

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error saving player names:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
