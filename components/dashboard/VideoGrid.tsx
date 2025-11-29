"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileVideo, Calendar, HardDrive, Play, Trash2, Loader2, CheckCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import toast from "react-hot-toast";
import Image from "next/image";

interface Video {
  key: string;
  fileName: string;
  size: number;
  uploadedAt: string;
  userId: string;
  videoId: string;
  analysisStatus?: string;
  analysisState?: 'pending' | 'processing' | 'completed' | 'failed';
  analysisProgress?: number;
}

interface VideoGridProps {
  userId: string;
  refreshTrigger?: number;
  onVideoDeleted?: () => void;
}

export function VideoGrid({ userId, refreshTrigger, onVideoDeleted }: VideoGridProps) {
  const router = useRouter();
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [videoType, setVideoType] = useState<'all' | 'ready' | 'processing'>('all');

  useEffect(() => {
    fetchVideos();
  }, [userId, refreshTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh when page becomes visible (e.g., navigating back from video detail)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        fetchVideos();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh every 10 seconds if there are processing videos
  useEffect(() => {
    const hasProcessingVideos = videos.some(
      v => v.analysisState === 'processing' || v.analysisState === 'pending'
    );

    if (!hasProcessingVideos) return;

    const refreshInterval = setInterval(() => {
      fetchVideos();
    }, 10000); // Refresh every 10 seconds

    return () => clearInterval(refreshInterval);
  }, [videos, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchVideos = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/videos?userId=${userId}`);
      if (response.ok) {
        const data = await response.json();
        
        // Fetch analysis status for each video
        const videosWithStatus = await Promise.all(
          data.videos.map(async (video: Video) => {
            try {
              const statusResponse = await fetch(
                `/api/analysis-status?userId=${userId}&videoId=${video.videoId}`
              );
              if (statusResponse.ok) {
                const statusData = await statusResponse.json();
                return {
                  ...video,
                  analysisStatus: statusData.status,
                  analysisState: statusData.state,
                  analysisProgress: statusData.progress
                };
              }
            } catch {
              console.error('Error fetching status for video:', video.videoId);
            }
            return {
              ...video,
              analysisStatus: 'Queued for Analysis',
              analysisState: 'pending' as const,
              analysisProgress: 0
            };
          })
        );
        
        setVideos(videosWithStatus);
      }
    } catch (error) {
      console.error('Error fetching videos:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleVideoClick = (video: Video) => {
    router.push(`/dashboard/video/${video.videoId}`);
  };

  const handleDeleteVideo = async (video: Video, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card click

    if (!confirm(`Are you sure you want to delete "${video.fileName}"? This action cannot be undone.`)) {
      return;
    }

    const deleteToast = toast.loading('Deleting video...');

    try {
      const response = await fetch(`/api/delete-video?videoId=${video.videoId}`, {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error('Failed to delete video');

      toast.success('Video deleted successfully', { id: deleteToast });
      onVideoDeleted?.();
    } catch (error) {
      console.error('Error deleting video:', error);
      toast.error('Failed to delete video', { id: deleteToast });
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="p-4">
              <div className="h-32 bg-muted rounded mb-4"></div>
              <div className="h-4 bg-muted rounded mb-2"></div>
              <div className="h-3 bg-muted rounded w-2/3"></div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  // Filter videos based on type
  const readyVideos = videos.filter(v => v.analysisState === 'completed');
  const processingVideos = videos.filter(v => v.analysisState === 'processing' || v.analysisState === 'pending');

  const displayedVideos =
    videoType === 'ready' ? readyVideos :
    videoType === 'processing' ? processingVideos :
    videos;

  if (videos.length === 0) {
    return (
      <div className="text-center py-12">
        <FileVideo className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h3 className="text-lg font-semibold mb-2">No videos uploaded yet</h3>
        <p className="text-muted-foreground">Upload your first badminton video to get started with AI analysis.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Video Type Filter */}
      <div className="flex gap-2">
        <button
          onClick={() => setVideoType('all')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            videoType === 'all'
              ? 'bg-[hsl(var(--tech-accent))] text-white'
              : 'bg-[hsl(var(--tech-bg-secondary))] text-[hsl(var(--tech-text-secondary))] hover:text-[hsl(var(--tech-text-primary))]'
          }`}
        >
          All Videos ({videos.length})
        </button>
        <button
          onClick={() => setVideoType('ready')}
          disabled={readyVideos.length === 0}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            videoType === 'ready'
              ? 'bg-[hsl(var(--tech-accent))] text-white'
              : readyVideos.length > 0
              ? 'bg-[hsl(var(--tech-bg-secondary))] text-[hsl(var(--tech-text-secondary))] hover:text-[hsl(var(--tech-text-primary))] cursor-pointer'
              : 'bg-[hsl(var(--tech-bg-secondary))] text-[hsl(var(--tech-text-secondary))]/40 cursor-not-allowed'
          }`}
        >
          <CheckCircle className="h-4 w-4" />
          Ready to View ({readyVideos.length})
        </button>
        <button
          onClick={() => setVideoType('processing')}
          disabled={processingVideos.length === 0}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            videoType === 'processing'
              ? 'bg-[hsl(var(--tech-accent))] text-white'
              : processingVideos.length > 0
              ? 'bg-[hsl(var(--tech-bg-secondary))] text-[hsl(var(--tech-text-secondary))] hover:text-[hsl(var(--tech-text-primary))] cursor-pointer'
              : 'bg-[hsl(var(--tech-bg-secondary))] text-[hsl(var(--tech-text-secondary))]/40 cursor-not-allowed'
          }`}
        >
          <Loader2 className={`h-4 w-4 ${processingVideos.length > 0 ? 'animate-spin' : ''}`} />
          Processing ({processingVideos.length})
        </button>
      </div>

      {/* Video Grid */}
      {displayedVideos.length === 0 ? (
        <div className="text-center py-12">
          <FileVideo className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">
            {videoType === 'ready'
              ? 'No analyzed videos yet'
              : videoType === 'processing'
              ? 'No videos processing'
              : 'No videos uploaded yet'}
          </h3>
          <p className="text-muted-foreground">
            {videoType === 'ready'
              ? 'Videos are automatically analyzed after upload. Check back soon!'
              : videoType === 'processing'
              ? 'All your videos have been analyzed!'
              : 'Upload your first badminton video to get started with AI analysis.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayedVideos.map((video) => (
            <Card
              key={video.key}
              className="hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => handleVideoClick(video)}
            >
              <CardContent className="p-4">
                <div className="relative h-32 bg-muted rounded mb-4 overflow-hidden group">
                  <Image
                    src={`/api/thumbnail-stream?key=dev/${userId}/${video.videoId}/thumbnail.jpg`}
                    alt={video.fileName}
                    fill
                    className="object-cover"
                    style={{ imageRendering: 'auto' }}
                    onError={(e) => {
                      // Try SVG fallback first
                      const target = e.target as HTMLImageElement;
                      if (target.src.includes('thumbnail.jpg')) {
                        target.src = `/api/thumbnail-stream?key=dev/${userId}/${video.videoId}/thumbnail.svg`;
                      } else {
                        // If SVG also fails, show icon
                        target.style.display = 'none';
                        const fallback = target.nextElementSibling as HTMLElement;
                        if (fallback) fallback.style.display = 'flex';
                      }
                    }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-muted" style={{ display: 'none' }}>
                    <FileVideo className="h-12 w-12 text-muted-foreground" />
                  </div>
                  {/* Processing Overlay */}
                  {(video.analysisState === 'processing' || video.analysisState === 'pending') && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-60">
                      {video.analysisState === 'processing' ? (
                        <>
                          <Loader2 className="h-8 w-8 text-white animate-spin mb-2" />
                          <div className="text-white text-sm font-medium mb-1">Processing...</div>
                          <div className="text-white/80 text-xs">{video.analysisProgress}%</div>
                          <div className="w-24 h-1 bg-white/30 rounded-full mt-2 overflow-hidden">
                            <div
                              className="h-full bg-[hsl(var(--tech-accent))] transition-all duration-300"
                              style={{ width: `${video.analysisProgress}%` }}
                            />
                          </div>
                        </>
                      ) : (
                        <>
                          <Clock className="h-8 w-8 text-white mb-2 animate-pulse" />
                          <div className="text-white text-sm font-medium">Queued</div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Play button overlay (only for completed videos) */}
                  {video.analysisState === 'completed' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30 opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="bg-white bg-opacity-90 rounded-full p-2">
                        <Play className="h-6 w-6 text-gray-800" fill="currentColor" />
                      </div>
                    </div>
                  )}
                  {/* Delete button */}
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={(e) => handleDeleteVideo(video, e)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="font-semibold truncate" title={video.fileName}>
                    {video.fileName}
                  </h3>

                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="font-mono text-xs bg-muted px-2 py-1 rounded">
                      {video.videoId}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <HardDrive className="h-3 w-3" />
                    <span>{formatFileSize(video.size)}</span>
                  </div>

                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    <span>{formatDate(video.uploadedAt)}</span>
                  </div>

                  <div className="pt-2">
                    <Badge
                      variant="secondary"
                      className={`text-xs flex items-center gap-1 ${
                        video.analysisState === 'completed'
                          ? 'bg-green-100 text-green-800 border-green-200'
                          : video.analysisState === 'processing'
                          ? 'bg-blue-100 text-blue-800 border-blue-200'
                          : video.analysisState === 'pending'
                          ? 'bg-yellow-100 text-yellow-800 border-yellow-200'
                          : 'bg-gray-100 text-gray-700 border-gray-200'
                      }`}
                    >
                      {video.analysisState === 'completed' && <CheckCircle className="h-3 w-3" />}
                      {video.analysisState === 'processing' && <Loader2 className="h-3 w-3 animate-spin" />}
                      {video.analysisState === 'pending' && <Clock className="h-3 w-3" />}
                      {video.analysisStatus || 'Queued for Analysis'}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}