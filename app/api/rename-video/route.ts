import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: userData, error: authError } = await supabase.auth.getUser();

    if (authError || !userData.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { videoId, newFileName } = await request.json();

    if (!videoId || !newFileName) {
      return NextResponse.json({ error: 'Missing videoId or newFileName' }, { status: 400 });
    }

    // Validate new filename
    if (!newFileName.trim() || newFileName.length > 255) {
      return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
    }

    const userId = userData.user.id;

    // Update display_filename in videos table
    const { data: updatedVideo, error: updateError } = await supabase
      .from('videos')
      .update({
        display_filename: newFileName,
        updated_at: new Date().toISOString()
      })
      .eq('video_id', videoId)
      .eq('user_id', userId)
      .select()
      .single();

    if (updateError) {
      console.error('Error renaming video in database:', updateError);
      return NextResponse.json(
        { error: 'Failed to rename video' },
        { status: 500 }
      );
    }

    if (!updatedVideo) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: 'Video renamed successfully',
      newFileName,
      video: updatedVideo
    });

  } catch (error) {
    console.error('Error renaming video:', error);
    return NextResponse.json(
      { error: 'Failed to rename video' },
      { status: 500 }
    );
  }
}