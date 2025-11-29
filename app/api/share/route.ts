import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import crypto from 'crypto';

// POST - Create a share link for a video
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { videoId } = await request.json();

    if (!videoId) {
      return NextResponse.json({ error: 'Video ID is required' }, { status: 400 });
    }

    // Generate a secure share token
    const shareToken = crypto.randomBytes(32).toString('base64url');

    // Check if share already exists for this video
    const { data: existingShare } = await supabase
      .from('analysis_shares')
      .select('share_token')
      .eq('user_id', user.id)
      .eq('video_id', videoId)
      .single();

    if (existingShare) {
      // Return existing share token
      const shareUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/share/${existingShare.share_token}`;
      return NextResponse.json({
        shareToken: existingShare.share_token,
        shareUrl,
        isExisting: true
      });
    }

    // Create new share
    const { data: newShare, error: insertError } = await supabase
      .from('analysis_shares')
      .insert({
        user_id: user.id,
        video_id: videoId,
        share_token: shareToken,
      })
      .select('share_token')
      .single();

    if (insertError) {
      console.error('Error creating share:', insertError);
      return NextResponse.json({ error: 'Failed to create share link' }, { status: 500 });
    }

    const shareUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/share/${newShare.share_token}`;

    return NextResponse.json({
      shareToken: newShare.share_token,
      shareUrl,
      isExisting: false
    });
  } catch (error) {
    console.error('Error in share API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET - Get share info for a video (checks if it's already shared)
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get('videoId');

    if (!videoId) {
      return NextResponse.json({ error: 'Video ID is required' }, { status: 400 });
    }

    const { data: share } = await supabase
      .from('analysis_shares')
      .select('share_token, created_at, view_count')
      .eq('user_id', user.id)
      .eq('video_id', videoId)
      .single();

    if (!share) {
      return NextResponse.json({ shared: false });
    }

    const shareUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/share/${share.share_token}`;

    return NextResponse.json({
      shared: true,
      shareToken: share.share_token,
      shareUrl,
      createdAt: share.created_at,
      viewCount: share.view_count,
    });
  } catch (error) {
    console.error('Error in share API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE - Revoke a share link
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { videoId } = await request.json();

    if (!videoId) {
      return NextResponse.json({ error: 'Video ID is required' }, { status: 400 });
    }

    const { error: deleteError } = await supabase
      .from('analysis_shares')
      .delete()
      .eq('user_id', user.id)
      .eq('video_id', videoId);

    if (deleteError) {
      console.error('Error deleting share:', deleteError);
      return NextResponse.json({ error: 'Failed to revoke share link' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in share API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
