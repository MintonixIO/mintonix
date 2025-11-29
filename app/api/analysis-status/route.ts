import { NextRequest, NextResponse } from 'next/server';
import { getSessionFiles } from '@/lib/r2';

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

    const files = await getSessionFiles(userId, videoId);

    // Check which analysis files exist
    const hasCourtCsv = files.some(f => f.fileName === 'calibration.csv');
    const hasPoseJson = files.some(f => f.fileName === 'pose.json');
    const hasPositionsJson = files.some(f => f.fileName === 'positions.json');
    const hasCorrectedPositionsJson = files.some(f => f.fileName === 'corrected_positions.json');
    const hasJumpsJson = files.some(f => f.fileName === 'jumps.json');
    const hasShuttleJson = files.some(f => f.fileName === 'shuttle.json');
    const hasPositionAnalysisJson = files.some(f => f.fileName === 'position_analysis.json');
    const hasAnalyzedVideo = files.some(f => f.fileName === 'analyzed_video.mp4');

    // Determine analysis state and detailed status
    let state = 'pending'; // pending, processing, completed, failed
    let status = 'Queued for Analysis';
    let progress = 0;
    let currentStep = '';

    if (hasAnalyzedVideo) {
      state = 'completed';
      status = 'Analysis Complete';
      progress = 100;
      currentStep = 'Analysis Complete';
    } else if (hasPositionAnalysisJson) {
      state = 'processing';
      status = 'Generating Visualization';
      progress = 85;
      currentStep = 'Generating Visualization';
    } else if (hasShuttleJson) {
      state = 'processing';
      status = 'Analyzing Positions';
      progress = 70;
      currentStep = 'Analyzing Positions';
    } else if (hasCorrectedPositionsJson || hasJumpsJson) {
      state = 'processing';
      status = 'Tracking Shuttlecock';
      progress = 55;
      currentStep = 'Tracking Shuttlecock';
    } else if (hasPositionsJson) {
      state = 'processing';
      status = 'Removing Artifacts';
      progress = 40;
      currentStep = 'Removing Artifacts';
    } else if (hasPoseJson) {
      state = 'processing';
      status = 'Calculating Positions';
      progress = 25;
      currentStep = 'Calculating Positions';
    } else if (hasCourtCsv) {
      state = 'processing';
      status = 'Detecting Poses';
      progress = 10;
      currentStep = 'Detecting Poses';
    } else {
      // Check if video.mp4 exists to determine if it's truly pending or just uploaded
      const hasVideo = files.some(f => f.fileName === 'video.mp4');
      if (hasVideo) {
        state = 'processing';
        status = 'Court Detection';
        progress = 5;
        currentStep = 'Court Detection';
      } else {
        state = 'pending';
        status = 'Queued for Analysis';
        progress = 0;
        currentStep = 'Queued for Analysis';
      }
    }

    return NextResponse.json({
      state,
      status,
      progress,
      currentStep,
      files: files.length
    });
  } catch (error) {
    console.error('Error checking analysis status:', error);
    return NextResponse.json({
      state: 'pending',
      status: 'Queued for Analysis',
      progress: 0,
      currentStep: 'Queued for Analysis',
      files: 0
    });
  }
}