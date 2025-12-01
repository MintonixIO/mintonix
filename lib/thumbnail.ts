interface ThumbnailOptions {
  timestamp?: number;
  width?: number;
  height?: number;
  quality?: number;
  format?: 'jpeg' | 'webp';
  preserveAspectRatio?: boolean;
}

interface ThumbnailResult {
  dataUrl: string;
  format: string;
  width: number;
  height: number;
}

const DEFAULT_OPTIONS: Required<ThumbnailOptions> = {
  timestamp: 0.2,
  width: 640,
  height: 360,
  quality: 0.95,
  format: 'jpeg',
  preserveAspectRatio: true,
};

/**
 * Calculate canvas dimensions preserving aspect ratio with letterboxing
 */
function calculateDimensions(
  videoWidth: number,
  videoHeight: number,
  targetWidth: number,
  targetHeight: number,
  preserveAspectRatio: boolean
): { canvasWidth: number; canvasHeight: number; drawX: number; drawY: number; drawWidth: number; drawHeight: number } {
  if (!preserveAspectRatio) {
    return {
      canvasWidth: targetWidth,
      canvasHeight: targetHeight,
      drawX: 0,
      drawY: 0,
      drawWidth: targetWidth,
      drawHeight: targetHeight,
    };
  }

  const videoAspectRatio = videoWidth / videoHeight;
  const targetAspectRatio = targetWidth / targetHeight;

  let drawWidth = targetWidth;
  let drawHeight = targetHeight;
  let drawX = 0;
  let drawY = 0;

  if (videoAspectRatio > targetAspectRatio) {
    // Video is wider - fit to width
    drawHeight = targetWidth / videoAspectRatio;
    drawY = (targetHeight - drawHeight) / 2;
  } else {
    // Video is taller - fit to height
    drawWidth = targetHeight * videoAspectRatio;
    drawX = (targetWidth - drawWidth) / 2;
  }

  return {
    canvasWidth: targetWidth,
    canvasHeight: targetHeight,
    drawX,
    drawY,
    drawWidth,
    drawHeight,
  };
}

/**
 * Generate thumbnail from a video element with retry logic
 */
export const generateThumbnailFromVideo = (
  video: HTMLVideoElement,
  options: ThumbnailOptions = {}
): Promise<ThumbnailResult> => {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Failed to get canvas context'));
      return;
    }

    // Store original time and seek to timestamp
    const originalTime = video.currentTime;
    const targetTime = Math.min(video.duration * opts.timestamp, video.duration - 1);

    const onSeeked = () => {
      try {
        // Calculate dimensions with aspect ratio preservation
        const dimensions = calculateDimensions(
          video.videoWidth,
          video.videoHeight,
          opts.width,
          opts.height,
          opts.preserveAspectRatio
        );

        canvas.width = dimensions.canvasWidth;
        canvas.height = dimensions.canvasHeight;

        // Fill with black background (for letterboxing)
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Enable image smoothing for better quality
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Draw the video frame with proper positioning
        ctx.drawImage(
          video,
          dimensions.drawX,
          dimensions.drawY,
          dimensions.drawWidth,
          dimensions.drawHeight
        );

        // Determine MIME type and fallback
        const mimeType = opts.format === 'webp' ? 'image/webp' : 'image/jpeg';

        // Convert to blob
        canvas.toBlob(
          (blob) => {
            if (blob) {
              const reader = new FileReader();
              reader.onload = () => {
                // Restore original playback position
                video.currentTime = originalTime;
                resolve({
                  dataUrl: reader.result as string,
                  format: opts.format,
                  width: canvas.width,
                  height: canvas.height,
                });
              };
              reader.onerror = () => {
                video.currentTime = originalTime;
                reject(new Error('Failed to read thumbnail blob'));
              };
              reader.readAsDataURL(blob);
            } else {
              video.currentTime = originalTime;
              // If WebP fails, retry with JPEG
              if (opts.format === 'webp') {
                generateThumbnailFromVideo(video, { ...opts, format: 'jpeg' })
                  .then(resolve)
                  .catch(reject);
              } else {
                reject(new Error('Failed to create thumbnail blob'));
              }
            }
          },
          mimeType,
          opts.quality
        );
      } catch (error) {
        video.currentTime = originalTime;
        reject(error);
      }
    };

    const onError = () => {
      video.currentTime = originalTime;
      reject(new Error('Failed to seek to timestamp'));
    };

    // Set up event listeners
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });

    // Seek to the target time
    video.currentTime = targetTime;
  });
};

/**
 * Generate thumbnail from a file with retry logic and cleanup
 */
export const generateThumbnailFromFile = (
  file: File,
  options: ThumbnailOptions = {}
): Promise<ThumbnailResult> => {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;

    let objectUrl: string | null = null;

    const cleanup = () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
      video.remove();
    };

    video.onloadeddata = () => {
      // Seek to timestamp of video duration
      const targetTime = Math.min(video.duration * opts.timestamp, video.duration - 1);
      video.currentTime = targetTime;
    };

    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        cleanup();
        reject(new Error('Failed to get canvas context'));
        return;
      }

      // Calculate dimensions with aspect ratio preservation
      const dimensions = calculateDimensions(
        video.videoWidth,
        video.videoHeight,
        opts.width,
        opts.height,
        opts.preserveAspectRatio
      );

      canvas.width = dimensions.canvasWidth;
      canvas.height = dimensions.canvasHeight;

      // Fill with black background (for letterboxing)
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Enable image smoothing for better quality
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // Draw the video frame with proper positioning
      ctx.drawImage(
        video,
        dimensions.drawX,
        dimensions.drawY,
        dimensions.drawWidth,
        dimensions.drawHeight
      );

      // Determine MIME type
      const mimeType = opts.format === 'webp' ? 'image/webp' : 'image/jpeg';

      canvas.toBlob(
        (blob) => {
          if (blob) {
            const reader = new FileReader();
            reader.onload = () => {
              cleanup();
              resolve({
                dataUrl: reader.result as string,
                format: opts.format,
                width: canvas.width,
                height: canvas.height,
              });
            };
            reader.onerror = () => {
              cleanup();
              reject(new Error('Failed to read thumbnail'));
            };
            reader.readAsDataURL(blob);
          } else {
            cleanup();
            // If WebP fails, retry with JPEG
            if (opts.format === 'webp') {
              generateThumbnailFromFile(file, { ...opts, format: 'jpeg' })
                .then(resolve)
                .catch(reject);
            } else {
              reject(new Error('Failed to create thumbnail'));
            }
          }
        },
        mimeType,
        opts.quality
      );
    };

    video.onerror = () => {
      cleanup();
      reject(new Error('Failed to load video'));
    };

    // Create object URL from file
    objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;
  });
};

/**
 * Generate multiple thumbnail resolutions from a file
 */
export const generateMultiResolutionThumbnails = async (
  file: File,
  options: ThumbnailOptions = {}
): Promise<{ small: ThumbnailResult; medium: ThumbnailResult; large: ThumbnailResult }> => {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Try WebP first, fallback to JPEG if browser doesn't support it
  const format = await (async () => {
    try {
      const testCanvas = document.createElement('canvas');
      testCanvas.width = 1;
      testCanvas.height = 1;
      const testBlob = await new Promise<Blob | null>((resolve) =>
        testCanvas.toBlob(resolve, 'image/webp')
      );
      return testBlob ? 'webp' : 'jpeg';
    } catch {
      return 'jpeg';
    }
  })();

  // Generate three resolutions in parallel
  const [small, medium, large] = await Promise.all([
    generateThumbnailFromFile(file, {
      ...opts,
      width: 320,
      height: 180,
      format,
    }),
    generateThumbnailFromFile(file, {
      ...opts,
      width: 640,
      height: 360,
      format,
    }),
    generateThumbnailFromFile(file, {
      ...opts,
      width: 1280,
      height: 720,
      format,
    }),
  ]);

  return { small, medium, large };
};

/**
 * Retry thumbnail generation with exponential backoff
 */
export const generateThumbnailWithRetry = async (
  file: File,
  options: ThumbnailOptions = {},
  maxRetries: number = 3
): Promise<ThumbnailResult> => {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await generateThumbnailFromFile(file, options);
    } catch (error) {
      lastError = error as Error;

      // Wait with exponential backoff before retrying
      if (attempt < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  throw lastError || new Error('Failed to generate thumbnail after retries');
};
