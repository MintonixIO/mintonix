"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import toast from "react-hot-toast";
import { generateThumbnailFromVideo } from "@/lib/thumbnail";

interface ThumbnailRegeneratorProps {
  userId: string;
  videoId: string;
  videoKey: string;
  videoElement?: HTMLVideoElement | null;
  onThumbnailRegenerated?: () => void;
  className?: string;
}

export function ThumbnailRegenerator({
                                       userId,
                                       videoId,
                                       videoElement,
                                       onThumbnailRegenerated,
                                       className = ""
                                     }: ThumbnailRegeneratorProps) {
  const [isRegenerating, setIsRegenerating] = useState(false);

  const regenerateThumbnail = async () => {
    if (!videoElement) {
      toast.error("Video not loaded yet. Please wait for video to load.");
      return;
    }

    setIsRegenerating(true);
    const regenerateToast = toast.loading("Regenerating thumbnail...");

    try {
      // Generate new thumbnail from current video
      const thumbnailDataUrl = await generateThumbnailFromVideo(videoElement, 0.2);

      // Convert to base64 data
      const base64Data = thumbnailDataUrl.replace(/^data:image\/jpeg;base64,/, '');

      // Upload new thumbnail
      const response = await fetch('/api/regenerate-thumbnail', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          videoId,
          thumbnailData: base64Data
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to regenerate thumbnail');
      }

      toast.success("Thumbnail regenerated successfully!", { id: regenerateToast });

      // Call callback to refresh visualization
      onThumbnailRegenerated?.();

    } catch (error) {
      console.error('Thumbnail regeneration error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to regenerate thumbnail';
      toast.error(errorMessage, { id: regenerateToast });
    } finally {
      setIsRegenerating(false);
    }
  };

  return (
      <Button
          variant="outline"
          size="sm"
          onClick={regenerateThumbnail}
          disabled={isRegenerating || !videoElement}
          className={className}
      >
        <RefreshCw className={`h-3 w-3 mr-2 ${isRegenerating ? 'animate-spin' : ''}`} />
        {isRegenerating ? 'Regenerating...' : 'Regenerate Frame'}
      </Button>
  );
}