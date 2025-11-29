import { NextRequest, NextResponse } from 'next/server';
import { S3Client, ListObjectsV2Command, HeadBucketCommand } from '@aws-sdk/client-s3';

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
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');

  if (!userId) {
    return NextResponse.json(
      { error: 'userId is required' },
      { status: 400 }
    );
  }

  try {
    const debugInfo: {
      config: {
        endpoint: string | undefined;
        bucket: string;
        hasAccessKey: boolean;
        hasSecretKey: boolean;
      };
      tests: Record<string, unknown>;
    } = {
      config: {
        endpoint: process.env.R2_ENDPOINT_URL,
        bucket: BUCKET_NAME,
        hasAccessKey: !!process.env.R2_ACCESS_KEY_ID,
        hasSecretKey: !!process.env.R2_SECRET_ACCESS_KEY,
      },
      tests: {}
    };

    // Test 1: Check if bucket exists
    try {
      const headBucketCommand = new HeadBucketCommand({ Bucket: BUCKET_NAME });
      await r2Client.send(headBucketCommand);
      debugInfo.tests.bucketExists = true;
    } catch (error: unknown) {
      debugInfo.tests.bucketExists = false;
      debugInfo.tests.bucketError = error instanceof Error ? error.message : 'Unknown error';
    }

    // Test 2: List all objects in bucket (no prefix)
    try {
      const listAllCommand = new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        MaxKeys: 10,
      });
      const allObjects = await r2Client.send(listAllCommand);
      debugInfo.tests.allObjects = {
        count: allObjects.Contents?.length || 0,
        objects: allObjects.Contents?.map(obj => ({
          key: obj.Key,
          size: obj.Size,
          lastModified: obj.LastModified
        })) || []
      };
    } catch (error: unknown) {
      debugInfo.tests.allObjects = { error: error instanceof Error ? error.message : 'Unknown error' };
    }

    // Test 3: List objects with user prefix
    try {
      const listUserCommand = new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: `users/${userId}/`,
        MaxKeys: 10,
      });
      const userObjects = await r2Client.send(listUserCommand);
      debugInfo.tests.userObjects = {
        prefix: `users/${userId}/`,
        count: userObjects.Contents?.length || 0,
        objects: userObjects.Contents?.map(obj => ({
          key: obj.Key,
          size: obj.Size,
          lastModified: obj.LastModified
        })) || []
      };
    } catch (error: unknown) {
      debugInfo.tests.userObjects = { error: error instanceof Error ? error.message : 'Unknown error' };
    }

    // Test 4: List objects with video prefix
    try {
      const listVideoCommand = new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: `users/${userId}/videos/`,
        MaxKeys: 10,
      });
      const videoObjects = await r2Client.send(listVideoCommand);
      debugInfo.tests.videoObjects = {
        prefix: `users/${userId}/videos/`,
        count: videoObjects.Contents?.length || 0,
        objects: videoObjects.Contents?.map(obj => ({
          key: obj.Key,
          size: obj.Size,
          lastModified: obj.LastModified
        })) || []
      };
    } catch (error: unknown) {
      debugInfo.tests.videoObjects = { error: error instanceof Error ? error.message : 'Unknown error' };
    }

    return NextResponse.json(debugInfo);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      { error: errorMessage, stack: errorStack },
      { status: 500 }
    );
  }
}