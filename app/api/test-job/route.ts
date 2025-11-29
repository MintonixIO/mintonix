import { NextResponse } from 'next/server';
import { createProcessingJob } from '@/lib/processing-jobs';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';

export async function GET() {
  try {
    // Get authenticated user
    await cookies(); // Ensure cookies are available
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({
        success: false,
        error: 'Not authenticated',
        details: 'You need to be logged in to test job creation',
      });
    }

    console.log('🧪 Testing job creation for user:', user.id);

    // Try to create a test job
    const testJobId = `test-job-${Date.now()}`;
    const job = await createProcessingJob({
      jobId: testJobId,
      userId: user.id,
      videoId: 'test-video-123',
      jobType: 'unified_analysis',
      jobParams: { test: true, timestamp: new Date().toISOString() },
      webhookUrl: 'https://example.com/webhook',
    });

    if (!job) {
      return NextResponse.json({
        success: false,
        error: 'Job creation returned null',
        message: 'Check server console for detailed error message',
        userId: user.id,
        testJobId,
      });
    }

    // Verify it was created by querying it back
    const { data: verifyJob, error: verifyError } = await supabase
      .from('processing_jobs')
      .select('*')
      .eq('job_id', testJobId)
      .single();

    return NextResponse.json({
      success: true,
      message: 'Job created and verified successfully!',
      job,
      verification: verifyJob ? 'Found in database ✅' : 'Not found in database ❌',
      verifyError: verifyError ? verifyError.message : null,
    });

  } catch (error) {
    console.error('❌ Test job creation failed:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    }, { status: 500 });
  }
}
