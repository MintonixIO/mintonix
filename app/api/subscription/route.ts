import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { stripe, STRIPE_PLANS } from '@/lib/stripe';

export async function GET() {
  try {
    console.log('[API] Subscription GET request started');
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      console.log('[API] Auth error or no user:', authError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[API] User authenticated:', user.id);

    const { data: subscription, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .single();

    console.log('[API] Subscription query result:', { subscription, error });

    if (error && error.code !== 'PGRST116') {
      console.error('[API] Subscription query error:', error);
      throw error;
    }

    if (!subscription) {
      console.log('[API] No subscription found, creating new one');
      // Create default free subscription
      const { data: newSubscription, error: createError } = await supabase
        .from('subscriptions')
        .insert([{
          user_id: user.id,
          stripe_customer_id: '', // Will be set when customer upgrades
          plan_type: 'FREE',
          status: 'active',
          minutes_included: STRIPE_PLANS.FREE.hours * 60, // Convert hours to minutes
          minutes_used: 0,
        }])
        .select()
        .single();

      if (createError) {
        console.error('[API] Error creating subscription:', createError);
        throw createError;
      }
      console.log('[API] Created new subscription:', newSubscription);
      return NextResponse.json(newSubscription);
    }

    // Return subscription data (minutes_remaining is auto-calculated by database)
    const { data: updatedSubscription, error: updateError } = await supabase
      .from('subscriptions')
      .select()
      .eq('id', subscription.id)
      .single();

    if (updateError) {
      console.error('[API] Error fetching updated subscription:', updateError);
      throw updateError;
    }

    console.log('[API] Returning subscription:', updatedSubscription);
    return NextResponse.json(updatedSubscription);
  } catch (error) {
    console.error('[API] Error fetching subscription:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { planType, returnUrl } = await request.json();

    if (!STRIPE_PLANS[planType as keyof typeof STRIPE_PLANS]) {
      return NextResponse.json({ error: 'Invalid plan type' }, { status: 400 });
    }

    const plan = STRIPE_PLANS[planType as keyof typeof STRIPE_PLANS];

    if (planType === 'FREE') {
      return NextResponse.json({ error: 'Cannot create checkout for free plan' }, { status: 400 });
    }

    // Get or create customer
    let customerId: string;
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .single();

    if (subscription?.stripe_customer_id) {
      customerId = subscription.stripe_customer_id;
    } else {
      const customer = await stripe.customers.create({
        email: user.email!,
        metadata: {
          userId: user.id,
        },
      });
      customerId = customer.id;

      // Update subscription with customer ID
      await supabase
        .from('subscriptions')
        .update({ stripe_customer_id: customerId })
        .eq('user_id', user.id);
    }

    // Create checkout session
    const sessionParams: Record<string, unknown> = {
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: plan.priceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/dashboard/billing?success=true`,
      cancel_url: returnUrl || `${process.env.NEXT_PUBLIC_BASE_URL}/dashboard/billing`,
      metadata: {
        userId: user.id,
        planType,
      },
    };

    if (customerId) {
      sessionParams.customer = customerId;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: subscription, error } = await supabase
      .from('subscriptions')
      .select('stripe_subscription_id')
      .eq('user_id', user.id)
      .single();

    if (error || !subscription?.stripe_subscription_id) {
      return NextResponse.json({ error: 'No active subscription found' }, { status: 404 });
    }

    // Cancel subscription at period end
    await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      cancel_at_period_end: true,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error canceling subscription:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}