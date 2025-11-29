import { NextRequest, NextResponse } from 'next/server';
import { S3Client, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT_URL,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME!;
const R2_ENVIRONMENT = process.env.R2_ENVIRONMENT || 'dev';

export async function DELETE(request: NextRequest) {
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

    // List all files in the video folder
    const listCommand = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: `${R2_ENVIRONMENT}/${userId}/${videoId}/`,
      MaxKeys: 100,
    });

    const response = await r2Client.send(listCommand);
    
    if (response.Contents) {
      // Delete all analysis files (keep only video files)
      const filesToDelete = response.Contents.filter(obj => 
        obj.Key && 
        !obj.Key.includes('/video.') // Keep video files, delete analysis files
      );

      for (const file of filesToDelete) {
        if (file.Key) {
          const deleteCommand = new DeleteObjectCommand({
            Bucket: BUCKET_NAME,
            Key: file.Key,
          });
          await r2Client.send(deleteCommand);
        }
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Analysis files deleted successfully' 
    });
  } catch (error) {
    console.error('Error deleting analysis files:', error);
    return NextResponse.json(
      { error: 'Failed to delete analysis files' },
      { status: 500 }
    );
  }
}