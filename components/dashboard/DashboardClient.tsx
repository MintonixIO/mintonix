"use client";

import { useState } from "react";
import { VideoUpload } from "@/components/dashboard/VideoUpload";
import { VideoGrid } from "@/components/dashboard/VideoGrid";
import { Toaster } from "react-hot-toast";

interface DashboardClientProps {
  userId: string;
}

export function DashboardClient({ userId }: DashboardClientProps) {
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleVideoUploaded = () => {
    // Trigger a refresh of the video grid
    setRefreshTrigger(prev => prev + 1);
  };

  return (
    <>
      <Toaster 
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: 'hsl(var(--background))',
            color: 'hsl(var(--foreground))',
            border: '1px solid hsl(var(--border))',
          },
        }}
      />
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col gap-8">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold">Video Dashboard</h1>
          </div>
          
          <VideoUpload userId={userId} onVideoUploaded={handleVideoUploaded} />
          
          <div className="mt-8">
            <h2 className="text-2xl font-semibold mb-4">Your Videos</h2>
            <VideoGrid userId={userId} refreshTrigger={refreshTrigger} />
          </div>
        </div>
      </div>
    </>
  );
}