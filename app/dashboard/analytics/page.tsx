"use client";

import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { BarChart3, TrendingUp, Activity, Target } from "lucide-react";

export default function AnalyticsPage() {
  return (
    <div className="min-h-screen bg-[hsl(var(--tech-bg))] flex">
      <DashboardSidebar className="flex-shrink-0" />
      
      <main className="flex-1 overflow-hidden bg-[hsl(var(--tech-bg))]">
        <div className="h-full overflow-y-auto">
          <div className="p-8">
            <div className="max-w-7xl mx-auto">
              <div className="flex flex-col gap-8">
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-3xl font-bold text-[hsl(var(--tech-text-primary))] mb-2">Analytics</h1>
                    <p className="text-[hsl(var(--tech-text-secondary))]">Performance insights and gameplay statistics</p>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <div className="bg-[hsl(var(--tech-bg-secondary))] border border-[hsl(var(--tech-border))] rounded-lg p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[hsl(var(--tech-text-secondary))] text-sm font-medium">Total Videos</p>
                        <p className="text-2xl font-bold text-[hsl(var(--tech-text-primary))]">--</p>
                      </div>
                      <BarChart3 className="h-8 w-8 text-[hsl(var(--tech-accent))]" />
                    </div>
                  </div>
                  
                  <div className="bg-[hsl(var(--tech-bg-secondary))] border border-[hsl(var(--tech-border))] rounded-lg p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[hsl(var(--tech-text-secondary))] text-sm font-medium">Analysis Hours</p>
                        <p className="text-2xl font-bold text-[hsl(var(--tech-text-primary))]">--</p>
                      </div>
                      <Activity className="h-8 w-8 text-[hsl(var(--tech-accent))]" />
                    </div>
                  </div>
                  
                  <div className="bg-[hsl(var(--tech-bg-secondary))] border border-[hsl(var(--tech-border))] rounded-lg p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[hsl(var(--tech-text-secondary))] text-sm font-medium">Improvement</p>
                        <p className="text-2xl font-bold text-[hsl(var(--tech-text-primary))]">--</p>
                      </div>
                      <TrendingUp className="h-8 w-8 text-[hsl(var(--tech-accent))]" />
                    </div>
                  </div>
                  
                  <div className="bg-[hsl(var(--tech-bg-secondary))] border border-[hsl(var(--tech-border))] rounded-lg p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[hsl(var(--tech-text-secondary))] text-sm font-medium">Accuracy</p>
                        <p className="text-2xl font-bold text-[hsl(var(--tech-text-primary))]">--</p>
                      </div>
                      <Target className="h-8 w-8 text-[hsl(var(--tech-accent))]" />
                    </div>
                  </div>
                </div>
                
                <div className="bg-[hsl(var(--tech-bg-secondary))] border border-[hsl(var(--tech-border))] rounded-lg p-6">
                  <h2 className="text-xl font-semibold text-[hsl(var(--tech-text-primary))] mb-4">Performance Analytics</h2>
                  <div className="flex items-center justify-center h-64 text-[hsl(var(--tech-text-secondary))]">
                    Analytics dashboard coming soon...
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}