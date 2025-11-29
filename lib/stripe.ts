import Stripe from 'stripe';
import config from './config';

// Server-side only Stripe instance
export const stripe = new Stripe(config.stripe.secretKey, {
  apiVersion: '2025-06-30.basil',
  appInfo: {
    name: 'Mintonix',
    version: '1.0.0',
  },
});

// Server-side plan configuration with price IDs
export const STRIPE_PLANS = {
  FREE: {
    name: 'Free',
    price: 0,
    hours: 5,
    priceId: null,
  },
  STARTER: {
    name: 'Starter',
    price: 2900, // $29 in cents
    hours: 50,
    priceId: config.stripe.priceIds.starter,
  },
  PRO: {
    name: 'Pro',
    price: 7900, // $79 in cents
    hours: 200,
    priceId: config.stripe.priceIds.pro,
  },
  ENTERPRISE: {
    name: 'Enterprise',
    price: 19900, // $199 in cents
    hours: 1000,
    priceId: config.stripe.priceIds.enterprise,
  },
} as const;

export const OVERAGE_PRICE_PER_HOUR = 200; // $2 per hour in cents

export type PlanType = keyof typeof STRIPE_PLANS;