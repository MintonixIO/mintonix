import { loadStripe } from '@stripe/stripe-js';

// This is safe to expose to the client-side
const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

export { stripePromise };

// Client-safe plan configuration (no sensitive data)
export const STRIPE_PLANS = {
  FREE: {
    name: 'Free',
    price: 0,
    hours: 5,
    priceId: null,
  },
  STARTER: {
    name: 'Starter',
    price: 2999, // $29 in cents
    hours: 50,
  },
  PRO: {
    name: 'Pro',
    price: 7999, // $79 in cents
    hours: 200,
  },
  ENTERPRISE: {
    name: 'Enterprise',
    price: 19999, // $199 in cents
    hours: 1000,
  },
} as const;

export const OVERAGE_PRICE_PER_HOUR = 200; // $2 per hour in cents

export type PlanType = keyof typeof STRIPE_PLANS;