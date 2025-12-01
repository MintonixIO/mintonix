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
      // Generate multi-resolution thumbnails from current video frame
      const currentTime = videoElement.currentTime / videoElement.duration;

      const [small, medium, large] = await Promise.all([
        generateThumbnailFromVideo(videoElement, { timestamp: currentTime, width: 320, height: 180 }),
        generateThumbnailFromVideo(videoElement, { timestamp: currentTime, width: 640, height: 360 }),
        generateThumbnailFromVideo(videoElement, { timestamp: currentTime, width: 1280, height: 720 }),
      ]);

      // Upload all resolutions
      const uploadPromises = [];

      if (small.dataUrl) {
        const base64Small = small.dataUrl.replace(/^data:image\/(jpeg|webp);base64,/, '');
        uploadPromises.push(
          fetch('/api/regenerate-thumbnail', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId,
              videoId,
              thumbnailData: base64Small,
              size: 'small',
              format: small.format,
            })
          })
        );
      }

      if (medium.dataUrl) {
        const base64Medium = medium.dataUrl.replace(/^data:image\/(jpeg|webp);base64,/, '');
        uploadPromises.push(
          fetch('/api/regenerate-thumbnail', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId,
              videoId,
              thumbnailData: base64Medium,
              format: medium.format,
            })
          })
        );
      }

      if (large.dataUrl) {
        const base64Large = large.dataUrl.replace(/^data:image\/(jpeg|webp);base64,/, '');
        uploadPromises.push(
          fetch('/api/regenerate-thumbnail', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId,
              videoId,
              thumbnailData: base64Large,
              size: 'large',
              format: large.format,
            })
          })
        );
      }

      const responses = await Promise.all(uploadPromises);
      const failedUploads = responses.filter(r => !r.ok);

      if (failedUploads.length > 0) {
        throw new Error(`Failed to upload ${failedUploads.length} thumbnail(s)`);
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