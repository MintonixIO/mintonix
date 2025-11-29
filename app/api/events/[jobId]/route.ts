import { NextRequest } from 'next/server';
import { webhookStore, JobUpdate } from '@/lib/webhook-store';

export const runtime = 'nodejs';

/**
 * Server-Sent Events (SSE) endpoint for real-time job updates
 * Frontend connects to this endpoint to receive live progress updates
 */
export async function GET(
  request: NextRequest,
  segmentData: { params: Promise<{ jobId: string }> }
) {
  const params = await segmentData.params;
  const jobId = params.jobId;

  console.log(`📡 SSE connection opened for job ${jobId}`);

  // Create a text encoder for SSE
  const encoder = new TextEncoder();

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection message
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: 'connected', jobId })}\n\n`)
      );

      // Send any existing updates immediately
      const existingUpdates = webhookStore.getUpdates(jobId);
      if (existingUpdates.length > 0) {
        const latestUpdate = existingUpdates[existingUpdates.length - 1];
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(latestUpdate)}\n\n`)
        );
      }

      // Register listener for new updates
      const listener = (update: JobUpdate) => {
        try {
          const message = `data: ${JSON.stringify(update)}\n\n`;
          controller.enqueue(encoder.encode(message));

          // Close stream if job is completed or failed
          if (update.status === 'completed' || update.status === 'failed') {
            console.log(`📡 SSE closing for job ${jobId}: ${update.status}`);
            setTimeout(() => {
              try {
                controller.close();
              } catch {
                // Stream might already be closed
              }
            }, 1000); // Give time for final message to send
          }
        } catch {
          // Ignore errors when sending SSE updates - stream might be closed
        }
      };

      // Add listener to webhook store
      webhookStore.addListener(jobId, listener);

      console.log(`📡 SSE listener registered for job ${jobId}`);

      // Handle client disconnect
      request.signal.addEventListener('abort', () => {
        console.log(`📡 SSE connection closed by client for job ${jobId}`);
        webhookStore.removeListener(jobId, listener);
        try {
          controller.close();
        } catch {
          // Stream might already be closed
        }
      });

      // Keep-alive ping every 30 seconds
      const keepAliveInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        } catch {
          clearInterval(keepAliveInterval);
        }
      }, 30000);

      // Cleanup interval when connection closes
      request.signal.addEventListener('abort', () => {
        clearInterval(keepAliveInterval);
      });
    },

    cancel() {
      console.log(`📡 SSE stream cancelled for job ${jobId}`);
    }
  });

  // Return SSE response
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    }
  });
}
