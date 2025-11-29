"use client";

import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { Clock, ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function BillingPage() {
  return (
    <div className="min-h-screen bg-[hsl(var(--tech-bg))] flex">
      {/* Sidebar */}
      <DashboardSidebar className="flex-shrink-0" />

      {/* Main Content */}
      <main className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
          <div className="p-8">
            <div className="max-w-2xl mx-auto">
              <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
                <div className="w-20 h-20 bg-[hsl(var(--tech-accent))]/10 rounded-2xl flex items-center justify-center mb-6">
                  <Clock className="h-10 w-10 text-[hsl(var(--tech-accent))]" />
                </div>

                <h1 className="text-3xl font-bold text-[hsl(var(--tech-text-primary))] mb-4">
                  Billing Coming Soon
                </h1>

                <p className="text-[hsl(var(--tech-text-secondary))] text-lg mb-2">
                  You&apos;re currently on the <span className="font-semibold text-[hsl(var(--tech-accent))]">Free</span> plan.
                </p>

                <p className="text-[hsl(var(--tech-text-muted))] mb-8 max-w-md">
                  Billing and subscription management will be available soon.
                  For now, enjoy your free access!
                </p>

                <Link
                  href="/dashboard"
                  className="flex items-center gap-2 px-6 py-3 bg-[hsl(var(--tech-accent))] hover:bg-[hsl(var(--tech-accent-hover))] text-white rounded-lg transition-colors"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Dashboard
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
