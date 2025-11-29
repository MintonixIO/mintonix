import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Query videos from database (excluding soft-deleted)
    const { data: videos, error } = await supabase
      .from('videos')
      .select('*')
      .eq('user_id', userId)
      .is('deleted_at', null)  // Only non-deleted videos
      .order('uploaded_at', { ascending: false });

    if (error) {
      console.error('Error fetching videos from database:', error);
      return NextResponse.json(
        { error: 'Failed to fetch videos' },
        { status: 500 }
      );
    }

    // Transform database fields to match frontend expectations
    const transformedVideos = (videos || []).map(video => ({
      key: video.r2_key,
      fileName: video.display_filename,
      size: video.file_size_bytes,
      uploadedAt: video.uploaded_at,
      userId: video.user_id,
      videoId: video.video_id,
      status: video.status
    }));

    return NextResponse.json({
      success: true,
      videos: transformedVideos
    });
  } catch (error) {
    console.error('Error fetching videos:', error);
    return NextResponse.json(
      { error: 'Failed to fetch videos' },
      { status: 500 }
    );
  }
}