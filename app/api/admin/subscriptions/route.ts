import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

async function checkAdminAuth(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  
  if (authError || !user) {
    return { authorized: false, error: 'Unauthorized' };
  }

  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profileError || profile?.role !== 'admin') {
    return { authorized: false, error: 'Admin access required' };
  }

  return { authorized: true };
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const authCheck = await checkAdminAuth(supabase);
    
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error }, { status: 401 });
    }

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '20');
    const search = url.searchParams.get('search') || '';
    const offset = (page - 1) * limit;

    let query = supabase
      .from('subscriptions')
      .select(`
        *,
        user_profiles (
          id,
          email,
          full_name
        )
      `)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (search) {
      query = query.or(`user_profiles.email.ilike.%${search}%,user_profiles.full_name.ilike.%${search}%`);
    }

    const { data: subscriptions, error, count } = await query;

    if (error) throw error;

    return NextResponse.json({
      subscriptions,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching subscriptions:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const authCheck = await checkAdminAuth(supabase);
    
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error }, { status: 401 });
    }

    const { subscriptionId, hoursAdjustment, reason } = await request.json();

    if (!subscriptionId || typeof hoursAdjustment !== 'number') {
      return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
    }

    // Get current subscription
    const { data: subscription, error: fetchError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('id', subscriptionId)
      .single();

    if (fetchError || !subscription) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
    }

    // Calculate new values
    const newHoursIncluded = Math.max(0, subscription.hours_included + hoursAdjustment);
    const newHoursRemaining = Math.max(0, newHoursIncluded - subscription.hours_used);
    const newOverageHours = Math.max(0, subscription.hours_used - newHoursIncluded);

    // Update subscription
    const { error: updateError } = await supabase
      .from('subscriptions')
      .update({
        hours_included: newHoursIncluded,
        hours_remaining: newHoursRemaining,
        overage_hours: newOverageHours,
      })
      .eq('id', subscriptionId);

    if (updateError) throw updateError;

    // Log the admin action (you might want to create an admin_actions table)
    console.log(`Admin adjusted hours for subscription ${subscriptionId}: ${hoursAdjustment} hours. Reason: ${reason}`);

    return NextResponse.json({
      success: true,
      oldHoursIncluded: subscription.hours_included,
      newHoursIncluded,
      adjustment: hoursAdjustment,
    });
  } catch (error) {
    console.error('Error adjusting subscription hours:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}