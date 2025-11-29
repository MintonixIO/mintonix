import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAnalysisFileContent, getSessionFiles } from '@/lib/r2';

// GET - Fetch shared analysis data (no authentication required)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    if (!token) {
      return NextResponse.json({ error: 'Invalid share link' }, { status: 400 });
    }

    // Use service role client to bypass RLS for public share access
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Find the share by token
    const { data: share, error: shareError } = await supabase
      .from('analysis_shares')
      .select('*')
      .eq('share_token', token)
      .single();

    if (shareError || !share) {
      return NextResponse.json({ error: 'Share link not found or expired' }, { status: 404 });
    }

    // Check if share has expired
    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Share link has expired' }, { status: 410 });
    }

    const { user_id: userId, video_id: videoId } = share;

    // Get session files to check what's available
    const sessionFiles = await getSessionFiles(userId, videoId);

    // Check if analysis is complete
    const hasAnalyzedVideo = sessionFiles.some(f => f.fileName === 'analyzed_video.mp4');
    const hasPositionAnalysis = sessionFiles.some(f => f.fileName === 'position_analysis.json');

    if (!hasPositionAnalysis) {
      return NextResponse.json({
        error: 'Analysis not yet complete for this video',
        analysisComplete: false
      }, { status: 202 });
    }

    // Fetch position analysis data
    let positionAnalysisData = null;
    try {
      const analysisContent = await getAnalysisFileContent(userId, videoId, 'position_analysis.json');
      positionAnalysisData = JSON.parse(analysisContent);
    } catch (error) {
      console.error('Error fetching position analysis:', error);
    }

    // Fetch player names
    let playerNames = {};
    try {
      const playerNamesContent = await getAnalysisFileContent(userId, videoId, 'player_names.json');
      playerNames = JSON.parse(playerNamesContent);
    } catch {
      // Player names file might not exist, that's okay
    }

    // Get video metadata
    const videoFile = sessionFiles.find(f => f.fileName.startsWith('video.'));
    const videoKey = videoFile?.key || `${process.env.R2_ENVIRONMENT || 'dev'}/${userId}/${videoId}/video.mp4`;

    // Increment view count (fire and forget)
    const { error: updateError } = await supabase
      .from('analysis_shares')
      .update({ view_count: (share.view_count || 0) + 1 })
      .eq('share_token', token);

    if (updateError) {
      console.error('Error updating view count:', updateError);
    }

    return NextResponse.json({
      analysisComplete: true,
      hasAnalyzedVideo,
      positionAnalysisData,
      playerNames,
      videoId,
      userId,
      videoKey: hasAnalyzedVideo
        ? `${process.env.R2_ENVIRONMENT || 'dev'}/${userId}/${videoId}/analyzed_video.mp4`
        : videoKey,
      createdAt: share.created_at,
    });
  } catch (error) {
    console.error('Error in shared analysis API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
