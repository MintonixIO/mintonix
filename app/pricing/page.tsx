"use client";

import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Check, X, Zap, BarChart3, Trophy } from "lucide-react";
import Link from "next/link";

export default function PricingPage() {
  const plans = [
    {
      name: "Free",
      price: "$0",
      period: "forever",
      description: "Perfect for trying out badminton video analysis",
      icon: <Zap className="h-6 w-6" />,
      features: [
        "5 video uploads per month",
        "Basic shot detection",
        "Court position tracking",
        "Simple performance metrics",
        "Standard video quality (720p)",
        "48-hour analysis processing",
        "Basic rally statistics"
      ],
      notIncluded: [
        "Advanced shot classification",
        "Detailed footwork analysis",
        "Custom training recommendations",
        "Priority support",
        "HD video analysis",
        "Real-time processing"
      ],
      buttonText: "Get Started Free",
      buttonVariant: "outline" as const,
      popular: false
    },
    {
      name: "Pro",
      price: "$19",
      period: "per month",
      description: "Advanced analysis for serious players and coaches",
      icon: <BarChart3 className="h-6 w-6" />,
      features: [
        "50 video uploads per month",
        "Advanced shot classification (15+ shot types)",
        "Detailed court position tracking",
        "Comprehensive performance metrics",
        "HD video analysis (1080p)",
        "Real-time analysis processing",
        "Advanced rally statistics",
        "Movement pattern analysis",
        "Shot success/error rates",
        "Session trend analysis",
        "Email support"
      ],
      notIncluded: [
        "Custom AI training",
        "Team management features",
        "API access",
        "White-label solutions"
      ],
      buttonText: "Start Pro Trial",
      buttonVariant: "default" as const,
      popular: true
    },
    {
      name: "Elite",
      price: "$49",
      period: "per month",
      description: "Premium features for professional coaches and academies",
      icon: <Trophy className="h-6 w-6" />,
      features: [
        "Unlimited video uploads",
        "All Pro features included",
        "Custom AI model training",
        "Team management dashboard",
        "Player comparison tools",
        "Advanced footwork analysis",
        "Serve technique analysis",
        "Custom training recommendations",
        "4K video analysis support",
        "Priority processing (< 5 minutes)",
        "Advanced analytics dashboard",
        "Priority support & phone calls",
        "API access for integrations"
      ],
      notIncluded: [],
      buttonText: "Contact Sales",
      buttonVariant: "outline" as const,
      popular: false
    }
  ];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <main className="pt-20 pb-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="text-center mb-16">
            <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-6">
              Choose Your Plan
            </h1>
            <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
              Unlock the power of AI-driven badminton analysis. From casual players to professional coaches, 
              we have the perfect plan to elevate your game.
            </p>
          </div>

          {/* Pricing Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`relative bg-card border rounded-2xl p-8 ${
                  plan.popular 
                    ? 'border-primary shadow-2xl scale-105' 
                    : 'border-border hover:border-primary/50'
                } transition-all duration-300`}
              >
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                    <div className="bg-primary text-primary-foreground px-4 py-2 rounded-full text-sm font-medium">
                      Most Popular
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3 mb-6">
                  <div className={`p-3 rounded-lg ${
                    plan.popular ? 'bg-primary text-primary-foreground' : 'bg-muted'
                  }`}>
                    {plan.icon}
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold text-foreground">{plan.name}</h3>
                    <p className="text-muted-foreground text-sm">{plan.description}</p>
                  </div>
                </div>

                <div className="mb-6">
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-bold text-foreground">{plan.price}</span>
                    <span className="text-muted-foreground">/{plan.period}</span>
                  </div>
                </div>

                <Button 
                  className="w-full mb-8" 
                  variant={plan.buttonVariant}
                  size="lg"
                  asChild
                >
                  <Link href={plan.name === "Free" ? "/auth/sign-up" : "/dashboard/billing"}>
                    {plan.buttonText}
                  </Link>
                </Button>

                <div className="space-y-4">
                  <h4 className="font-semibold text-foreground">What&apos;s included:</h4>
                  <ul className="space-y-3">
                    {plan.features.map((feature, featureIndex) => (
                      <li key={featureIndex} className="flex items-start gap-3">
                        <Check className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
                        <span className="text-muted-foreground text-sm">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  {plan.notIncluded.length > 0 && (
                    <div className="pt-4 border-t border-border">
                      <ul className="space-y-3">
                        {plan.notIncluded.map((feature, featureIndex) => (
                          <li key={featureIndex} className="flex items-start gap-3">
                            <X className="h-5 w-5 text-muted-foreground/50 mt-0.5 flex-shrink-0" />
                            <span className="text-muted-foreground/70 text-sm">{feature}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* FAQ Section */}
          <div className="max-w-4xl mx-auto">
            <h2 className="text-3xl font-bold text-center text-foreground mb-12">
              Frequently Asked Questions
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-6">
                <div>
                  <h3 className="font-semibold text-foreground mb-2">Can I upgrade or downgrade anytime?</h3>
                  <p className="text-muted-foreground text-sm">
                    Yes! You can change your plan at any time. Changes take effect immediately and billing adjusts accordingly.
                  </p>
                </div>
                
                <div>
                  <h3 className="font-semibold text-foreground mb-2">What video formats are supported?</h3>
                  <p className="text-muted-foreground text-sm">
                    We support MP4, MOV, AVI, and most common video formats. Maximum file size varies by plan.
                  </p>
                </div>

                <div>
                  <h3 className="font-semibold text-foreground mb-2">How accurate is the shot detection?</h3>
                  <p className="text-muted-foreground text-sm">
                    Our AI achieves 95%+ accuracy for basic shots and 90%+ for advanced shot classifications.
                  </p>
                </div>
              </div>

              <div className="space-y-6">
                <div>
                  <h3 className="font-semibold text-foreground mb-2">Is there a free trial for paid plans?</h3>
                  <p className="text-muted-foreground text-sm">
                    Yes! Pro plan includes a 14-day free trial. Elite plan consultations include demo access.
                  </p>
                </div>
                
                <div>
                  <h3 className="font-semibold text-foreground mb-2">Do you offer team/academy discounts?</h3>
                  <p className="text-muted-foreground text-sm">
                    Absolutely! Contact our sales team for volume discounts and custom academy packages.
                  </p>
                </div>

                <div>
                  <h3 className="font-semibold text-foreground mb-2">What kind of support do you provide?</h3>
                  <p className="text-muted-foreground text-sm">
                    Free users get community support, Pro users get email support, Elite users get priority phone support.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* CTA Section */}
          <div className="text-center mt-16 p-8 bg-muted rounded-2xl">
            <h2 className="text-2xl font-bold text-foreground mb-4">
              Ready to analyze your game?
            </h2>
            <p className="text-muted-foreground mb-6 max-w-2xl mx-auto">
              Join thousands of players and coaches already using Mintonix to improve their badminton performance.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button size="lg" asChild>
                <Link href="/auth/sign-up">Start Free Today</Link>
              </Button>
              <Button variant="outline" size="lg" asChild>
                <Link href="/about">Learn More</Link>
              </Button>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}