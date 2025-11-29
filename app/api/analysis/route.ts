import { NextRequest, NextResponse } from 'next/server';
import { getSignedVideoUrl, getUserVideos } from '@/lib/r2';
import { logJobInfo, logSuccess, logError, logDebug } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes (Vercel Hobby plan limit)

export async function POST(request: NextRequest) {
  try {
    logDebug('/api/unified-analysis called');
    const body = await request.json();
    const { userId, videoId } = body;

    logDebug('Request body', { userId, videoId });

    if (!userId || !videoId) {
      logError('Missing userId or videoId');
      return NextResponse.json(
        { error: 'Missing required fields: userId and videoId' },
        { status: 400 }
      );
    }

    // Find the video file
    const videos = await getUserVideos(userId);
    logDebug(`Found ${videos.length} videos for user`, { videoId, available: videos.map(v => v.videoId) });

    const video = videos.find(v => v.videoId === videoId);

    if (!video) {
      logError('Video not found', { videoId, available: videos.map(v => v.videoId) });
      return NextResponse.json(
        { error: `Video not found. Available video IDs: ${videos.map(v => v.videoId).join(', ')}` },
        { status: 404 }
      );
    }

    // Get signed video URL for RunPod service
    const signedVideoUrl = await getSignedVideoUrl(video.key);
    logDebug('Generated signed video URL', { videoId });

    // Call RunPod unified analysis service
    const runpodEndpoint = process.env.RUNPOD_ENDPOINT_ID;
    const runpodApiKey = process.env.RUNPOD_API_KEY;

    if (!runpodEndpoint || !runpodApiKey) {
      throw new Error('RunPod unified analysis configuration missing. Please set RUNPOD_ENDPOINT_ID and RUNPOD_API_KEY environment variables.');
    }

    // Create internal job ID BEFORE sending to RunPod
    const internalJobId = `unified-${videoId}-${Date.now()}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200000); // 20 minutes timeout

    // Construct webhook URL for real-time updates
    const webhookUrl = process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/api/webhook`
      : `${request.headers.get('origin') || 'http://localhost:3000'}/api/webhook`;

    logDebug('Webhook configured', { webhookUrl });

    let response;
    try {
      // Use async endpoint for better progress tracking with webhook support
      response = await fetch(`https://api.runpod.ai/v2/${runpodEndpoint}/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${runpodApiKey}`,
        },
        body: JSON.stringify({
          input: {
            video_url: signedVideoUrl,
            user_id: userId,
            session_id: videoId,
            webhook_url: webhookUrl,
            job_id: internalJobId  // Pass internal job ID to Python
          }
        })
      });
      clearTimeout(timeoutId);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Unified analysis timed out after 20 minutes');
      }
      throw error;
    }

    if (!response.ok) {
      const errorText = await response.text();
      logError('RunPod API request failed', {
        status: response.status,
        statusText: response.statusText,
        endpoint: runpodEndpoint,
        response: errorText,
      });

      if (response.status === 404) {
        throw new Error(`RunPod endpoint not found. Please check your RUNPOD_ENDPOINT_ID (${runpodEndpoint}) is correct and the serverless endpoint is deployed.`);
      } else if (response.status === 401) {
        throw new Error(`RunPod authentication failed. Please check your RUNPOD_API_KEY is correct.`);
      } else {
        throw new Error(`RunPod service error: ${response.status} - ${errorText || response.statusText}`);
      }
    }

    const runpodResult = await response.json();

    // Async endpoint returns job ID immediately
    if (!runpodResult.id) {
      throw new Error(`Invalid RunPod response: ${JSON.stringify(runpodResult)}`);
    }

    const runpodJobId = runpodResult.id;
    const status = runpodResult.status;

    logSuccess('Job submitted to RunPod');
    logDebug('Python worker will create Supabase record on job start');
    logJobInfo({
      jobId: internalJobId,
      runpodJobId,
      userId,
      videoId,
      status,
    });

    return NextResponse.json({
      success: true,
      jobId: internalJobId,
      runpodJobId,
      status: status,
      message: 'Analysis job started. Python worker will create database record.',
      webhookUrl,
    });

  } catch (error) {
    logError('Unified analysis failed', error);

    // Return appropriate error response
    if (error instanceof Error) {
      if (error.message.includes('ENDPOINT_URL') || error.message.includes('API_KEY')) {
        return NextResponse.json(
          { error: 'Unified analysis service not configured' },
          { status: 503 }
        );
      }

      if (error.message.includes('timeout')) {
        return NextResponse.json(
          { error: 'Unified analysis processing timeout' },
          { status: 408 }
        );
      }

      if (error.message.includes('Video not found')) {
        return NextResponse.json(
          { error: 'Video not found' },
          { status: 404 }
        );
      }
    }

    return NextResponse.json(
      { error: 'Unified analysis failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  // Health check endpoint
  try {
    const runpodEndpoint = process.env.RUNPOD_ENDPOINT_ID;
    const runpodApiKey = process.env.RUNPOD_API_KEY;
    
    const configured = !!(runpodEndpoint && runpodApiKey);

    return NextResponse.json({
      status: 'healthy',
      service: 'unified-analysis',
      configured,
      service_status: configured ? 'ready' : 'not_configured',
      timestamp: new Date().toISOString()
    });
  } catch {
    return NextResponse.json(
      { status: 'error', error: 'Health check failed', configured: false },
      { status: 500 }
    );
  }
}