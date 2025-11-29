#!/usr/bin/env node

/**
 * Stripe Development Helper Script
 * 
 * This script helps with common Stripe development tasks:
 * - Setting up webhook forwarding
 * - Testing webhook events
 * - Validating configuration
 * - Creating test customers and subscriptions
 */

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: '.env.local' });

const commands = {
  listen: () => {
    console.log('🎧 Starting Stripe webhook listener...');
    console.log('Make sure your Next.js dev server is running on localhost:3000');
    console.log('Press Ctrl+C to stop\n');
    
    const listener = spawn('stripe', ['listen', '--forward-to', 'localhost:3000/api/webhooks/stripe'], {
      stdio: 'inherit'
    });
    
    listener.on('close', (code) => {
      console.log(`\n✋ Webhook listener stopped with code ${code}`);
    });
  },

  test: () => {
    console.log('🧪 Triggering test webhook events...\n');
    
    const events = [
      'checkout.session.completed',
      'invoice.payment_succeeded',
      'customer.subscription.updated',
      'customer.subscription.deleted'
    ];
    
    events.forEach((event, index) => {
      setTimeout(() => {
        console.log(`📡 Triggering: ${event}`);
        exec(`stripe trigger ${event}`, (error, stdout, stderr) => {
          if (error) {
            console.error(`❌ Error triggering ${event}:`, error.message);
          } else {
            console.log(`✅ Successfully triggered: ${event}`);
          }
        });
      }, index * 2000); // Stagger events by 2 seconds
    });
  },

  validate: () => {
    console.log('🔍 Validating Stripe configuration...\n');
    
    const requiredVars = [
      'STRIPE_SECRET_KEY',
      'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'STRIPE_STARTER_PRICE_ID',
      'STRIPE_PRO_PRICE_ID',
      'STRIPE_ENTERPRISE_PRICE_ID'
    ];
    
    let valid = true;
    
    requiredVars.forEach(varName => {
      const value = process.env[varName];
      if (!value) {
        console.log(`❌ Missing: ${varName}`);
        valid = false;
      } else if (value.includes('your_') || value.includes('_here')) {
        console.log(`⚠️  Placeholder value: ${varName}`);
        valid = false;
      } else {
        console.log(`✅ Set: ${varName}`);
      }
    });
    
    if (valid) {
      console.log('\n🎉 All Stripe configuration is valid!');
      
      // Check if using test or live keys
      const secretKey = process.env.STRIPE_SECRET_KEY;
      if (secretKey?.startsWith('sk_test_')) {
        console.log('🧪 Using TEST mode (safe for development)');
      } else if (secretKey?.startsWith('sk_live_')) {
        console.log('🚨 Using LIVE mode (real payments!)');
      }
    } else {
      console.log('\n❌ Configuration issues found. Please update your .env.local file.');
    }
  },

  setup: () => {
    console.log('🚀 Setting up Stripe for local development...\n');
    
    console.log('📋 Setup Checklist:');
    console.log('1. Create Stripe account at https://stripe.com');
    console.log('2. Get test API keys from Dashboard > Developers > API Keys');
    console.log('3. Create products and prices for each plan:');
    console.log('   - Starter: $29/month');
    console.log('   - Pro: $79/month');
    console.log('   - Enterprise: $199/month');
    console.log('4. Install Stripe CLI: brew install stripe/stripe-cli/stripe');
    console.log('5. Login to CLI: stripe login');
    console.log('6. Update .env.local with actual values');
    console.log('7. Run: npm run stripe:validate');
    console.log('8. Run: npm run stripe:listen');
    console.log('\n📖 See STRIPE_SETUP_GUIDE.md for detailed instructions');
  },

  customer: () => {
    console.log('👤 Creating test customer...');
    
    const email = `test-${Date.now()}@example.com`;
    exec(`stripe customers create --email="${email}" --name="Test User"`, (error, stdout, stderr) => {
      if (error) {
        console.error('❌ Error creating customer:', error.message);
      } else {
        console.log('✅ Test customer created:');
        console.log(stdout);
      }
    });
  },

  products: () => {
    console.log('📦 Listing Stripe products...');
    
    exec('stripe products list', (error, stdout, stderr) => {
      if (error) {
        console.error('❌ Error listing products:', error.message);
      } else {
        console.log(stdout);
      }
    });
  },

  help: () => {
    console.log('🎯 Stripe Development Helper\n');
    console.log('Available commands:');
    console.log('  listen    - Start webhook listener for local development');
    console.log('  test      - Trigger test webhook events');
    console.log('  validate  - Check configuration and environment variables');
    console.log('  setup     - Show setup instructions');
    console.log('  customer  - Create a test customer');
    console.log('  products  - List Stripe products');
    console.log('  help      - Show this help message\n');
    console.log('Usage: node scripts/stripe-dev.js <command>');
    console.log('Or use npm scripts: npm run stripe:listen, npm run stripe:test, etc.');
  }
};

// Get command from arguments
const command = process.argv[2];

if (commands[command]) {
  commands[command]();
} else {
  console.log(`❓ Unknown command: ${command}\n`);
  commands.help();
}