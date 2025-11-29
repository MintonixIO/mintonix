import { NextRequest, NextResponse } from 'next/server';
import { webhookStore } from '@/lib/webhook-store';

export const runtime = 'nodejs';

/**
 * Webhook endpoint to receive status updates from RunPod
 * RunPod calls this endpoint with job progress updates
 */
export async function POST(request: NextRequest) {
  try {
    const data = await request.json();

    console.log('📥 Webhook received:', JSON.stringify(data, null, 2));

    const { jobId, step, status, progress, stage, error, results } = data;

    // Validate required fields
    if (!jobId) {
      console.error('❌ Webhook missing jobId');
      return NextResponse.json(
        { error: 'Missing jobId' },
        { status: 400 }
      );
    }

    if (!status) {
      console.error('❌ Webhook missing status');
      return NextResponse.json(
        { error: 'Missing status' },
        { status: 400 }
      );
    }

    // Store the update
    webhookStore.addUpdate(jobId, {
      step,
      status,
      progress,
      stage,
      error,
      results
    });

    console.log(`✅ Webhook processed for job ${jobId}:`, {
      step,
      status,
      progress,
      stage,
      activeListeners: webhookStore.getListenerCount(jobId)
    });

    // Return success
    return NextResponse.json({
      success: true,
      jobId,
      listenersNotified: webhookStore.getListenerCount(jobId)
    });

  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    return NextResponse.json(
      {
        error: 'Failed to process webhook',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint for webhook health check
 */
export async function GET() {
  const activeJobs = webhookStore.getActiveJobs();

  return NextResponse.json({
    status: 'healthy',
    service: 'webhook',
    activeJobs: activeJobs.length,
    jobs: activeJobs,
    timestamp: new Date().toISOString()
  });
}
