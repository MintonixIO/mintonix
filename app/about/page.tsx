"use client";

import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { 
  Target, 
  MapPin, 
  BarChart3, 
  Eye, 
  Zap, 
  Users, 
  Award, 
  Clock,
  Smartphone,
  Brain,
  CheckCircle
} from "lucide-react";
import Link from "next/link";

export default function AboutPage() {
  const features = [
    {
      icon: <Target className="h-8 w-8" />,
      title: "Shot Detection & Classification",
      description: "Advanced AI automatically recognizes 15+ shot types including clears, drops, smashes, drives, net shots, and serves with 95% accuracy.",
      details: [
        "Automatic shot type recognition",
        "Shot timing and rally duration tracking",
        "Comprehensive shot counting and statistics",
        "Success/error rate analysis by shot type"
      ]
    },
    {
      icon: <MapPin className="h-8 w-8" />,
      title: "Court Position Tracking",
      description: "Track player movement and positioning throughout rallies to understand court coverage and tactical patterns.",
      details: [
        "Real-time player positioning throughout rallies",
        "Movement patterns and court coverage analysis",
        "Advanced footwork analysis and efficiency metrics",
        "Recovery positioning assessment after shots"
      ]
    },
    {
      icon: <BarChart3 className="h-8 w-8" />,
      title: "Performance Metrics",
      description: "Comprehensive analytics that provide actionable insights into your game performance and areas for improvement.",
      details: [
        "Shot success/error rates by type and court position",
        "Rally win/loss statistics and patterns",
        "Detailed serve statistics and placement analysis",
        "Session summaries and long-term trend tracking"
      ]
    }
  ];

  const benefits = [
    {
      icon: <Eye className="h-6 w-6" />,
      title: "Objective Analysis",
      description: "Get unbiased, data-driven insights into your performance that human observation might miss."
    },
    {
      icon: <Zap className="h-6 w-6" />,
      title: "Instant Feedback",
      description: "Receive immediate analysis after uploading your videos - no waiting for manual review."
    },
    {
      icon: <Users className="h-6 w-6" />,
      title: "For All Levels",
      description: "Whether you&apos;re a beginner or professional, our analysis adapts to your skill level."
    },
    {
      icon: <Award className="h-6 w-6" />,
      title: "Proven Results",
      description: "Used by players and coaches worldwide to improve technique and tactical understanding."
    }
  ];

  const stats = [
    { number: "10,000+", label: "Videos Analyzed" },
    { number: "95%", label: "Detection Accuracy" },
    { number: "2,500+", label: "Active Users" },
    { number: "15+", label: "Shot Types" }
  ];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <main className="pt-20">
        {/* Hero Section */}
        <section className="py-20 bg-gradient-to-br from-background to-muted">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h1 className="text-4xl md:text-6xl font-bold text-foreground mb-6">
                Revolutionizing Badminton
                <span className="text-primary block">Video Analysis</span>
              </h1>
              <p className="text-xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
                We use cutting-edge computer vision and AI to provide detailed analysis of badminton 
                gameplay from simple monocular video footage. Transform your training with objective, 
                data-driven insights.
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-16">
              {stats.map((stat, index) => (
                <div key={index} className="text-center">
                  <div className="text-3xl md:text-4xl font-bold text-primary mb-2">{stat.number}</div>
                  <div className="text-muted-foreground">{stat.label}</div>
                </div>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button size="lg" asChild>
                <Link href="/auth/sign-up">Start Free Analysis</Link>
              </Button>
              <Button variant="outline" size="lg" asChild>
                <Link href="/pricing">View Pricing</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Core Features */}
        <section className="py-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
                Core Features
              </h2>
              <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
                Our AI-powered analysis engine provides comprehensive insights into every aspect of your badminton game.
              </p>
            </div>

            <div className="space-y-20">
              {features.map((feature, index) => (
                <div key={index} className={`flex flex-col ${index % 2 === 0 ? 'lg:flex-row' : 'lg:flex-row-reverse'} items-center gap-12`}>
                  <div className="flex-1">
                    <div className="flex items-center gap-4 mb-6">
                      <div className="p-3 bg-primary/10 text-primary rounded-lg">
                        {feature.icon}
                      </div>
                      <h3 className="text-2xl font-bold text-foreground">{feature.title}</h3>
                    </div>
                    <p className="text-muted-foreground text-lg mb-6 leading-relaxed">
                      {feature.description}
                    </p>
                    <ul className="space-y-3">
                      {feature.details.map((detail, detailIndex) => (
                        <li key={detailIndex} className="flex items-start gap-3">
                          <CheckCircle className="h-5 w-5 text-green-500 mt-1 flex-shrink-0" />
                          <span className="text-muted-foreground">{detail}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex-1">
                    <div className="bg-muted rounded-2xl p-8 h-80 flex items-center justify-center">
                      <div className="text-center">
                        {feature.icon}
                        <p className="text-muted-foreground mt-4">Feature visualization coming soon</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="py-20 bg-muted">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
                How It Works
              </h2>
              <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
                Get professional-level analysis in just three simple steps.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="text-center">
                <div className="w-16 h-16 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-6">
                  1
                </div>
                <h3 className="text-xl font-bold text-foreground mb-4">Upload Your Video</h3>
                <p className="text-muted-foreground">
                  Simply upload your badminton match or training video. We support all common formats and handle camera angles automatically.
                </p>
              </div>

              <div className="text-center">
                <div className="w-16 h-16 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-6">
                  2
                </div>
                <h3 className="text-xl font-bold text-foreground mb-4">AI Analysis</h3>
                <p className="text-muted-foreground">
                  Our advanced computer vision algorithms analyze every frame, detecting shots, tracking movement, and calculating performance metrics.
                </p>
              </div>

              <div className="text-center">
                <div className="w-16 h-16 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-6">
                  3
                </div>
                <h3 className="text-xl font-bold text-foreground mb-4">Get Insights</h3>
                <p className="text-muted-foreground">
                  Receive detailed reports with actionable insights, visual analytics, and personalized recommendations to improve your game.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Benefits */}
        <section className="py-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
                Why Choose Mintonix?
              </h2>
              <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
                Experience the future of badminton training with AI-powered analysis that&apos;s accessible to everyone.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
              {benefits.map((benefit, index) => (
                <div key={index} className="text-center p-6 bg-card border border-border rounded-xl hover:shadow-lg transition-shadow">
                  <div className="w-12 h-12 bg-primary/10 text-primary rounded-lg flex items-center justify-center mx-auto mb-4">
                    {benefit.icon}
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-3">{benefit.title}</h3>
                  <p className="text-muted-foreground text-sm">{benefit.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Technology */}
        <section className="py-20 bg-muted">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <div>
                <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
                  Powered by Advanced AI
                </h2>
                <p className="text-muted-foreground text-lg mb-8 leading-relaxed">
                  Our proprietary computer vision models are trained on thousands of hours of badminton footage, 
                  enabling precise detection and analysis that rivals human expertise. We use state-of-the-art 
                  deep learning techniques to ensure accurate and reliable results.
                </p>
                
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Brain className="h-5 w-5 text-primary" />
                    <span className="text-foreground">Deep learning neural networks</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Smartphone className="h-5 w-5 text-primary" />
                    <span className="text-foreground">Works with any camera or smartphone</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Clock className="h-5 w-5 text-primary" />
                    <span className="text-foreground">Fast processing and real-time results</span>
                  </div>
                </div>
              </div>
              
              <div className="bg-background rounded-2xl p-8 h-80 flex items-center justify-center">
                <div className="text-center">
                  <Brain className="h-16 w-16 text-primary mx-auto mb-4" />
                  <p className="text-muted-foreground">AI Technology Visualization</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-20">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
              Ready to Transform Your Game?
            </h2>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              Join thousands of players and coaches who are already using Mintonix to analyze and improve their badminton performance.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button size="lg" asChild>
                <Link href="/auth/sign-up">Start Free Trial</Link>
              </Button>
              <Button variant="outline" size="lg" asChild>
                <Link href="/pricing">View Pricing</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}