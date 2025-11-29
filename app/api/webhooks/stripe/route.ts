import { NextRequest, NextResponse } from 'next/server';
import { stripe, STRIPE_PLANS, OVERAGE_PRICE_PER_HOUR } from '@/lib/stripe';
// import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import config from '@/lib/config';
import Stripe from 'stripe';

const webhookSecret = config.stripe.webhookSecret;

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
      return NextResponse.json({ error: 'No signature' }, { status: 400 });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    // Use service role client to bypass RLS for webhooks
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        const planType = session.metadata?.planType;

        if (!userId || !planType) {
          console.error('Missing metadata in checkout session');
          break;
        }

        const plan = STRIPE_PLANS[planType as keyof typeof STRIPE_PLANS];
        if (!plan) {
          console.error('Invalid plan type:', planType);
          break;
        }

        // Get the subscription details from Stripe to get the current period
        const stripeSubscription = await stripe.subscriptions.retrieve(session.subscription as string);

        // First ensure the subscription record exists
        const { data: existingSubscription } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('user_id', userId)
          .single();

        if (!existingSubscription) {
          // Create subscription if it doesn't exist
          const { error: createError } = await supabase
            .from('subscriptions')
            .insert([{
              user_id: userId,
              stripe_customer_id: session.customer as string,
              stripe_subscription_id: session.subscription as string,
              plan_type: planType,
              status: 'active',
              hours_included: plan.hours,
              hours_remaining: plan.hours,
              hours_used: 0,
              overage_hours: 0,
              current_period_start: new Date((stripeSubscription as unknown as Record<string, unknown>).current_period_start as number * 1000).toISOString(),
              current_period_end: new Date((stripeSubscription as unknown as Record<string, unknown>).current_period_end as number * 1000).toISOString(),
            }]);

          if (createError) {
            console.error('Error creating subscription:', createError);
          } else {
            console.log(`Subscription created for user ${userId} with plan ${planType}`);
          }
        } else {
          // Update existing subscription
          const { error: updateError } = await supabase
            .from('subscriptions')
            .update({
              stripe_customer_id: session.customer as string,
              stripe_subscription_id: session.subscription as string,
              plan_type: planType,
              status: 'active',
              hours_included: plan.hours,
              hours_remaining: plan.hours,
              hours_used: 0,
              overage_hours: 0,
              current_period_start: new Date((stripeSubscription as unknown as Record<string, unknown>).current_period_start as number * 1000).toISOString(),
              current_period_end: new Date((stripeSubscription as unknown as Record<string, unknown>).current_period_end as number * 1000).toISOString(),
            })
            .eq('user_id', userId);

          if (updateError) {
            console.error('Error updating subscription:', updateError);
          } else {
            console.log(`Subscription updated for user ${userId} with plan ${planType}. Hours: ${plan.hours}`);
          }
        }

        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        
        console.log(`Invoice payment succeeded for customer: ${customerId}`);

        // Add a small delay to handle potential race condition with checkout.session.completed
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Get subscription from Stripe customer ID or subscription ID
        let subscription;
        if ((invoice as unknown as Record<string, unknown>).subscription) {
          const { data: subData } = await supabase
            .from('subscriptions')
            .select('*')
            .eq('stripe_subscription_id', (invoice as unknown as Record<string, unknown>).subscription)
            .single();
          subscription = subData;
        }
        
        if (!subscription) {
          const { data: subData } = await supabase
            .from('subscriptions')
            .select('*')
            .eq('stripe_customer_id', customerId)
            .single();
          subscription = subData;
        }

        if (!subscription) {
          console.error('Subscription not found for customer:', customerId, 'subscription:', (invoice as unknown as Record<string, unknown>).subscription);
          console.log('Retrying in 2 seconds...');
          // Try one more time after a longer delay
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          if ((invoice as unknown as Record<string, unknown>).subscription) {
            const { data: subData } = await supabase
              .from('subscriptions')
              .select('*')
              .eq('stripe_subscription_id', (invoice as unknown as Record<string, unknown>).subscription)
              .single();
            subscription = subData;
          }
          
          if (!subscription) {
            const { data: subData } = await supabase
              .from('subscriptions')
              .select('*')
              .eq('stripe_customer_id', customerId)
              .single();
            subscription = subData;
          }
          
          if (!subscription) {
            console.error('Subscription still not found after retry for customer:', customerId);
            break;
          }
        }

        console.log(`Found subscription ${subscription.id} for billing`);

        // Calculate overage charges
        const overageAmount = Math.max(0, (subscription.overage_hours || 0) * OVERAGE_PRICE_PER_HOUR);

        // Record billing history
        const { error: billingError } = await supabase
          .from('billing_history')
          .insert([{
            user_id: subscription.user_id,
            subscription_id: subscription.id,
            stripe_invoice_id: invoice.id,
            amount: invoice.amount_paid,
            status: 'paid',
            invoice_url: invoice.hosted_invoice_url || '',
            billing_period_start: subscription.current_period_start,
            billing_period_end: subscription.current_period_end,
            hours_billed: subscription.hours_used || 0,
            overage_amount: overageAmount,
          }]);

        if (billingError) {
          console.error('Error recording billing history:', billingError);
        }

        // For recurring invoices, reset usage for new billing period
        if (invoice.billing_reason === 'subscription_cycle') {
          // Get updated period from Stripe subscription
          const stripeSubscription = await stripe.subscriptions.retrieve((invoice as unknown as Record<string, unknown>).subscription as string);
          
          const { error: resetError } = await supabase
            .from('subscriptions')
            .update({
              current_period_start: new Date((stripeSubscription as unknown as Record<string, unknown>).current_period_start as number * 1000).toISOString(),
              current_period_end: new Date((stripeSubscription as unknown as Record<string, unknown>).current_period_end as number * 1000).toISOString(),
              hours_used: 0,
              hours_remaining: subscription.hours_included,
              overage_hours: 0,
            })
            .eq('id', subscription.id);

          if (resetError) {
            console.error('Error resetting subscription usage:', resetError);
          } else {
            console.log(`Reset usage for subscription ${subscription.id}`);
          }
        }

        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        // Handle subscription status changes
        const status = subscription.status === 'active' ? 'active' :
                      subscription.status === 'canceled' ? 'canceled' :
                      subscription.status === 'past_due' ? 'past_due' : 'incomplete';

        await supabase
          .from('subscriptions')
          .update({
            status,
            current_period_start: new Date((subscription as unknown as Record<string, unknown>).current_period_start as number * 1000).toISOString(),
            current_period_end: new Date((subscription as unknown as Record<string, unknown>).current_period_end as number * 1000).toISOString(),
          })
          .eq('stripe_customer_id', customerId);

        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        // Downgrade to free plan
        await supabase
          .from('subscriptions')
          .update({
            stripe_subscription_id: null,
            plan_type: 'FREE',
            status: 'canceled',
            hours_included: STRIPE_PLANS.FREE.hours,
            hours_remaining: STRIPE_PLANS.FREE.hours,
            hours_used: 0,
            overage_hours: 0,
          })
          .eq('stripe_customer_id', customerId);

        break;
      }

      case 'customer.subscription.created': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        
        console.log(`Subscription created for customer ${customerId}`);
        // The checkout.session.completed handler will update the subscription details
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}