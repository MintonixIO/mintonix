interface Config {
  stripe: {
    secretKey: string;
    publishableKey: string;
    webhookSecret: string;
    priceIds: {
      starter: string;
      pro: string;
      enterprise: string;
    };
  };
  app: {
    baseUrl: string;
    environment: string;
    isProduction: boolean;
    isDevelopment: boolean;
  };
  supabase: {
    url: string;
    anonKey: string;
  };
}

const config: Config = {
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY!,
    publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
    priceIds: {
      starter: process.env.STRIPE_STARTER_PRICE_ID!,
      pro: process.env.STRIPE_PRO_PRICE_ID!,
      enterprise: process.env.STRIPE_ENTERPRISE_PRICE_ID!,
    },
  },
  app: {
    baseUrl: process.env.NEXT_PUBLIC_BASE_URL!,
    environment: process.env.NODE_ENV || 'development',
    isProduction: process.env.NODE_ENV === 'production',
    isDevelopment: process.env.NODE_ENV === 'development',
  },
  supabase: {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  },
};

// Validation function to ensure all required environment variables are set
export function validateConfig(): { isValid: boolean; missingVars: string[] } {
  const requiredVars = [
    'STRIPE_SECRET_KEY',
    'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_STARTER_PRICE_ID',
    'STRIPE_PRO_PRICE_ID',
    'STRIPE_ENTERPRISE_PRICE_ID',
    'NEXT_PUBLIC_BASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  ];

  const missingVars = requiredVars.filter(
    (varName) => !process.env[varName] || process.env[varName]?.includes('your_') || process.env[varName]?.includes('_here')
  );

  return {
    isValid: missingVars.length === 0,
    missingVars,
  };
}

// Helper function to log configuration status (excluding sensitive data)
export function logConfigStatus(): void {
  const { isValid, missingVars } = validateConfig();
  
  console.log('🔧 Configuration Status:');
  console.log(`Environment: ${config.app.environment}`);
  console.log(`Base URL: ${config.app.baseUrl}`);
  console.log(`Stripe Mode: ${config.stripe.secretKey.startsWith('sk_test_') ? 'TEST' : 'LIVE'}`);
  
  if (!isValid) {
    console.warn('⚠️  Missing or placeholder environment variables:');
    missingVars.forEach(varName => console.warn(`   - ${varName}`));
  } else {
    console.log('✅ All configuration variables are set');
  }
}

export default config;