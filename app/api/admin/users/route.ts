import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { isSuperAdminServer, createUnauthorizedResponse, createForbiddenResponse } from '@/lib/admin-auth';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return createUnauthorizedResponse();
    }

    // Check if user is super admin (only super admins can manage users)
    const superAdminAccess = await isSuperAdminServer(user.id);
    if (!superAdminAccess) {
      return createForbiddenResponse();
    }

    // Use admin client to bypass RLS and get all user profiles
    const adminSupabase = createAdminClient();

    // Get all user profiles with their subscription data
    const { data: profiles, error } = await adminSupabase
      .from('user_profiles')
      .select(`
        *,
        subscriptions (
          id,
          plan_type,
          status,
          hours_included,
          hours_used,
          hours_remaining,
          overage_hours,
          current_period_start,
          current_period_end,
          created_at,
          updated_at
        )
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching user profiles:', error);
      return NextResponse.json({ error: 'Failed to fetch user profiles' }, { status: 500 });
    }

    return NextResponse.json(profiles || []);
  } catch (error) {
    console.error('Error in GET /api/admin/users:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return createUnauthorizedResponse();
    }

    // Check if user is super admin
    const superAdminAccess = await isSuperAdminServer(user.id);
    if (!superAdminAccess) {
      return createForbiddenResponse();
    }

    const body = await request.json();
    const { userId, role, subscriptionData } = body;

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    // Use admin client to bypass RLS for all updates
    const adminSupabase = createAdminClient();

    // Handle role updates
    if (role) {
      if (!['user', 'admin', 'super_admin'].includes(role)) {
        return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
      }

      // Prevent removing the last super admin
      if (role !== 'super_admin') {
        const { data: superAdmins, error: superAdminError } = await adminSupabase
          .from('user_profiles')
          .select('id')
          .eq('role', 'super_admin');

        if (superAdminError) {
          return NextResponse.json({ error: 'Error checking super admin count' }, { status: 500 });
        }

        if (superAdmins.length === 1 && superAdmins[0].id === userId) {
          return NextResponse.json({ error: 'Cannot remove the last super admin' }, { status: 400 });
        }
      }

      // Update user role
      const { error } = await adminSupabase
        .from('user_profiles')
        .update({ role })
        .eq('id', userId);

      if (error) {
        console.error('Error updating user role:', error);
        return NextResponse.json({ error: 'Failed to update user role' }, { status: 500 });
      }
    }

    // Handle subscription updates
    if (subscriptionData) {
      const { 
        plan_type, 
        hours_included, 
        hours_used, 
        hours_remaining, 
        overage_hours,
        current_period_start,
        current_period_end,
        status
      } = subscriptionData;

      // Get existing subscription
      const { data: existingSubscription, error: subFetchError } = await adminSupabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (subFetchError && subFetchError.code !== 'PGRST116') {
        console.error('Error fetching subscription:', subFetchError);
        return NextResponse.json({ error: 'Failed to fetch subscription' }, { status: 500 });
      }

      const updateData: Record<string, string | number | Date> = {};
      if (plan_type !== undefined) updateData.plan_type = plan_type;
      if (hours_included !== undefined) updateData.hours_included = hours_included;
      if (hours_used !== undefined) updateData.hours_used = hours_used;
      if (hours_remaining !== undefined) updateData.hours_remaining = hours_remaining;
      if (overage_hours !== undefined) updateData.overage_hours = overage_hours;
      if (current_period_start !== undefined) updateData.current_period_start = current_period_start;
      if (current_period_end !== undefined) updateData.current_period_end = current_period_end;
      if (status !== undefined) updateData.status = status;
      updateData.updated_at = new Date().toISOString();

      if (existingSubscription) {
        // Update existing subscription
        const { error: updateError } = await adminSupabase
          .from('subscriptions')
          .update(updateData)
          .eq('user_id', userId);

        if (updateError) {
          console.error('Error updating subscription:', updateError);
          return NextResponse.json({ error: 'Failed to update subscription' }, { status: 500 });
        }
      } else {
        // Create new subscription if it doesn't exist
        const { error: insertError } = await adminSupabase
          .from('subscriptions')
          .insert({
            user_id: userId,
            plan_type: plan_type || 'FREE',
            status: status || 'active',
            hours_included: hours_included || 5,
            hours_used: hours_used || 0,
            hours_remaining: hours_remaining || 5,
            overage_hours: overage_hours || 0,
            current_period_start: current_period_start || new Date().toISOString(),
            current_period_end: current_period_end || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            stripe_customer_id: 'admin_created',
            ...updateData
          });

        if (insertError) {
          console.error('Error creating subscription:', insertError);
          return NextResponse.json({ error: 'Failed to create subscription' }, { status: 500 });
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in PUT /api/admin/users:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}