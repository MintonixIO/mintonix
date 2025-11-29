import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');

    if (!jobId) {
      return NextResponse.json(
        { error: 'Missing required parameter: jobId' },
        { status: 400 }
      );
    }

    const runpodEndpoint = process.env.RUNPOD_ENDPOINT_ID;
    const runpodApiKey = process.env.RUNPOD_API_KEY;

    if (!runpodEndpoint || !runpodApiKey) {
      throw new Error('RunPod configuration missing');
    }

    // Poll RunPod status endpoint
    const response = await fetch(`https://api.runpod.ai/v2/${runpodEndpoint}/status/${jobId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${runpodApiKey}`,
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`RunPod status API Error:`, {
        status: response.status,
        response: errorText
      });
      throw new Error(`RunPod status check failed: ${response.status}`);
    }

    const statusData = await response.json();

    // Parse the status response
    const status = statusData.status; // IN_QUEUE, IN_PROGRESS, COMPLETED, FAILED, CANCELLED, TIMED_OUT
    const output = statusData.output;
    const error = statusData.error;

    // Extract step information from logs if available
    let currentStep = null;
    let currentStage = null;
    let progress = 0;

    if (statusData.logs) {
      // Parse logs to extract current step and progress
      const logs = statusData.logs;

      // Search for all step markers and use the LAST one found (most recent)
      // This ensures we get the current step, not the first step in the logs
      // Pipeline: Court (1) → Pose/Position/Artifacts (2) → Shuttle (3) → Visualization (4)
      const stepPatterns = [
        { pattern: /STEP 4:|Visualization|Video Visualization/i, step: 'visualization', stage: 'Generating analyzed video...', progress: 90 },
        { pattern: /STEP 3:|Shuttle Tracking|Shuttle Detection/i, step: 'shuttle', stage: 'Detecting shuttlecock positions...', progress: 80 },
        { pattern: /Sub-step 2\.3:|Jump Detection|Artifact Removal/i, step: 'pose_position_artifacts', stage: 'Detecting jumps and removing artifacts...', progress: 70 },
        { pattern: /Sub-step 2\.2:|Location Calculation/i, step: 'pose_position_artifacts', stage: 'Calculating player positions...', progress: 55 },
        { pattern: /Sub-step 2\.1:|STEP 2:|Pose Estimation/i, step: 'pose_position_artifacts', stage: 'Running pose estimation...', progress: 35 },
        { pattern: /STEP 1:|Court Detection|Court & Camera Calibration/i, step: 'calibration', stage: 'Processing court detection...', progress: 15 },
      ];

      // Find the last matching step by checking in reverse order
      let lastMatchIndex = -1;
      let matchedPattern = null;

      for (const stepPattern of stepPatterns) {
        const match = logs.match(stepPattern.pattern);
        if (match && match.index !== undefined) {
          const matchIndex = logs.lastIndexOf(match[0]); // Get last occurrence
          if (matchIndex > lastMatchIndex) {
            lastMatchIndex = matchIndex;
            matchedPattern = stepPattern;
          }
        }
      }

      if (matchedPattern) {
        currentStep = matchedPattern.step;
        currentStage = matchedPattern.stage;
        progress = matchedPattern.progress;
      }

      // Extract frame progress if available (this gives more precise progress within a step)
      const frameMatch = logs.match(/(\d+)\/(\d+) frames/);
      if (frameMatch) {
        const current = parseInt(frameMatch[1]);
        const total = parseInt(frameMatch[2]);
        const frameProgress = Math.min(Math.round((current / total) * 100), 95);
        // Use frame progress if it's higher than step-based progress
        if (frameProgress > progress) {
          progress = frameProgress;
        }
      }
    }

    // Determine overall status
    let overallStatus = 'running';
    if (status === 'COMPLETED') {
      overallStatus = 'completed';
      progress = 100;
    } else if (status === 'FAILED' || status === 'CANCELLED' || status === 'TIMED_OUT') {
      overallStatus = 'failed';
    } else if (status === 'IN_QUEUE') {
      overallStatus = 'queued';
      currentStage = 'Waiting in queue...';
      progress = 0;
    }

    return NextResponse.json({
      jobId,
      status: overallStatus,
      runpodStatus: status,
      currentStep,
      currentStage,
      progress,
      output,
      error,
      logs: statusData.logs,
      executionTime: statusData.executionTime,
      delayTime: statusData.delayTime
    });

  } catch (error) {
    console.error('❌ Analysis job status API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch job status', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
