import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { videoId, durationMinutes } = await request.json();

    if (!videoId || !durationMinutes) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const hoursConsumed = durationMinutes / 60;

    // Get user's subscription
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (subError || !subscription) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
    }

    // Check if user has enough hours (including overage allowance)
    const maxAllowedHours = subscription.hours_included + 100; // Allow up to 100 hours overage
    const newTotalUsage = subscription.hours_used + hoursConsumed;

    if (newTotalUsage > maxAllowedHours) {
      return NextResponse.json({ 
        error: 'Usage limit exceeded',
        maxHours: maxAllowedHours,
        currentUsage: subscription.hours_used,
        requestedHours: hoursConsumed
      }, { status: 429 });
    }

    // Record usage
    const { error: usageError } = await supabase
      .from('usage_records')
      .insert([{
        user_id: user.id,
        subscription_id: subscription.id,
        video_id: videoId,
        hours_consumed: hoursConsumed,
        billing_period_start: subscription.current_period_start,
        billing_period_end: subscription.current_period_end,
      }]);

    if (usageError) throw usageError;

    // Update subscription usage and hours_remaining
    const newHoursRemaining = Math.max(0, subscription.hours_included - newTotalUsage);
    const { error: updateError } = await supabase
      .from('subscriptions')
      .update({
        hours_used: newTotalUsage,
        hours_remaining: newHoursRemaining,
      })
      .eq('id', subscription.id);

    if (updateError) throw updateError;

    // Calculate new values for response
    const hoursRemaining = Math.max(0, subscription.hours_included - newTotalUsage);
    const overageHours = Math.max(0, newTotalUsage - subscription.hours_included);

    return NextResponse.json({
      success: true,
      hoursConsumed,
      totalHoursUsed: newTotalUsage,
      hoursRemaining,
      overageHours,
      isOverage: overageHours > 0,
    });
  } catch (error) {
    console.error('Error tracking usage:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const billingPeriodStart = url.searchParams.get('period_start');
    const billingPeriodEnd = url.searchParams.get('period_end');

    let query = supabase
      .from('usage_records')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (billingPeriodStart && billingPeriodEnd) {
      query = query
        .gte('billing_period_start', billingPeriodStart)
        .lte('billing_period_end', billingPeriodEnd);
    }

    const { data: usage, error } = await query;

    if (error) throw error;

    return NextResponse.json(usage);
  } catch (error) {
    console.error('Error fetching usage:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}