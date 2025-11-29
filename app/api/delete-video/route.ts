import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

// Note: r2Client, DeleteObjectCommand, ListObjectsV2Command, BUCKET_NAME, and R2_ENVIRONMENT
// are commented out but kept for future hard-delete functionality
// import { S3Client, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
// const r2Client = new S3Client({
//   region: 'auto',
//   endpoint: process.env.R2_ENDPOINT_URL,
//   credentials: {
//     accessKeyId: process.env.R2_ACCESS_KEY_ID!,
//     secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
//   },
// });
// const BUCKET_NAME = process.env.R2_BUCKET_NAME!;
// const R2_ENVIRONMENT = process.env.R2_ENVIRONMENT || 'dev';

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get('videoId');

    if (!videoId) {
      return NextResponse.json(
        { error: 'Missing videoId' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error('Authentication error:', authError);
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    console.log('Delete request - User ID:', user.id, 'Video ID:', videoId);

    // First, verify the video exists and belongs to the user
    const { data: existingVideo, error: fetchError } = await supabase
      .from('videos')
      .select('video_id, user_id, status')
      .eq('video_id', videoId)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !existingVideo) {
      console.error('Video not found or access denied:', fetchError);
      return NextResponse.json(
        { error: 'Video not found or access denied' },
        { status: 404 }
      );
    }

    console.log('Existing video:', existingVideo);

    // Soft delete in database (sets deleted_at timestamp)
    // This will cascade delete to analysis_shares and processing_jobs via FK constraints
    // Use admin client to bypass RLS (safe because we verified ownership above)
    const adminClient = createAdminClient();
    const { data: updateData, error: dbError } = await adminClient
      .from('videos')
      .update({
        deleted_at: new Date().toISOString(),
        status: 'deleted'
      })
      .eq('video_id', videoId)
      .eq('user_id', user.id)
      .select();

    console.log('Update result:', { updateData, dbError });

    if (dbError) {
      console.error('Error soft-deleting video from database:', dbError);
      return NextResponse.json(
        { error: 'Failed to delete video from database' },
        { status: 500 }
      );
    }

    // Optionally: Hard delete from R2 (uncomment if you want to delete files immediately)
    // For now, we'll keep files in R2 for recovery/audit purposes
    /*
    const listCommand = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: `${R2_ENVIRONMENT}/${userId}/${videoId}/`,
      MaxKeys: 100,
    });

    const response = await r2Client.send(listCommand);

    if (response.Contents) {
      for (const file of response.Contents) {
        if (file.Key) {
          const deleteCommand = new DeleteObjectCommand({
            Bucket: BUCKET_NAME,
            Key: file.Key,
          });
          await r2Client.send(deleteCommand);
        }
      }
    }
    */

    return NextResponse.json({
      success: true,
      message: 'Video soft-deleted successfully (marked as deleted in database)'
    });
  } catch (error) {
    console.error('Error deleting video:', error);
    return NextResponse.json(
      { error: 'Failed to delete video' },
      { status: 500 }
    );
  }
}