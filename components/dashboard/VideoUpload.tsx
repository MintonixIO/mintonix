"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, FileVideo, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { generateThumbnailFromFile } from "@/lib/thumbnail";

interface VideoUploadProps {
  userId: string;
  onVideoUploaded?: () => void;
  userSubscription?: {
    hours_remaining: number;
    hours_included: number;
    plan_type: string;
  };
}

export function VideoUpload({ userId, onVideoUploaded, userSubscription }: VideoUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);


  const handleFileUpload = async (file: File) => {
    if (!file.type.startsWith('video/')) {
      toast.error('Please select a video file');
      return;
    }

    setIsUploading(true);
    const uploadToast = toast.loading(`Uploading ${file.name}...`);

    try {
      // Generate thumbnail with timeout and error handling
      let thumbnailDataUrl = '';
      try {
        const thumbnailPromise = generateThumbnailFromFile(file);
        const timeoutPromise = new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('Thumbnail generation timeout')), 10000)
        );
        thumbnailDataUrl = await Promise.race([thumbnailPromise, timeoutPromise]);
      } catch {
        // Continue upload without thumbnail
      }

      const formData = new FormData();
      formData.append('file', file);
      formData.append('userId', userId);
      formData.append('fileName', file.name);
      if (thumbnailDataUrl) {
        formData.append('thumbnail', thumbnailDataUrl);
      }

      const response = await fetch('/api/upload-video', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch {
          throw new Error(`Upload failed with status ${response.status}`);
        }
        throw new Error(errorData?.error || `Upload failed with status ${response.status}`);
      }

      const result = await response.json();

      const successMessage = result.minutes_consumed ?
        `${file.name} uploaded successfully! Used ${(parseFloat(result.minutes_consumed) / 60).toFixed(1)} hours.` :
        `${file.name} uploaded successfully!`;

      toast.success(successMessage, { id: uploadToast });

      // Wait a bit longer for R2 to propagate before refreshing video list
      // This helps ensure the video is actually streamable when the player loads it
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Call the callback to refresh the video list
      onVideoUploaded?.();
    } catch (error) {
      let errorMessage = 'Upload failed. Please try again.';

      if (error instanceof Error) {
        errorMessage = error.message;
        // Add more context for common errors
        if (error.message.includes('Insufficient minutes') || error.message.includes('Insufficient hours')) {
          errorMessage = 'You have reached your usage limit. Please upgrade your plan to upload more videos.';
        } else if (error.message.includes('timeout')) {
          errorMessage = 'Upload timed out. The file may be too large or your connection is slow.';
        } else if (error.message.includes('network')) {
          errorMessage = 'Network error. Please check your internet connection and try again.';
        }
      }

      toast.error(errorMessage, { id: uploadToast, duration: 5000 });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileUpload(e.target.files[0]);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileVideo className="h-5 w-5" />
          Upload Video
        </CardTitle>
        <CardDescription>
          Upload your badminton videos for AI-powered analysis
          {userSubscription && (
            <div className="mt-2 text-sm">
              <span className={`font-medium ${
                userSubscription.hours_remaining < 1 ? 'text-red-600' :
                userSubscription.hours_remaining < 5 ? 'text-orange-600' : 'text-green-600'
              }`}>
                {userSubscription.hours_remaining.toFixed(1)} hours remaining
              </span>
              <span className="text-muted-foreground"> of {userSubscription.hours_included} hours ({userSubscription.plan_type})</span>
            </div>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            dragActive 
              ? 'border-primary bg-primary/5' 
              : 'border-muted-foreground/25 hover:border-primary/50'
          }`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          {isUploading ? (
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="text-lg font-medium">Uploading video...</p>
              <p className="text-sm text-muted-foreground">Please wait while we process your video</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <Upload className="h-12 w-12 text-muted-foreground" />
              <div className="flex flex-col gap-2">
                <p className="text-lg font-medium">Drop your video here</p>
                <p className="text-sm text-muted-foreground">or click to browse files</p>
              </div>
              <Button asChild variant="outline">
                <label className="cursor-pointer">
                  Select Video
                  <input
                    type="file"
                    accept="video/*"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </label>
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}