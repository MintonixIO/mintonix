"use client";

import { createClient } from "@/lib/supabase/client";
import { VideoUpload } from "@/components/dashboard/VideoUpload";
import { VideoGrid } from "@/components/dashboard/VideoGrid";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { Toaster } from "react-hot-toast";
import { useEffect, useState } from "react";

export default function DashboardPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    const checkAuth = async () => {
      const supabase = createClient();
      const { data, error } = await supabase.auth.getClaims();

      if (error || !data?.claims) {
        window.location.href = "/auth/login";
        return;
      }

      setUserId(data.claims.sub);
    };

    checkAuth();
  }, []);

  const handleVideoUploaded = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  const handleVideoDeleted = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  if (!userId) {
    return (
      <div className="min-h-screen bg-[hsl(var(--tech-bg))] flex items-center justify-center">
        <div className="text-[hsl(var(--tech-text-primary))]">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[hsl(var(--tech-bg))] flex overflow-hidden">
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: 'hsl(var(--tech-bg-secondary))',
            color: 'hsl(var(--tech-text-primary))',
            border: '1px solid hsl(var(--tech-border))',
          },
        }}
      />

      {/* Sidebar */}
      <DashboardSidebar className="flex-shrink-0" refreshTrigger={refreshTrigger} />

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-[hsl(var(--tech-bg))]">
        <div className="h-full">
          <div className="p-8">
            <div className="max-w-7xl mx-auto">
              <div className="flex flex-col gap-8">
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-3xl font-bold text-[hsl(var(--tech-text-primary))] mb-2">Video Dashboard</h1>
                    <p className="text-[hsl(var(--tech-text-secondary))]">Analyze and manage your badminton gameplay</p>
                  </div>
                </div>
                
                <VideoUpload userId={userId} onVideoUploaded={handleVideoUploaded} />

                <div className="mt-8">
                  <div className="flex items-center gap-3 mb-6">
                    <h2 className="text-2xl font-semibold text-[hsl(var(--tech-text-primary))]">Your Videos</h2>
                    <div className="h-px flex-1 bg-gradient-to-r from-[hsl(var(--tech-border))] to-transparent"></div>
                  </div>
                  <VideoGrid userId={userId} refreshTrigger={refreshTrigger} onVideoDeleted={handleVideoDeleted} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}