/**
 * Enhanced Video Player for Badminton Analysis
 * 
 * This component provides an advanced video player specifically designed for 
 * analyzing badminton gameplay with professional controls and shot markers.
 * 
 * KEY FEATURES:
 * ============
 * 
 * 🎮 Advanced Playback Controls:
 * - Play/pause with large center button overlay
 * - Frame-by-frame navigation (←/→ for stepping)
 * - Multiple playback speeds (0.25x to 2x)
 * - Precise timeline scrubbing with smooth seeking
 * - Volume control with mute toggle
 * - Fullscreen mode support
 * 
 * ⌨️ Comprehensive Keyboard Shortcuts:
 * - Space/K: Play/Pause
 * - ←/→ or J/L: Seek ±10 seconds
 * - Shift+←/→ or ,/.: Frame-by-frame stepping
 * - ↑/↓: Volume control
 * - M: Mute toggle
 * - F: Fullscreen
 * 
 * 📍 Shot Markers System:
 * - Visual timeline markers for key analysis points
 * - Color-coded by type: Red (shots), Yellow (rallies), Green (points)
 * - Click-to-jump navigation
 * - Hover tooltips with marker details
 * - Integrates with analysis results from AI processing
 * 
 * 🎨 Professional UI:
 * - Controls positioned below video (no overlay interference)
 * - Light/dark theme support
 * - Organized control groups (playback, audio, display)
 * - Hover-based help system for reduced clutter
 * - Mobile responsive design
 * 
 * SHOT MARKERS INTEGRATION:
 * =========================
 * 
 * To integrate with analysis results, pass markers via the shotMarkers prop:
 * 
 * ```typescript
 * // Example with analysis results
 * const markers = [
 *   { time: 30.5, label: "Serve", type: "shot" },
 *   { time: 45.2, label: "Rally Start", type: "rally" },
 *   { time: 67.8, label: "Smash Winner", type: "shot" },
 *   { time: 89.1, label: "Point Won", type: "point" }
 * ];
 * 
 * <VideoPlayer 
 *   video={videoData}
 *   shotMarkers={markers}
 *   onTimeUpdate={(time) => syncWithAnalysis(time)}
 * />
 * ```
 * 
 * The onTimeUpdate callback can be used to synchronize the video playback
 * with other analysis visualizations (court diagrams, statistics, etc.).
 * 
 * @author Mintonix Development Team
 * @version 2.0.0
 * @since 2024-01-01
 */

"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2, Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Maximize } from "lucide-react";
import { getVideoUrl } from "@/lib/r2";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

interface Video {
  key: string;
  fileName: string;
  size: number;
  uploadedAt: string;
  userId: string;
  videoId: string;
}

/**
 * Shot Marker Object Structure
 * 
 * @interface ShotMarker
 * @property {number} time - Timestamp in seconds where the marker should appear
 * @property {string} label - Display name for the marker (shown on hover)
 * @property {'shot' | 'rally' | 'point'} [type] - Marker type affecting color:
 *   - 'shot': Red markers for individual shots (serves, smashes, drops, etc.)
 *   - 'rally': Yellow markers for rally segments or exchanges
 *   - 'point': Green markers for scoring moments or game points
 */
interface ShotMarker {
  time: number;
  label: string;
  type?: 'shot' | 'rally' | 'point';
}

/**
 * Enhanced Video Player Props
 * 
 * @interface VideoPlayerProps
 * @property {Video} video - Video metadata object containing file info
 * @property {function} [onDurationChange] - Callback when video duration is loaded
 * @property {function} [onVideoElementReady] - Callback with video HTML element reference
 * @property {ShotMarker[]} [shotMarkers] - Array of timeline markers for analysis points
 * @property {function} [onTimeUpdate] - Callback fired on video time updates for sync
 */
interface VideoPlayerProps {
  video: Video;
  videoId?: string;
  showProcessed?: boolean;
  onDurationChange?: (duration: number) => void;
  onVideoElementReady?: (videoElement: HTMLVideoElement | null) => void;
  shotMarkers?: ShotMarker[];
  onTimeUpdate?: (currentTime: number) => void;
  onProcessedVideoNotFound?: () => void;
}

export function VideoPlayer({ video, videoId, showProcessed = true, onDurationChange, onVideoElementReady, shotMarkers = [], onTimeUpdate, onProcessedVideoNotFound }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControlsInFullscreen, setShowControlsInFullscreen] = useState(true);
  const [fullscreenControlsTimeout, setFullscreenControlsTimeout] = useState<NodeJS.Timeout | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDraggingVolume, setIsDraggingVolume] = useState(false);
  const [isDraggingTimeline, setIsDraggingTimeline] = useState(false);
  const [dragVolumePosition, setDragVolumePosition] = useState<number | null>(null);
  const [dragTimelinePosition, setDragTimelinePosition] = useState<number | null>(null);

  useEffect(() => {
    loadVideo();
  }, [video, showProcessed]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadVideo = async (attemptNumber = 0) => {
    setLoading(true);
    setLoadError(null);

    try {
      let url;
      if (showProcessed && videoId) {
        // Load processed video
        const response = await fetch(`/api/processed-video-url?videoId=${videoId}`);
        if (response.ok) {
          const data = await response.json();
          if (data.exists && data.url) {
            url = data.url;
          } else {
            // Fall back to original if processed doesn't exist
            url = await getVideoUrl(video.key);
            // Notify parent that processed video doesn't exist
            if (onProcessedVideoNotFound) {
              onProcessedVideoNotFound();
            }
          }
        } else {
          // Failed to check for processed video, using original
          url = await getVideoUrl(video.key);
          // Notify parent that processed video doesn't exist
          if (onProcessedVideoNotFound) {
            onProcessedVideoNotFound();
          }
        }
      } else {
        // Load original video
        url = await getVideoUrl(video.key);
      }

      // Pre-flight check: verify the video URL is accessible
      const checkResponse = await fetch(url, { method: 'HEAD' });

      if (!checkResponse.ok) {
        // Don't retry on 500 errors - likely a server issue, not a transient network issue
        if (checkResponse.status >= 500) {
          const errorText = `Server error ${checkResponse.status}. Please check server logs.`;
          setLoadError(errorText);
          setLoading(false);
          return;
        }

        const errorText = checkResponse.status === 404
          ? 'Video file not found in storage. It may still be uploading.'
          : `Video endpoint returned ${checkResponse.status}`;
        throw new Error(errorText);
      }
      setVideoUrl(url);
      setLoadError(null);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load video';

      // Retry up to 2 times with exponential backoff
      if (attemptNumber < 2) {
        const delay = Math.pow(2, attemptNumber) * 2000; // 2s, 4s
        setLoadError(`${errorMessage} Retrying... (${attemptNumber + 1}/2)`);
        setTimeout(() => {
          setRetryCount(attemptNumber + 1);
          loadVideo(attemptNumber + 1);
        }, delay);
      } else {
        setLoadError(errorMessage);
        setLoading(false);
      }
      return;
    }

    setLoading(false);
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      const dur = videoRef.current.duration;
      setDuration(dur);
      onDurationChange?.(dur);
      onVideoElementReady?.(videoRef.current);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const time = videoRef.current.currentTime;
      setCurrentTime(time);
      onTimeUpdate?.(time);
    }
  };


  const togglePlay = useCallback(() => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
    }
  }, [isPlaying]);

  const handlePlay = () => setIsPlaying(true);
  const handlePause = () => setIsPlaying(false);

  const handleVideoError = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    const videoElement = e.currentTarget;
    const error = videoElement.error;

    if (error) {
      let errorMessage = 'Video playback failed';
      switch (error.code) {
        case MediaError.MEDIA_ERR_ABORTED:
          errorMessage = 'Video loading was aborted. The video may still be processing.';
          break;
        case MediaError.MEDIA_ERR_NETWORK:
          errorMessage = 'Network error while loading video';
          break;
        case MediaError.MEDIA_ERR_DECODE:
          errorMessage = 'Video decoding failed';
          break;
        case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
          errorMessage = 'Video format not supported or file not found';
          break;
      }

      // Only retry on network errors, not on decode/format errors
      // Limit retries to 1 to prevent spam
      if (error.code === MediaError.MEDIA_ERR_NETWORK && retryCount < 1) {
        const delay = 2000; // 2s delay
        setLoadError(`${errorMessage}. Retrying... (${retryCount + 1}/1)`);
        setTimeout(() => {
          setRetryCount(retryCount + 1);
          // Force reload the video element
          if (videoRef.current) {
            videoRef.current.load();
          }
        }, delay);
      } else {
        setLoadError(errorMessage);
      }
    }
  };

  const seekTo = useCallback((time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, Math.min(time, duration));
      setCurrentTime(time);
    }
  }, [duration]);

  const seekRelative = useCallback((seconds: number) => {
    seekTo(currentTime + seconds);
  }, [currentTime, seekTo]);

  const frameStep = useCallback((forward: boolean = true) => {
    if (videoRef.current) {
      const frameRate = 30; // Assume 30fps, could be detected from video
      const frameTime = 1 / frameRate;
      seekRelative(forward ? frameTime : -frameTime);
    }
  }, [seekRelative]);

  const setPlaybackSpeed = (rate: number) => {
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
      setPlaybackRate(rate);
    }
  };

  const toggleMute = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  }, [isMuted]);

  const handleVolumeChange = useCallback((newVolume: number) => {
    const vol = Math.max(0, Math.min(1, newVolume));
    if (videoRef.current) {
      videoRef.current.volume = vol;
      setVolume(vol);
      setIsMuted(vol === 0);
    }
  }, []);

  const handleVolumeMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingVolume(true);

    const rect = e.currentTarget.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setDragVolumePosition(percent);
    handleVolumeChange(percent);
  }, [handleVolumeChange]);

  const handleTimelineMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingTimeline(true);

    const rect = e.currentTarget.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setDragTimelinePosition(percent);
    const newTime = Math.max(0, Math.min(duration, percent * duration));
    seekTo(newTime);
  }, [duration, seekTo]);

  const hideFullscreenControls = useCallback(() => {
    if (fullscreenControlsTimeout) {
      clearTimeout(fullscreenControlsTimeout);
    }
    const timeout = setTimeout(() => {
      if (isPlaying && isFullscreen) {
        setShowControlsInFullscreen(false);
      }
    }, 3000);
    setFullscreenControlsTimeout(timeout);
  }, [fullscreenControlsTimeout, isPlaying, isFullscreen]);

  const showFullscreenControls = useCallback(() => {
    setShowControlsInFullscreen(true);
    if (isFullscreen) {
      hideFullscreenControls();
    }
  }, [isFullscreen, hideFullscreenControls]);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;

    if (!isFullscreen) {
      if (containerRef.current.requestFullscreen) {
        containerRef.current.requestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  }, [isFullscreen]);


  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };


  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.target !== document.body) return; // Only when not in input fields
      
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (e.shiftKey) {
            frameStep(false);
          } else {
            seekRelative(-10);
          }
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey) {
            frameStep(true);
          } else {
            seekRelative(10);
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          handleVolumeChange(Math.min(1, volume + 0.1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          handleVolumeChange(Math.max(0, volume - 0.1));
          break;
        case 'm':
          toggleMute();
          break;
        case 'f':
          toggleFullscreen();
          break;
        case ',':
          e.preventDefault();
          frameStep(false);
          break;
        case '.':
          e.preventDefault();
          frameStep(true);
          break;
        case 'j':
          seekRelative(-10);
          break;
        case 'l':
          seekRelative(10);
          break;
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [togglePlay, volume, frameStep, seekRelative, toggleFullscreen, toggleMute, handleVolumeChange]);

  // Fullscreen change listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isNowFullscreen = !!document.fullscreenElement;
      setIsFullscreen(isNowFullscreen);
      if (isNowFullscreen) {
        setShowControlsInFullscreen(true);
        hideFullscreenControls();
      } else {
        if (fullscreenControlsTimeout) {
          clearTimeout(fullscreenControlsTimeout);
        }
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      if (fullscreenControlsTimeout) {
        clearTimeout(fullscreenControlsTimeout);
      }
    };
  }, [hideFullscreenControls, fullscreenControlsTimeout]);

  // Handle dragging for volume and timeline
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingVolume) {
        // Find all volume sliders (normal and fullscreen)
        const volumeSliders = document.querySelectorAll('[data-volume-slider]');
        volumeSliders.forEach((slider) => {
          const rect = slider.getBoundingClientRect();
          if (e.clientY >= rect.top - 20 && e.clientY <= rect.bottom + 20) {
            const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            setDragVolumePosition(percent);
            handleVolumeChange(percent);
          }
        });
      }

      if (isDraggingTimeline) {
        const timelineSliders = document.querySelectorAll('[data-timeline-slider]');
        timelineSliders.forEach((slider) => {
          const rect = slider.getBoundingClientRect();
          if (e.clientY >= rect.top - 50 && e.clientY <= rect.bottom + 50) {
            const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            setDragTimelinePosition(percent);
            const newTime = Math.max(0, Math.min(duration, percent * duration));
            seekTo(newTime);
          }
        });
      }
    };

    const handleMouseUp = () => {
      setIsDraggingVolume(false);
      setIsDraggingTimeline(false);
      setDragVolumePosition(null);
      setDragTimelinePosition(null);
    };

    if (isDraggingVolume || isDraggingTimeline) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      // Prevent text selection while dragging
      document.body.style.userSelect = 'none';

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.userSelect = '';
      };
    }
  }, [isDraggingVolume, isDraggingTimeline, handleVolumeChange, duration, seekTo]);

  // Show controls on mouse movement in fullscreen
  useEffect(() => {
    if (!isFullscreen) return;

    const handleMouseMove = () => {
      showFullscreenControls();
    };

    document.addEventListener('mousemove', handleMouseMove);
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, [isFullscreen, showFullscreenControls]);


  const downloadVideo = () => {
    if (!videoUrl) return;

    setIsDownloading(true);
    try {
      // Parse the current video URL and add download parameters
      const url = new URL(videoUrl, window.location.origin);
      url.searchParams.set('download', 'true');
      url.searchParams.set('filename', video.fileName);

      // Create a temporary link and trigger download
      const link = document.createElement('a');
      link.href = url.toString();
      link.download = video.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('Error downloading video:', error);
      // Fallback: open in new tab
      window.open(videoUrl, '_blank');
    } finally {
      // Reset downloading state after a short delay
      setTimeout(() => setIsDownloading(false), 1000);
    }
  };


  return (
    <div className="w-full">
      {/* Compact Header Bar */}
      <div className="flex items-center justify-between mb-3 px-1">
        <h3 className="text-sm font-medium text-[hsl(var(--tech-text-secondary))] tracking-wide uppercase">
          Analyzed Video
        </h3>
        <div className="flex gap-2">
          {/* Keyboard Shortcuts Help */}
          <div className="group relative">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Shortcuts
            </Button>
            <div className="absolute bottom-full right-0 mb-2 w-80 bg-[hsl(var(--tech-bg-tertiary))] border border-[hsl(var(--tech-border))] rounded-lg shadow-lg p-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none group-hover:pointer-events-auto z-10">
              <div className="text-xs text-[hsl(var(--tech-text-primary))]">
                <div className="font-medium mb-2">Keyboard Shortcuts:</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <span><kbd className="bg-muted px-1 rounded text-xs">Space/K</kbd> Play/Pause</span>
                  <span><kbd className="bg-muted px-1 rounded text-xs">←/→</kbd> Seek ±10s</span>
                  <span><kbd className="bg-muted px-1 rounded text-xs">J/L</kbd> Seek ±10s</span>
                  <span><kbd className="bg-muted px-1 rounded text-xs">Shift+←/→</kbd> Frame step</span>
                  <span><kbd className="bg-muted px-1 rounded text-xs">,/.</kbd> Frame step</span>
                  <span><kbd className="bg-muted px-1 rounded text-xs">↑/↓</kbd> Volume</span>
                  <span><kbd className="bg-muted px-1 rounded text-xs">M</kbd> Mute</span>
                  <span><kbd className="bg-muted px-1 rounded text-xs">F</kbd> Fullscreen</span>
                </div>
              </div>
              {/* Arrow pointing down */}
              <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-[hsl(var(--tech-bg-tertiary))]"></div>
            </div>
          </div>

          <Button
            onClick={downloadVideo}
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={!videoUrl || isDownloading}
          >
            {isDownloading ? (
              <>
                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                Downloading...
              </>
            ) : (
              <>
                <Download className="h-3 w-3 mr-1.5" />
                Download
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Modern Video Container */}
      <div className="bg-[hsl(var(--tech-bg-tertiary))] rounded-xl border border-[hsl(var(--tech-border))]/50 overflow-hidden shadow-sm hover:shadow-md transition-shadow">{/* Video Player Content */}
      <div className="space-y-3 p-3">
        {/* Video Container */}
        <div
          ref={containerRef}
          className={`relative bg-black overflow-hidden group cursor-pointer ${
            isFullscreen ? 'fixed inset-0 z-50' : 'rounded-lg aspect-video'
          }`}
          onClick={togglePlay}
          onMouseMove={isFullscreen ? showFullscreenControls : undefined}
        >
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-white" />
                {loadError && (
                  <p className="text-sm text-white/80 max-w-md text-center px-4">{loadError}</p>
                )}
              </div>
            </div>
          ) : loadError ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black">
              <div className="flex flex-col items-center gap-4 p-6">
                <div className="text-red-400 text-center">
                  <p className="text-lg font-semibold mb-2">Video Loading Failed</p>
                  <p className="text-sm text-white/70 max-w-md">{loadError}</p>
                </div>
                <Button
                  onClick={() => {
                    setRetryCount(0);
                    setLoadError(null);
                    loadVideo(0);
                  }}
                  variant="outline"
                  className="bg-white/10 hover:bg-white/20 text-white border-white/30"
                >
                  Retry Loading
                </Button>
              </div>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                src={videoUrl}
                className="w-full h-full object-contain"
                onLoadedMetadata={handleLoadedMetadata}
                onTimeUpdate={handleTimeUpdate}
                onPlay={handlePlay}
                onPause={handlePause}
                onError={handleVideoError}
                onVolumeChange={() => {
                  if (videoRef.current) {
                    setVolume(videoRef.current.volume);
                    setIsMuted(videoRef.current.muted);
                  }
                }}
              />
              
              {/* Shot Markers System
                  * Renders visual markers on the video timeline for key analysis points
                  * 
                  * Marker Types:
                  * - 'shot': Individual shot analysis (red markers)
                  * - 'rally': Rally segments (yellow markers) 
                  * - 'point': Scoring moments (green markers)
                  * 
                  * Usage:
                  * Pass shotMarkers prop with array of marker objects:
                  * {
                  *   time: number,     // Time in seconds where marker appears
                  *   label: string,    // Description shown on hover
                  *   type: 'shot' | 'rally' | 'point'  // Determines marker color
                  * }
                  * 
                  * Example:
                  * shotMarkers={[
                  *   { time: 30, label: "Serve", type: "shot" },
                  *   { time: 45, label: "Rally Start", type: "rally" },
                  *   { time: 67, label: "Smash", type: "shot" },
                  *   { time: 89, label: "Point Won", type: "point" }
                  * ]}
                  */}
              {shotMarkers.length > 0 && (
                <div className="absolute top-0 left-0 right-0 h-2 bg-[hsl(var(--tech-border))]">
                  {shotMarkers.map((marker, index) => {
                    const position = (marker.time / duration) * 100;
                    const markerColor = marker.type === 'shot' ? 'bg-red-400' : 
                                      marker.type === 'rally' ? 'bg-yellow-400' : 'bg-green-400';
                    return (
                      <div
                        key={index}
                        className={`absolute top-0 w-1 h-full ${markerColor} cursor-pointer hover:w-2 transition-all shadow-sm`}
                        style={{ left: `${position}%` }}
                        onClick={(e) => {
                          e.stopPropagation();
                          seekTo(marker.time);
                        }}
                        title={`${marker.label} (${formatTime(marker.time)})`}
                      />
                    );
                  })}
                </div>
              )}

              {/* Center Play Button Overlay */}
              {!isPlaying && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Button
                    size="lg"
                    className="bg-[hsl(var(--tech-bg-secondary))]/90 hover:bg-[hsl(var(--tech-bg-tertiary))]/95 text-[hsl(var(--tech-text-primary))] border border-[hsl(var(--tech-border))] rounded-full p-4 shadow-lg"
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePlay();
                    }}
                  >
                    <Play className="h-8 w-8" fill="white" />
                  </Button>
                </div>
              )}

              {/* Fullscreen Controls */}
              {isFullscreen && (
                <div 
                  className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent transition-opacity duration-300 ${
                    showControlsInFullscreen ? 'opacity-100' : 'opacity-0'
                  }`}
                  style={{ pointerEvents: showControlsInFullscreen ? 'auto' : 'none' }}
                >
                  <div className="p-6">
                    {/* Timeline */}
                    <div className="mb-4">
                      <div
                        className="relative w-full h-3 bg-gray-600 rounded-full cursor-pointer group"
                        data-timeline-slider
                        onMouseDown={handleTimelineMouseDown}
                      >
                        <div
                          className="absolute top-0 left-0 h-full bg-white rounded-full"
                          style={{
                            width: `${isDraggingTimeline && dragTimelinePosition !== null
                              ? dragTimelinePosition * 100
                              : duration > 0 ? (currentTime / duration) * 100 : 0}%`,
                            transition: isDraggingTimeline ? 'none' : 'all 0.1s'
                          }}
                        />
                        {/* Shot markers in fullscreen */}
                        {shotMarkers.map((marker, index) => {
                          const position = duration > 0 ? (marker.time / duration) * 100 : 0;
                          const markerColor = marker.type === 'shot' ? 'bg-red-400' : 
                                            marker.type === 'rally' ? 'bg-yellow-400' : 'bg-green-400';
                          return (
                            <div
                              key={index}
                              className={`absolute top-0 w-1 h-full ${markerColor} cursor-pointer hover:w-2 transition-all shadow-sm z-10`}
                              style={{ left: `${position}%` }}
                              onClick={(e) => {
                                e.stopPropagation();
                                seekTo(marker.time);
                              }}
                              title={`${marker.label} (${formatTime(marker.time)})`}
                            />
                          );
                        })}
                        <div
                          className="absolute top-1/2 w-5 h-5 bg-white border-2 border-gray-300 rounded-full transform -translate-y-1/2 -translate-x-1/2 shadow-lg group-hover:scale-110"
                          style={{
                            left: `${isDraggingTimeline && dragTimelinePosition !== null
                              ? dragTimelinePosition * 100
                              : duration > 0 ? (currentTime / duration) * 100 : 0}%`,
                            cursor: isDraggingTimeline ? 'grabbing' : 'grab',
                            transition: isDraggingTimeline ? 'none' : 'transform 0.2s'
                          }}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      {/* Playback Controls */}
                      <div className="flex items-center gap-3">
                        <Button
                          variant="ghost"
                          size="lg"
                          className="text-white hover:bg-white/20 p-3"
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePlay();
                          }}
                        >
                          {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
                        </Button>
                        
                        <Button
                          variant="ghost"
                          size="lg"
                          className="text-white hover:bg-white/20 p-3"
                          onClick={(e) => {
                            e.stopPropagation();
                            seekRelative(-10);
                          }}
                        >
                          <SkipBack className="h-5 w-5" />
                        </Button>
                        
                        <Button
                          variant="ghost"
                          size="lg"
                          className="text-white hover:bg-white/20 p-3"
                          onClick={(e) => {
                            e.stopPropagation();
                            seekRelative(10);
                          }}
                        >
                          <SkipForward className="h-5 w-5" />
                        </Button>

                        {/* Frame Controls */}
                        <div className="flex items-center gap-1 ml-4">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-white hover:bg-white/20 p-2"
                            onClick={(e) => {
                              e.stopPropagation();
                              frameStep(false);
                            }}
                          >
                            ←
                          </Button>
                          <span className="text-xs text-white/80 px-2">Frame</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-white hover:bg-white/20 p-2"
                            onClick={(e) => {
                              e.stopPropagation();
                              frameStep(true);
                            }}
                          >
                            →
                          </Button>
                        </div>
                      </div>

                      {/* Right Controls */}
                      <div className="flex items-center gap-4">
                        <span className="text-white text-lg font-mono">
                          {formatTime(currentTime)} / {formatTime(duration)}
                        </span>
                        
                        {/* Volume */}
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="lg"
                            className="text-white hover:bg-white/20 p-3"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleMute();
                            }}
                          >
                            {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                          </Button>
                          <div className="w-24 flex items-center">
                            <div
                              className="relative w-full h-2 bg-gray-600 rounded-full cursor-pointer"
                              data-volume-slider
                              onMouseDown={handleVolumeMouseDown}
                            >
                              <div
                                className="absolute top-0 left-0 h-full bg-white rounded-full"
                                style={{
                                  width: `${isDraggingVolume && dragVolumePosition !== null
                                    ? dragVolumePosition * 100
                                    : (isMuted ? 0 : volume) * 100}%`,
                                  transition: isDraggingVolume ? 'none' : 'all 0.1s'
                                }}
                              />
                              <div
                                className="absolute top-1/2 w-4 h-4 bg-white border-2 border-gray-300 rounded-full transform -translate-y-1/2 -translate-x-1/2 shadow-lg hover:scale-110"
                                style={{
                                  left: `${isDraggingVolume && dragVolumePosition !== null
                                    ? dragVolumePosition * 100
                                    : (isMuted ? 0 : volume) * 100}%`,
                                  cursor: isDraggingVolume ? 'grabbing' : 'grab',
                                  transition: isDraggingVolume ? 'none' : 'transform 0.2s'
                                }}
                              />
                            </div>
                          </div>
                        </div>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="lg"
                              className="text-white hover:bg-white/20 px-3 py-2"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {playbackRate}x
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                              <DropdownMenuItem
                                key={rate}
                                onClick={() => setPlaybackSpeed(rate)}
                                className={playbackRate === rate ? 'bg-accent' : ''}
                              >
                                {rate}x
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>

                        <Button
                          variant="ghost"
                          size="lg"
                          className="text-white hover:bg-white/20 p-3"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFullscreen();
                          }}
                        >
                          <Maximize className="h-5 w-5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Controls Panel Below Video - Hidden in Fullscreen */}
        <div className={`bg-[hsl(var(--tech-bg))]/40 rounded-b-lg p-3 space-y-3 ${
          isFullscreen ? 'hidden' : 'block'
        }`}>
          {/* Timeline */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm text-[hsl(var(--tech-text-secondary))]">
              <span>Timeline</span>
              <span className="font-mono">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>
            <div
              className="relative w-full h-3 bg-[hsl(var(--tech-border))] rounded-full cursor-pointer group"
              data-timeline-slider
              onMouseDown={handleTimelineMouseDown}
            >
              <div
                className="absolute top-0 left-0 h-full bg-[hsl(var(--tech-accent))] rounded-full"
                style={{
                  width: `${isDraggingTimeline && dragTimelinePosition !== null
                    ? dragTimelinePosition * 100
                    : duration > 0 ? (currentTime / duration) * 100 : 0}%`,
                  transition: isDraggingTimeline ? 'none' : 'all 0.1s'
                }}
              />
              {/* Shot markers on timeline */}
              {shotMarkers.map((marker, index) => {
                const position = duration > 0 ? (marker.time / duration) * 100 : 0;
                const markerColor = marker.type === 'shot' ? 'bg-red-400' :
                                  marker.type === 'rally' ? 'bg-yellow-400' : 'bg-green-400';
                return (
                  <div
                    key={index}
                    className={`absolute top-0 w-1 h-full ${markerColor} cursor-pointer hover:w-2 transition-all shadow-sm z-10`}
                    style={{ left: `${position}%` }}
                    onClick={(e) => {
                      e.stopPropagation();
                      seekTo(marker.time);
                    }}
                    title={`${marker.label} (${formatTime(marker.time)})`}
                  />
                );
              })}
              <div
                className="absolute top-1/2 w-5 h-5 bg-white border-2 border-[hsl(var(--tech-accent))] rounded-full transform -translate-y-1/2 -translate-x-1/2 shadow-lg group-hover:scale-110"
                style={{
                  left: `${isDraggingTimeline && dragTimelinePosition !== null
                    ? dragTimelinePosition * 100
                    : duration > 0 ? (currentTime / duration) * 100 : 0}%`,
                  cursor: isDraggingTimeline ? 'grabbing' : 'grab',
                  transition: isDraggingTimeline ? 'none' : 'transform 0.2s'
                }}
              />
            </div>
          </div>

          {/* Control Buttons */}
          <div className="flex items-center justify-between">
            {/* Playback Controls */}
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={togglePlay}
                title="Play/Pause (Space or K)"
              >
                {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </Button>

              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => seekRelative(-10)}
                title="Rewind 10s (J or ←)"
              >
                <SkipBack className="h-3.5 w-3.5" />
              </Button>

              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => seekRelative(10)}
                title="Forward 10s (L or →)"
              >
                <SkipForward className="h-3.5 w-3.5" />
              </Button>

              {/* Frame Step Controls */}
              <div className="flex items-center gap-0.5 ml-1 border border-[hsl(var(--tech-border))]/50 rounded-md bg-[hsl(var(--tech-bg))]/50">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 rounded-none text-xs"
                  onClick={() => frameStep(false)}
                  title="Previous frame (, or Shift+←)"
                >
                  ←
                </Button>
                <span className="text-[10px] px-1.5 text-[hsl(var(--tech-text-secondary))] font-medium">Frame</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 rounded-none text-xs"
                  onClick={() => frameStep(true)}
                  title="Next frame (. or Shift+→)"
                >
                  →
                </Button>
              </div>
            </div>

            {/* Audio & Display Controls */}
            <div className="flex items-center gap-2">
              {/* Volume Control */}
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={toggleMute}
                  title="Mute/Unmute (M)"
                >
                  {isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                </Button>
                <div className="w-16 flex items-center">
                  <div
                    className="relative w-full h-1.5 bg-[hsl(var(--tech-border))]/30 rounded-full cursor-pointer group"
                    data-volume-slider
                    onMouseDown={handleVolumeMouseDown}
                    title="Volume (↑/↓)"
                  >
                    <div
                      className="absolute top-0 left-0 h-full bg-[hsl(var(--tech-accent))] rounded-full transition-all"
                      style={{
                        width: `${isDraggingVolume && dragVolumePosition !== null
                          ? dragVolumePosition * 100
                          : (isMuted ? 0 : volume) * 100}%`
                      }}
                    />
                    <div
                      className="absolute top-1/2 w-2.5 h-2.5 bg-white rounded-full transform -translate-y-1/2 -translate-x-1/2 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{
                        left: `${isDraggingVolume && dragVolumePosition !== null
                          ? dragVolumePosition * 100
                          : (isMuted ? 0 : volume) * 100}%`,
                        cursor: isDraggingVolume ? 'grabbing' : 'grab'
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Speed Control */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 px-2 text-xs font-medium" title="Playback speed">
                    {playbackRate}x
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                    <DropdownMenuItem
                      key={rate}
                      onClick={() => setPlaybackSpeed(rate)}
                      className={playbackRate === rate ? 'bg-accent' : ''}
                    >
                      {rate}x {rate === 1 ? '(Normal)' : ''}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={toggleFullscreen}
                title="Fullscreen (F)"
              >
                <Maximize className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>

      </div>
      </div>
    </div>
  );
}