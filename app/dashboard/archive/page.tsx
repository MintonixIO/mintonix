"use client";

import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { Archive, Search, Filter } from "lucide-react";

export default function ArchivePage() {
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
                    <h1 className="text-3xl font-bold text-[hsl(var(--tech-text-primary))] mb-2">Video Archive</h1>
                    <p className="text-[hsl(var(--tech-text-secondary))]">Browse and manage your archived videos</p>
                  </div>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[hsl(var(--tech-text-secondary))] h-4 w-4" />
                    <input
                      type="text"
                      placeholder="Search archived videos..."
                      className="w-full pl-10 pr-4 py-2 bg-[hsl(var(--tech-bg-secondary))] border border-[hsl(var(--tech-border))] rounded-lg text-[hsl(var(--tech-text-primary))] placeholder-[hsl(var(--tech-text-secondary))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--tech-accent))] focus:border-transparent"
                    />
                  </div>
                  <button className="flex items-center gap-2 px-4 py-2 bg-[hsl(var(--tech-bg-secondary))] border border-[hsl(var(--tech-border))] rounded-lg text-[hsl(var(--tech-text-primary))] hover:bg-[hsl(var(--tech-accent-muted))] hover:border-[hsl(var(--tech-accent))] transition-all duration-200">
                    <Filter className="h-4 w-4" />
                    Filter
                  </button>
                </div>
                
                <div className="bg-[hsl(var(--tech-bg-secondary))] border border-[hsl(var(--tech-border))] rounded-lg p-8">
                  <div className="flex flex-col items-center justify-center h-64 text-center">
                    <Archive className="h-16 w-16 text-[hsl(var(--tech-text-secondary))] mb-4" />
                    <h3 className="text-lg font-semibold text-[hsl(var(--tech-text-primary))] mb-2">No archived videos</h3>
                    <p className="text-[hsl(var(--tech-text-secondary))]">
                      Your archived videos will appear here when you move them to the archive.
                    </p>
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