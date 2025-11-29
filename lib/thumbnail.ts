export const generateThumbnailFromVideo = (video: HTMLVideoElement, timestamp: number = 0.2): Promise<string> => {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      reject(new Error('Failed to get canvas context'));
      return;
    }

    // Set canvas size to match video or use standard resolution
    canvas.width = 640;
    canvas.height = 360;
    
    // Store original time and seek to timestamp
    const originalTime = video.currentTime;
    const targetTime = Math.min(video.duration * timestamp, video.duration - 1);
    
    const onSeeked = () => {
      try {
        // Enable image smoothing for better quality
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        
        // Draw the current video frame to canvas
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Convert to blob and then to data URL
        canvas.toBlob((blob) => {
          if (blob) {
            const reader = new FileReader();
            reader.onload = () => {
              // Restore original playback position
              video.currentTime = originalTime;
              resolve(reader.result as string);
            };
            reader.onerror = () => {
              video.currentTime = originalTime;
              reject(new Error('Failed to read thumbnail blob'));
            };
            reader.readAsDataURL(blob);
          } else {
            video.currentTime = originalTime;
            reject(new Error('Failed to create thumbnail blob'));
          }
        }, 'image/jpeg', 0.95);
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

export const generateThumbnailFromFile = (file: File, timestamp: number = 0.2): Promise<string> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    
    video.onloadeddata = () => {
      // Seek to timestamp of video duration
      const targetTime = Math.min(video.duration * timestamp, video.duration - 1);
      video.currentTime = targetTime;
    };
    
    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      canvas.width = 640;
      canvas.height = 360;
      
      // Enable image smoothing for better quality
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      canvas.toBlob((blob) => {
        if (blob) {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('Failed to read thumbnail'));
          reader.readAsDataURL(blob);
        } else {
          reject(new Error('Failed to create thumbnail'));
        }
      }, 'image/jpeg', 0.95);
    };
    
    video.onerror = () => reject(new Error('Failed to load video'));
    
    // Create object URL from file
    video.src = URL.createObjectURL(file);
  });
};