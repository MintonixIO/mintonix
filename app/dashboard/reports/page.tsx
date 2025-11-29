"use client";

import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { FileText, Download, Calendar, TrendingUp } from "lucide-react";

export default function ReportsPage() {
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
                    <h1 className="text-3xl font-bold text-[hsl(var(--tech-text-primary))] mb-2">Analysis Reports</h1>
                    <p className="text-[hsl(var(--tech-text-secondary))]">View and download detailed analysis reports</p>
                  </div>
                  <button className="flex items-center gap-2 px-4 py-2 bg-[hsl(var(--tech-accent))] text-white rounded-lg hover:bg-[hsl(var(--tech-accent-hover))] transition-all duration-200">
                    <Download className="h-4 w-4" />
                    Export All
                  </button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <div className="bg-[hsl(var(--tech-bg-secondary))] border border-[hsl(var(--tech-border))] rounded-lg p-6">
                    <div className="flex items-center justify-between mb-4">
                      <FileText className="h-8 w-8 text-[hsl(var(--tech-accent))]" />
                      <span className="text-xs text-[hsl(var(--tech-text-secondary))] bg-[hsl(var(--tech-accent-muted))] px-2 py-1 rounded">
                        Weekly
                      </span>
                    </div>
                    <h3 className="text-lg font-semibold text-[hsl(var(--tech-text-primary))] mb-2">Performance Summary</h3>
                    <p className="text-[hsl(var(--tech-text-secondary))] text-sm mb-4">
                      Weekly overview of your gameplay metrics and improvements.
                    </p>
                    <button className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[hsl(var(--tech-bg-tertiary))] border border-[hsl(var(--tech-border))] rounded text-[hsl(var(--tech-text-primary))] hover:bg-[hsl(var(--tech-accent-muted))] hover:border-[hsl(var(--tech-accent))] transition-all duration-200">
                      <Download className="h-4 w-4" />
                      Download
                    </button>
                  </div>
                  
                  <div className="bg-[hsl(var(--tech-bg-secondary))] border border-[hsl(var(--tech-border))] rounded-lg p-6">
                    <div className="flex items-center justify-between mb-4">
                      <TrendingUp className="h-8 w-8 text-[hsl(var(--tech-accent))]" />
                      <span className="text-xs text-[hsl(var(--tech-text-secondary))] bg-[hsl(var(--tech-accent-muted))] px-2 py-1 rounded">
                        Monthly
                      </span>
                    </div>
                    <h3 className="text-lg font-semibold text-[hsl(var(--tech-text-primary))] mb-2">Progress Report</h3>
                    <p className="text-[hsl(var(--tech-text-secondary))] text-sm mb-4">
                      Monthly analysis of skill development and technique improvements.
                    </p>
                    <button className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[hsl(var(--tech-bg-tertiary))] border border-[hsl(var(--tech-border))] rounded text-[hsl(var(--tech-text-primary))] hover:bg-[hsl(var(--tech-accent-muted))] hover:border-[hsl(var(--tech-accent))] transition-all duration-200">
                      <Download className="h-4 w-4" />
                      Download
                    </button>
                  </div>
                  
                  <div className="bg-[hsl(var(--tech-bg-secondary))] border border-[hsl(var(--tech-border))] rounded-lg p-6">
                    <div className="flex items-center justify-between mb-4">
                      <Calendar className="h-8 w-8 text-[hsl(var(--tech-accent))]" />
                      <span className="text-xs text-[hsl(var(--tech-text-secondary))] bg-[hsl(var(--tech-accent-muted))] px-2 py-1 rounded">
                        Custom
                      </span>
                    </div>
                    <h3 className="text-lg font-semibold text-[hsl(var(--tech-text-primary))] mb-2">Custom Report</h3>
                    <p className="text-[hsl(var(--tech-text-secondary))] text-sm mb-4">
                      Generate reports for specific date ranges and metrics.
                    </p>
                    <button className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[hsl(var(--tech-bg-tertiary))] border border-[hsl(var(--tech-border))] rounded text-[hsl(var(--tech-text-primary))] hover:bg-[hsl(var(--tech-accent-muted))] hover:border-[hsl(var(--tech-accent))] transition-all duration-200">
                      <Download className="h-4 w-4" />
                      Generate
                    </button>
                  </div>
                </div>
                
                <div className="bg-[hsl(var(--tech-bg-secondary))] border border-[hsl(var(--tech-border))] rounded-lg p-6">
                  <h2 className="text-xl font-semibold text-[hsl(var(--tech-text-primary))] mb-4">Recent Reports</h2>
                  <div className="flex items-center justify-center h-32 text-[hsl(var(--tech-text-secondary))]">
                    No reports generated yet. Upload and analyze videos to generate reports.
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