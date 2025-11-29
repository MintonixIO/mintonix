"use client";

import { useParams } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { VideoPlayer } from "@/components/dashboard/VideoPlayer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Clock, Activity, Target, ChevronRight, Edit2, Loader2, Share2, Check, Link2 } from "lucide-react";
import Link from "next/link";
import toast from "react-hot-toast";
import { WorkerHealthMonitor } from "@/components/dashboard/WorkerHealthMonitor";

interface Video {
  key: string;
  fileName: string;
  size: number;
  uploadedAt: string;
  userId: string;
  videoId: string;
}

export default function VideoDetailPage() {
  const params = useParams();
  const videoId = params.videoId as string;
  const [userId, setUserId] = useState<string | null>(null);
  const [video, setVideo] = useState<Video | null>(null);
  const [loading, setLoading] = useState(true);
  const [videoDuration, setVideoDuration] = useState<number | undefined>(undefined);
  const [currentFileName, setCurrentFileName] = useState<string>('');
  const [isEditing, setIsEditing] = useState(false);
  const [editFileName, setEditFileName] = useState('');
  const [activeTab, setActiveTab] = useState<'analysis'>('analysis');
  const [analysisStatus, setAnalysisStatus] = useState<'pending' | 'processing' | 'completed' | 'failed'>('pending');
  const [positionAnalysisData, setPositionAnalysisData] = useState<Record<string, unknown> | null>(null);
  const [loadingPositionAnalysis, setLoadingPositionAnalysis] = useState(false);
  const [playerNames, setPlayerNames] = useState<Record<string, string>>({});
  const [editingAnalysisPlayer, setEditingAnalysisPlayer] = useState<string | null>(null);
  const [editAnalysisName, setEditAnalysisName] = useState('');
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [justCopied, setJustCopied] = useState(false);
  const [currentRunpodJobId, setCurrentRunpodJobId] = useState<string | null>(null);

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

  useEffect(() => {
    if (userId) {
      fetchVideoDetails();
      fetchShuttleData();
      fetchPositionAnalysisData();
      checkAnalysisStatus();
      fetchPlayerNames();
      checkShareStatus();
      fetchRunpodJobId();
    }
  }, [userId, videoId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch runpodJobId from processing_jobs (read-only) for monitoring
  const fetchRunpodJobId = async () => {
    if (!userId || !videoId) return;

    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('processing_jobs')
        .select('runpod_job_id')
        .eq('user_id', userId)
        .eq('video_id', videoId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (data && !error && data.runpod_job_id) {
        setCurrentRunpodJobId(data.runpod_job_id);
        console.log('📋 Found RunPod job for monitoring:', data.runpod_job_id);
      }
    } catch {
      // No job found yet, that's okay
      console.log('No RunPod job found for monitoring');
    }
  };

  const checkShareStatus = async () => {
    if (!videoId) return;
    try {
      const response = await fetch(`/api/share?videoId=${videoId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.shared) {
          setShareUrl(data.shareUrl);
        }
      }
    } catch (error) {
      console.error('Error checking share status:', error);
    }
  };

  const copyToClipboard = async (text: string): Promise<boolean> => {
    // Try modern Clipboard API first
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {
        console.warn('Clipboard API failed, trying fallback:', err);
      }
    }

    // Fallback for older browsers or non-secure contexts
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textArea);
      return success;
    } catch (err) {
      console.error('Fallback copy failed:', err);
      return false;
    }
  };

  const handleShare = async () => {
    if (!videoId) return;

    setIsSharing(true);
    try {
      const response = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId }),
      });

      if (response.ok) {
        const data = await response.json();
        setShareUrl(data.shareUrl);

        // Copy to clipboard
        const copied = await copyToClipboard(data.shareUrl);
        if (copied) {
          setJustCopied(true);
          toast.success('Share link copied to clipboard!');
          setTimeout(() => setJustCopied(false), 2000);
        } else {
          toast.success('Share link created! Click "Copy Link" to copy.');
        }
      } else {
        toast.error('Failed to create share link');
      }
    } catch (error) {
      console.error('Error creating share link:', error);
      toast.error('Failed to create share link');
    } finally {
      setIsSharing(false);
    }
  };

  const handleCopyShareUrl = async () => {
    if (!shareUrl) return;

    const copied = await copyToClipboard(shareUrl);
    if (copied) {
      setJustCopied(true);
      toast.success('Share link copied to clipboard!');
      setTimeout(() => setJustCopied(false), 2000);
    } else {
      toast.error('Failed to copy link');
    }
  };

  // Poll for analysis status updates
  useEffect(() => {
    if (!userId || !videoId) return;

    const pollInterval = setInterval(() => {
      if (!userId || !videoId) return;

      if (analysisStatus === 'processing' || analysisStatus === 'pending') {
        checkAnalysisStatus();
        if (analysisStatus === 'processing') {
          // Refresh data periodically during processing
          fetchShuttleData();
          fetchPositionAnalysisData();
        }
      }
    }, 5000); // Poll every 5 seconds

    return () => clearInterval(pollInterval);
  }, [userId, videoId, analysisStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  const checkAnalysisStatus = async () => {
    if (!userId || !videoId) return;

    try {
      const statusResponse = await fetch(`/api/analysis-status?userId=${userId}&videoId=${videoId}`);

      if (statusResponse.ok) {
        const statusData = await statusResponse.json();
        setAnalysisStatus(statusData.state);
        // Status text and progress tracking removed for now
        // setAnalysisStatusText(statusData.status || 'Queued for Analysis');
        // setAnalysisProgress(statusData.progress || 0);

        // If completed, refresh all data
        if (statusData.state === 'completed' && analysisStatus !== 'completed') {
          fetchShuttleData();
          fetchPositionAnalysisData();
          toast.success('Analysis completed!');
        }
      }
    } catch (error) {
      console.error('Error checking analysis status:', error);
    }
  };

  const fetchShuttleData = async () => {
    if (!userId || !videoId) return;

    try {
      // setLoadingShuttleData(true);
      const response = await fetch(`/api/shuttle-data?userId=${userId}&videoId=${videoId}`);

      if (response.ok) {
        const data = await response.json();
        // setShuttleData(data);
        console.log('Shuttle data loaded:', data);
      } else {
        // Shuttle data not available - this is okay, just means analysis hasn't been run
        console.log('Shuttle data not available yet');
        // setShuttleData(null);
      }
    } catch {
      console.log('Error fetching shuttle data');
      // setShuttleData(null);
    } finally {
      // setLoadingShuttleData(false);
    }
  };

  const fetchPositionAnalysisData = async () => {
    if (!userId || !videoId) return;

    try {
      setLoadingPositionAnalysis(true);
      const response = await fetch(`/api/position-analysis?userId=${userId}&videoId=${videoId}`);

      if (response.ok) {
        const data = await response.json();
        setPositionAnalysisData(data);
        console.log('Position analysis data loaded:', data);
      } else {
        console.log('Position analysis not available yet');
        setPositionAnalysisData(null);
      }
    } catch (error) {
      console.error('Error fetching position analysis:', error);
      setPositionAnalysisData(null);
    } finally {
      setLoadingPositionAnalysis(false);
    }
  };

  const fetchPlayerNames = async () => {
    if (!userId || !videoId) return;

    try {
      const response = await fetch(`/api/player-names?userId=${userId}&videoId=${videoId}`);

      if (response.ok) {
        const data = await response.json();
        setPlayerNames(data);
      }
    } catch (error) {
      console.error('Error fetching player names:', error);
    }
  };

  const handleUpdatePlayerName = async (playerId: string, newName: string) => {
    const updatedNames = { ...playerNames, [playerId]: newName };
    setPlayerNames(updatedNames);

    try {
      await fetch('/api/player-names', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          videoId,
          playerNames: updatedNames,
        }),
      });
      toast.success('Player name updated');
    } catch (error) {
      console.error('Error saving player name:', error);
      toast.error('Failed to save player name');
    }
  };

  const handleAnalysisPlayerNameUpdate = (playerId: string) => {
    if (editAnalysisName.trim()) {
      handleUpdatePlayerName(playerId, editAnalysisName.trim());
    }
    setEditingAnalysisPlayer(null);
    setEditAnalysisName('');
  };



  // Convert shuttle data to shot markers for timeline - REMOVED rally markers per user request
  const generateShuttleMarkers = () => {
    // Rally markers have been removed
    return [];
  };

  // Helper to determine which step is currently active based on status (currently unused)
  // const getActiveStep = (statusText: string): number => {
  //   const statusMap: Record<string, number> = {
  //     'Queued for Analysis': 0,
  //     'Court Detection': 1,
  //     'Detecting Poses': 2,
  //     'Calculating Positions': 3,
  //     'Removing Artifacts': 4,
  //     'Tracking Shuttlecock': 5,
  //     'Generating Visualization': 6,
  //     'Analysis Complete': 7
  //   };
  //   return statusMap[statusText] || 0;
  // };

  const fetchVideoDetails = async () => {
    try {
      const response = await fetch(`/api/videos?userId=${userId}`);
      if (response.ok) {
        const data = await response.json();
        const foundVideo = data.videos.find((v: Video) => v.videoId === videoId);
        setVideo(foundVideo || null);
        if (foundVideo) {
          setCurrentFileName(foundVideo.fileName);
          setEditFileName(foundVideo.fileName);
        }
      }
    } catch (error) {
      console.error('Error fetching video details:', error);
    } finally {
      setLoading(false);
    }
  };

  // Debounced rename function
  const debouncedRename = useCallback(
    async (newFileName: string) => {
      if (!newFileName.trim() || newFileName === currentFileName) {
        return;
      }

      try {
        const response = await fetch('/api/rename-video', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            videoId: videoId,
            newFileName: newFileName.trim(),
          }),
        });

        if (response.ok) {
          setCurrentFileName(newFileName.trim());
          setVideo(prev => prev ? { ...prev, fileName: newFileName.trim() } : null);
        } else {
          const error = await response.json();
          toast.error(error.error || 'Failed to rename video');
          setEditFileName(currentFileName);
        }
      } catch (error) {
        console.error('Error renaming video:', error);
        toast.error('Failed to rename video');
        setEditFileName(currentFileName);
      }
    },
    [videoId, currentFileName]
  );

  // Debounce the rename call
  useEffect(() => {
    if (!editFileName.trim() || editFileName === currentFileName || !isEditing) {
      return;
    }

    const timeoutId = setTimeout(() => {
      debouncedRename(editFileName);
    }, 1000); // Wait 1 second after user stops typing

    return () => clearTimeout(timeoutId);
  }, [editFileName, debouncedRename, currentFileName, isEditing]);

  const handleBlur = () => {
    if (editFileName.trim() && editFileName !== currentFileName) {
      debouncedRename(editFileName);
    }
    setIsEditing(false);
  };

  if (!userId || loading) {
    return (
      <div className="min-h-screen bg-[hsl(var(--tech-bg))] flex items-center justify-center">
        <div className="text-[hsl(var(--tech-text-primary))]">Loading...</div>
      </div>
    );
  }

  if (!video) {
    return (
      <div className="min-h-screen bg-[hsl(var(--tech-bg))]">
        <main className="w-full bg-[hsl(var(--tech-bg))]">
          <div className="p-8">
            <div className="max-w-7xl mx-auto">
              <div className="text-center">
                <h1 className="text-2xl font-bold mb-4 text-[hsl(var(--tech-text-primary))]">Video not found</h1>
                <Link href="/dashboard">
                  <Button className="bg-[hsl(var(--tech-accent))] hover:bg-[hsl(var(--tech-accent-hover))] text-[hsl(var(--tech-text-primary))]">
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to Dashboard
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[hsl(var(--tech-bg))]">
      <main className="w-full bg-[hsl(var(--tech-bg))]">
        {/* Top Header Section */}
        <div className="border-b border-[hsl(var(--tech-border))] bg-[hsl(var(--tech-bg-secondary))] sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-8 py-4">
            <div className="flex items-center justify-between mb-2">
              <Link href="/dashboard">
                <Button variant="ghost" size="sm" className="text-[hsl(var(--tech-text-secondary))] hover:text-[hsl(var(--tech-text-primary))] hover:bg-[hsl(var(--tech-bg-tertiary))]">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Dashboard
                </Button>
              </Link>
            </div>
            <div className="flex items-center gap-2 text-sm text-[hsl(var(--tech-text-secondary))]">
              <Link href="/dashboard" className="hover:text-[hsl(var(--tech-accent))]">Dashboard</Link>
              <ChevronRight className="h-3 w-3" />
              <span>Videos</span>
              <ChevronRight className="h-3 w-3" />
              <span className="text-[hsl(var(--tech-text-primary))]">{currentFileName || video.fileName}</span>
            </div>
          </div>
        </div>

        {/* Video Title Section */}
        <div className="border-b border-[hsl(var(--tech-border))]">
          <div className="max-w-7xl mx-auto px-8 py-6">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3 flex-1">
                {isEditing ? (
                  <Input
                    value={editFileName}
                    onChange={(e) => setEditFileName(e.target.value)}
                    onBlur={handleBlur}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleBlur();
                      }
                      if (e.key === 'Escape') {
                        setEditFileName(currentFileName);
                        setIsEditing(false);
                      }
                    }}
                    className="text-3xl font-bold bg-transparent border-b-2 border-[hsl(var(--tech-accent))] text-[hsl(var(--tech-text-primary))] h-12 px-0 focus:ring-0 focus:border-[hsl(var(--tech-accent))]"
                    autoFocus
                  />
                ) : (
                  <h1
                    className="text-3xl font-bold text-[hsl(var(--tech-text-primary))] cursor-pointer hover:text-[hsl(var(--tech-accent))] transition-colors duration-200 flex-1 flex items-center gap-2 group"
                    onClick={() => {
                      setIsEditing(true);
                      setEditFileName(currentFileName || video.fileName);
                    }}
                    title="Click to rename"
                  >
                    {currentFileName || video.fileName}
                    <Edit2 className="h-5 w-5 opacity-0 group-hover:opacity-50 transition-opacity" />
                  </h1>
                )}
              </div>

              {/* Share Button */}
              <div className="flex items-center gap-2">
                {shareUrl ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopyShareUrl}
                    className="flex items-center gap-2"
                  >
                    {justCopied ? (
                      <>
                        <Check className="h-4 w-4 text-green-500" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Link2 className="h-4 w-4" />
                        Copy Link
                      </>
                    )}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleShare}
                    disabled={isSharing || analysisStatus !== 'completed'}
                    className="flex items-center gap-2"
                    title={analysisStatus !== 'completed' ? 'Analysis must be complete to share' : 'Share this analysis'}
                  >
                    {isSharing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <Share2 className="h-4 w-4" />
                        Share
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4 text-sm text-[hsl(var(--tech-text-secondary))]">
              <span>Video ID: {video.videoId}</span>
              <span>•</span>
              <span>Uploaded: {new Date(video.uploadedAt).toLocaleString()}</span>
              {videoDuration && (
                <>
                  <span>•</span>
                  <span>Duration: {Math.floor(videoDuration / 60)}:{String(Math.floor(videoDuration % 60)).padStart(2, '0')}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Video Player Section */}
        <div className="bg-[hsl(var(--tech-bg-secondary))] border-b border-[hsl(var(--tech-border))]">
          <div className="max-w-7xl mx-auto px-8 py-6">
            <div className="grid grid-cols-12 gap-6">
              {/* Video Player - Full Width */}
              <div className="col-span-12">
                <VideoPlayer
                  video={video}
                  videoId={videoId}
                  showProcessed={true}
                  onDurationChange={setVideoDuration}
                  onVideoElementReady={() => {}}
                  shotMarkers={generateShuttleMarkers()}
                  onTimeUpdate={() => {
                    // Video time tracking removed for now
                  }}
                />
              </div>

            </div>
          </div>
        </div>

        {/* Worker Health Monitor - Shows worker status by polling RunPod + R2 */}
        {userId && videoId && currentRunpodJobId && (
          <div className="max-w-7xl mx-auto px-8 py-4">
            <WorkerHealthMonitor
              runpodJobId={currentRunpodJobId}
              userId={userId}
              videoId={videoId}
            />
          </div>
        )}

        {/* Quick Stats Bar */}
        {positionAnalysisData && (
          <div className="bg-[hsl(var(--tech-bg-tertiary))] border-b border-[hsl(var(--tech-border))]">
            <div className="max-w-7xl mx-auto px-8 py-4">
              <div className="flex items-center gap-6 flex-wrap">
                <Badge variant="outline" className="px-4 py-2 text-sm">
                  <Activity className="h-4 w-4 mr-2" />
                  Status: Analyzed
                </Badge>
                {(positionAnalysisData.players && Object.keys(positionAnalysisData.players as Record<string, unknown>).length > 0) ? (
                  <>
                    <div className="flex items-center gap-2 text-sm">
                      <Target className="h-4 w-4 text-[hsl(var(--tech-accent))]" />
                      <span className="text-[hsl(var(--tech-text-secondary))]">Players:</span>
                      <span className="font-semibold text-[hsl(var(--tech-text-primary))]">
                        {Object.keys(positionAnalysisData.players).length}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="h-4 w-4 text-[hsl(var(--tech-accent))]" />
                      <span className="text-[hsl(var(--tech-text-secondary))]">Tracked:</span>
                      <span className="font-semibold text-[hsl(var(--tech-text-primary))]">
                        {Object.values(positionAnalysisData.players)[0]?.time_tracked_seconds || 0}s
                      </span>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="bg-[hsl(var(--tech-bg))] border-b border-[hsl(var(--tech-border))] sticky top-[73px] z-10">
          <div className="max-w-7xl mx-auto px-8">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setActiveTab('analysis')}
                className={`flex items-center gap-2 px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'analysis'
                    ? 'border-[hsl(var(--tech-accent))] text-[hsl(var(--tech-accent))]'
                    : 'border-transparent text-[hsl(var(--tech-text-secondary))] hover:text-[hsl(var(--tech-text-primary))] hover:border-[hsl(var(--tech-border))]'
                }`}
              >
                <Activity className="h-4 w-4" />
                Analysis
              </button>
            </div>
          </div>
        </div>

        {/* Tab Content */}
        <div className="max-w-7xl mx-auto px-8 py-8">
          {/* Analysis Tab */}
          {activeTab === 'analysis' && (
            <div className="space-y-6">
              {loadingPositionAnalysis ? (
                <div className="flex items-center justify-center py-12 bg-[hsl(var(--tech-bg-secondary))] rounded-lg border border-[hsl(var(--tech-border))]">
                  <div className="text-[hsl(var(--tech-text-secondary))]">Loading analysis data...</div>
                </div>
              ) : !positionAnalysisData ? (
                <div className="text-center py-12 bg-[hsl(var(--tech-bg-secondary))] rounded-lg border border-[hsl(var(--tech-border))]">
                  {analysisStatus === 'processing' ? (
                    <>
                      <Loader2 className="h-16 w-16 text-[hsl(var(--tech-accent))] mx-auto mb-4 animate-spin" />
                      <h3 className="text-lg font-semibold text-[hsl(var(--tech-text-primary))] mb-2">
                        Analysis In Progress
                      </h3>
                      <p className="text-[hsl(var(--tech-text-secondary))]">
                        Analyzing your video. This may take a few minutes.
                      </p>
                    </>
                  ) : (
                    <>
                      <Clock className="h-16 w-16 text-[hsl(var(--tech-text-secondary))] mx-auto mb-4 animate-pulse" />
                      <h3 className="text-lg font-semibold text-[hsl(var(--tech-text-primary))] mb-2">
                        Analysis Queued
                      </h3>
                      <p className="text-[hsl(var(--tech-text-secondary))]">
                        Your video is queued for analysis. Processing will start shortly.
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-8">
                  {/* Player Stats - Side by Side Comparison */}
                  {positionAnalysisData.players ? (() => {
                    const playerEntries = Object.entries(positionAnalysisData.players as Record<string, unknown>);
                    const getPlayerName = (playerId: string) => {
                      if (playerNames[playerId]) return playerNames[playerId];
                      // Convert "player_0" to "Player 0", "player_1" to "Player 1", etc.
                      const match = playerId.match(/player_(\d+)/i);
                      return match ? `Player ${match[1]}` : playerId;
                    };
                    const getPlayerLabel = (playerId: string) => {
                      // Convert "player_0" to "P0", "player_1" to "P1", etc.
                      const match = playerId.match(/player_(\d+)/i);
                      return match ? `P${match[1]}` : playerId.toUpperCase();
                    };

                    return (
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        {playerEntries.map(([playerId, playerDataRaw]) => {
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          const playerData = playerDataRaw as any;
                          const isEditing = editingAnalysisPlayer === playerId;

                          return (
                          <div key={playerId} className="space-y-4">
                            <div className="bg-[hsl(var(--tech-bg-tertiary))] rounded-lg p-3 group">
                              <div className="flex flex-col items-center justify-center w-full">
                                {isEditing ? (
                                  <Input
                                    value={editAnalysisName}
                                    onChange={(e) => setEditAnalysisName(e.target.value)}
                                    onBlur={() => handleAnalysisPlayerNameUpdate(playerId)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleAnalysisPlayerNameUpdate(playerId);
                                      if (e.key === 'Escape') {
                                        setEditingAnalysisPlayer(null);
                                        setEditAnalysisName('');
                                      }
                                    }}
                                    className="text-lg font-semibold bg-transparent border-b-2 border-[hsl(var(--tech-accent))] text-[hsl(var(--tech-text-primary))] text-center px-0 focus:ring-0 focus:border-[hsl(var(--tech-accent))] w-full max-w-xs"
                                    autoFocus
                                  />
                                ) : (
                                  <div
                                    onClick={() => {
                                      setEditingAnalysisPlayer(playerId);
                                      setEditAnalysisName(getPlayerName(playerId));
                                    }}
                                    className="cursor-pointer hover:text-[hsl(var(--tech-accent))] transition-colors duration-200 w-full text-center relative"
                                    title="Click to rename"
                                  >
                                    <h4 className="text-lg font-semibold text-[hsl(var(--tech-text-primary))] text-center w-full">
                                      {getPlayerName(playerId)}
                                    </h4>
                                    <Edit2 className="h-4 w-4 opacity-0 group-hover:opacity-50 transition-opacity absolute top-1/2 right-2 -translate-y-1/2" />
                                    <p className="text-xs text-[hsl(var(--tech-text-secondary))] mt-1 text-center w-full">
                                      ({getPlayerLabel(playerId)})
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>

                                {/* Basic Stats */}
                                <div className="bg-[hsl(var(--tech-bg-tertiary))] rounded-lg p-4">
                                  <h5 className="text-sm font-semibold text-[hsl(var(--tech-text-primary))] mb-3 uppercase tracking-wider">
                                    Basic Stats
                                  </h5>
                                  <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div>
                                      <div className="text-[hsl(var(--tech-text-secondary))]">Total Distance</div>
                                      <div className="text-[hsl(var(--tech-accent))] font-bold text-lg">
                                        {playerData.total_distance_m}m
                                      </div>
                                    </div>
                                    <div>
                                      <div className="text-[hsl(var(--tech-text-secondary))]">Average Speed</div>
                                      <div className="text-[hsl(var(--tech-accent))] font-bold text-lg">
                                        {playerData.average_speed_m_s} m/s
                                      </div>
                                    </div>
                                    <div>
                                      <div className="text-[hsl(var(--tech-text-secondary))]">Time Tracked</div>
                                      <div className="text-[hsl(var(--tech-text-primary))] font-medium">
                                        {playerData.time_tracked_seconds}s
                                      </div>
                                    </div>
                                    <div>
                                      <div className="text-[hsl(var(--tech-text-secondary))]">Frames Tracked</div>
                                      <div className="text-[hsl(var(--tech-text-primary))] font-medium">
                                        {playerData.cleaned_frame_count}
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* Court Occupancy */}
                                <div className="bg-[hsl(var(--tech-bg-tertiary))] rounded-lg p-4">
                                  <h5 className="text-sm font-semibold text-[hsl(var(--tech-text-primary))] mb-3 uppercase tracking-wider">
                                    Court Occupancy
                                  </h5>
                                  <div className="grid grid-cols-3 gap-2 text-xs">
                                    {['front', 'middle', 'back'].map(depth => (
                                      <div key={depth} className="col-span-3 grid grid-cols-2 gap-2">
                                        {['left', 'right'].map(side => {
                                          const zone = `${depth}_${side}`;
                                          const percentage = playerData.court_occupancy_percent?.[zone] || 0;
                                          return (
                                            <div key={zone} className="bg-[hsl(var(--tech-bg-secondary))] rounded p-2">
                                              <div className="text-[hsl(var(--tech-text-secondary))] capitalize">
                                                {depth} {side}
                                              </div>
                                              <div className="text-[hsl(var(--tech-text-primary))] font-semibold">
                                                {percentage}%
                                              </div>
                                              <div className="w-full bg-gray-700 rounded-full h-1.5 mt-1">
                                                <div
                                                  className="bg-[hsl(var(--tech-accent))] h-1.5 rounded-full transition-all duration-300"
                                                  style={{ width: `${percentage}%` }}
                                                />
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    ))}
                                  </div>
                                </div>

                                {/* Movement Efficiency */}
                                {playerData.movement_efficiency && (
                                  <div className="bg-[hsl(var(--tech-bg-tertiary))] rounded-lg p-4">
                                    <h5 className="text-sm font-semibold text-[hsl(var(--tech-text-primary))] mb-3 uppercase tracking-wider">
                                      Movement Efficiency
                                    </h5>
                                    <div className="space-y-3">
                                      {/* Return to Center */}
                                      {playerData.movement_efficiency.return_to_center && (
                                        <div className="grid grid-cols-2 gap-3 text-sm">
                                          <div className="bg-[hsl(var(--tech-bg-secondary))] rounded p-2">
                                            <div className="text-[hsl(var(--tech-text-secondary))] text-xs">Avg Distance from Center</div>
                                            <div className="text-[hsl(var(--tech-text-primary))] font-semibold">
                                              {playerData.movement_efficiency.return_to_center.average_distance_from_center_m}m
                                            </div>
                                          </div>
                                          <div className="bg-[hsl(var(--tech-bg-secondary))] rounded p-2">
                                            <div className="text-[hsl(var(--tech-text-secondary))] text-xs">Max Distance from Center</div>
                                            <div className="text-[hsl(var(--tech-text-primary))] font-semibold">
                                              {playerData.movement_efficiency.return_to_center.max_distance_from_center_m}m
                                            </div>
                                          </div>
                                          <div className="bg-[hsl(var(--tech-bg-secondary))] rounded p-2">
                                            <div className="text-[hsl(var(--tech-text-secondary))] text-xs">Avg Return Time</div>
                                            <div className="text-[hsl(var(--tech-text-primary))] font-semibold">
                                              {playerData.movement_efficiency.return_to_center.average_return_time_s}s
                                            </div>
                                          </div>
                                          <div className="bg-[hsl(var(--tech-bg-secondary))] rounded p-2">
                                            <div className="text-[hsl(var(--tech-text-secondary))] text-xs">Time Near Center</div>
                                            <div className="text-[hsl(var(--tech-text-primary))] font-semibold">
                                              {playerData.movement_efficiency.return_to_center.time_near_center_percent}%
                                            </div>
                                          </div>
                                        </div>
                                      )}

                                      {/* Recovery Speed */}
                                      {playerData.movement_efficiency.recovery_speed && (
                                        <div className="grid grid-cols-2 gap-3 text-sm">
                                          <div className="bg-[hsl(var(--tech-bg-secondary))] rounded p-2">
                                            <div className="text-[hsl(var(--tech-text-secondary))] text-xs">Avg Recovery Speed</div>
                                            <div className="text-[hsl(var(--tech-accent))] font-bold">
                                              {playerData.movement_efficiency.recovery_speed.average_recovery_speed_m_s} m/s
                                            </div>
                                          </div>
                                          <div className="bg-[hsl(var(--tech-bg-secondary))] rounded p-2">
                                            <div className="text-[hsl(var(--tech-text-secondary))] text-xs">Max Recovery Speed</div>
                                            <div className="text-[hsl(var(--tech-accent))] font-bold">
                                              {playerData.movement_efficiency.recovery_speed.max_recovery_speed_m_s} m/s
                                            </div>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {/* Positioning Strategy */}
                                {playerData.positioning_strategy && (
                                  <div className="bg-[hsl(var(--tech-bg-tertiary))] rounded-lg p-4">
                                    <h5 className="text-sm font-semibold text-[hsl(var(--tech-text-primary))] mb-3 uppercase tracking-wider">
                                      Positioning Strategy
                                    </h5>
                                    <div className="space-y-3">
                                      {/* Offensive/Defensive Stance */}
                                      {playerData.positioning_strategy.offensive_defensive && (
                                        <div>
                                          <div className="text-xs text-[hsl(var(--tech-text-secondary))] mb-2">Stance Distribution</div>
                                          <div className="grid grid-cols-3 gap-2 text-sm mb-2">
                                            <div className="bg-[hsl(var(--tech-bg-secondary))] rounded p-2">
                                              <div className="text-[hsl(var(--tech-text-secondary))] text-xs">Offensive</div>
                                              <div className="text-[hsl(var(--tech-text-primary))] font-semibold">
                                                {playerData.positioning_strategy.offensive_defensive.offensive_percent}%
                                              </div>
                                            </div>
                                            <div className="bg-[hsl(var(--tech-bg-secondary))] rounded p-2">
                                              <div className="text-[hsl(var(--tech-text-secondary))] text-xs">Neutral</div>
                                              <div className="text-[hsl(var(--tech-text-primary))] font-semibold">
                                                {playerData.positioning_strategy.offensive_defensive.neutral_percent}%
                                              </div>
                                            </div>
                                            <div className="bg-[hsl(var(--tech-bg-secondary))] rounded p-2">
                                              <div className="text-[hsl(var(--tech-text-secondary))] text-xs">Defensive</div>
                                              <div className="text-[hsl(var(--tech-text-primary))] font-semibold">
                                                {playerData.positioning_strategy.offensive_defensive.defensive_percent}%
                                              </div>
                                            </div>
                                          </div>
                                          <div className="bg-[hsl(var(--tech-bg-secondary))] rounded p-2">
                                            <div className="text-[hsl(var(--tech-text-secondary))] text-xs">Dominant Stance</div>
                                            <div className="text-[hsl(var(--tech-accent))] font-bold capitalize">
                                              {playerData.positioning_strategy.offensive_defensive.dominant_stance}
                                            </div>
                                          </div>
                                        </div>
                                      )}

                                      {/* Left/Right Bias */}
                                      {playerData.positioning_strategy.left_right_bias && (
                                        <div className="grid grid-cols-2 gap-2 text-sm">
                                          <div className="bg-[hsl(var(--tech-bg-secondary))] rounded p-2">
                                            <div className="text-[hsl(var(--tech-text-secondary))] text-xs">Left Side</div>
                                            <div className="text-[hsl(var(--tech-text-primary))] font-semibold">
                                              {playerData.positioning_strategy.left_right_bias.left_percent}%
                                            </div>
                                          </div>
                                          <div className="bg-[hsl(var(--tech-bg-secondary))] rounded p-2">
                                            <div className="text-[hsl(var(--tech-text-secondary))] text-xs">Right Side</div>
                                            <div className="text-[hsl(var(--tech-text-primary))] font-semibold">
                                              {playerData.positioning_strategy.left_right_bias.right_percent}%
                                            </div>
                                          </div>
                                          <div className="col-span-2 bg-[hsl(var(--tech-bg-secondary))] rounded p-2">
                                            <div className="text-[hsl(var(--tech-text-secondary))] text-xs">Dominant Side</div>
                                            <div className="text-[hsl(var(--tech-accent))] font-bold capitalize">
                                              {playerData.positioning_strategy.left_right_bias.dominant_side}
                                            </div>
                                          </div>
                                        </div>
                                      )}

                                      {/* Predictive Positioning */}
                                      {playerData.positioning_strategy.predictive_positioning && (
                                        <div className="bg-[hsl(var(--tech-bg-secondary))] rounded p-2">
                                          <div className="text-[hsl(var(--tech-text-secondary))] text-xs">Anticipation Score</div>
                                          <div className="text-[hsl(var(--tech-accent))] font-bold">
                                            {playerData.positioning_strategy.predictive_positioning.anticipation_score}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {/* Rally Dynamics */}
                                {playerData.rally_dynamics && (
                                  <div className="bg-[hsl(var(--tech-bg-tertiary))] rounded-lg p-4">
                                    <h5 className="text-sm font-semibold text-[hsl(var(--tech-text-primary))] mb-3 uppercase tracking-wider">
                                      Rally Dynamics
                                    </h5>
                                    <div className="space-y-3">
                                      {/* Speed Variation */}
                                      {playerData.rally_dynamics.speed_variation && (
                                        <div>
                                          <div className="text-xs text-[hsl(var(--tech-text-secondary))] mb-2">Speed Variation</div>
                                          <div className="grid grid-cols-2 gap-2 text-sm">
                                            <div className="bg-[hsl(var(--tech-bg-secondary))] rounded p-2">
                                              <div className="text-[hsl(var(--tech-text-secondary))] text-xs">First Quarter</div>
                                              <div className="text-[hsl(var(--tech-text-primary))] font-semibold">
                                                {playerData.rally_dynamics.speed_variation.first_quarter_speed_m_s} m/s
                                              </div>
                                            </div>
                                            <div className="bg-[hsl(var(--tech-bg-secondary))] rounded p-2">
                                              <div className="text-[hsl(var(--tech-text-secondary))] text-xs">Last Quarter</div>
                                              <div className="text-[hsl(var(--tech-text-primary))] font-semibold">
                                                {playerData.rally_dynamics.speed_variation.last_quarter_speed_m_s} m/s
                                              </div>
                                            </div>
                                            <div className="col-span-2 bg-[hsl(var(--tech-bg-secondary))] rounded p-2">
                                              <div className="text-[hsl(var(--tech-text-secondary))] text-xs">Speed Change</div>
                                              <div className="text-[hsl(var(--tech-accent))] font-bold">
                                                {playerData.rally_dynamics.speed_variation.change_percent}%
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      )}

                                      {/* Jump Pattern */}
                                      {playerData.rally_dynamics.jump_pattern && !playerData.rally_dynamics.jump_pattern.error && (
                                        <div>
                                          <div className="text-xs text-[hsl(var(--tech-text-secondary))] mb-2">Jump Pattern</div>
                                          <div className="grid grid-cols-2 gap-2 text-sm">
                                            <div className="bg-[hsl(var(--tech-bg-secondary))] rounded p-2">
                                              <div className="text-[hsl(var(--tech-text-secondary))] text-xs">Total Jumps</div>
                                              <div className="text-[hsl(var(--tech-text-primary))] font-semibold">
                                                {playerData.rally_dynamics.jump_pattern.total_jumps}
                                              </div>
                                            </div>
                                            <div className="bg-[hsl(var(--tech-bg-secondary))] rounded p-2">
                                              <div className="text-[hsl(var(--tech-text-secondary))] text-xs">Jumps/Second</div>
                                              <div className="text-[hsl(var(--tech-text-primary))] font-semibold">
                                                {playerData.rally_dynamics.jump_pattern.jumps_per_second}
                                              </div>
                                            </div>
                                            <div className="bg-[hsl(var(--tech-bg-secondary))] rounded p-2">
                                              <div className="text-[hsl(var(--tech-text-secondary))] text-xs">First Quarter</div>
                                              <div className="text-[hsl(var(--tech-text-primary))] font-semibold">
                                                {playerData.rally_dynamics.jump_pattern.first_quarter_jumps}
                                              </div>
                                            </div>
                                            <div className="bg-[hsl(var(--tech-bg-secondary))] rounded p-2">
                                              <div className="text-[hsl(var(--tech-text-secondary))] text-xs">Last Quarter</div>
                                              <div className="text-[hsl(var(--tech-text-primary))] font-semibold">
                                                {playerData.rally_dynamics.jump_pattern.last_quarter_jumps}
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      )}

                                      {/* Movement Intensity */}
                                      {playerData.rally_dynamics.movement_intensity && Object.keys(playerData.rally_dynamics.movement_intensity).length > 0 && (
                                        <div>
                                          <div className="text-xs text-[hsl(var(--tech-text-secondary))] mb-2">Movement Intensity Windows</div>
                                          <div className="space-y-2">
                                            {Object.entries(playerData.rally_dynamics.movement_intensity).map(([window, dataRaw]) => {
                                              // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                              const data = dataRaw as any;
                                              return (
                                              <div key={window} className="bg-[hsl(var(--tech-bg-secondary))] rounded p-2">
                                                <div className="text-[hsl(var(--tech-text-secondary))] text-xs font-semibold mb-1 capitalize">
                                                  {window.replace('_', ' ')}
                                                </div>
                                                <div className="grid grid-cols-3 gap-2 text-xs">
                                                  <div>
                                                    <div className="text-[hsl(var(--tech-text-secondary))]">Avg</div>
                                                    <div className="text-[hsl(var(--tech-text-primary))] font-medium">
                                                      {data.avg_distance_m}m
                                                    </div>
                                                  </div>
                                                  <div>
                                                    <div className="text-[hsl(var(--tech-text-secondary))]">Std</div>
                                                    <div className="text-[hsl(var(--tech-text-primary))] font-medium">
                                                      {data.std_distance_m}m
                                                    </div>
                                                  </div>
                                                  <div>
                                                    <div className="text-[hsl(var(--tech-text-secondary))]">Variation</div>
                                                    <div className="text-[hsl(var(--tech-text-primary))] font-medium">
                                                      {data.variation_percent}%
                                                    </div>
                                                  </div>
                                                </div>
                                              </div>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}
                          </div>
                        );
                        })}
                      </div>
                    );
                  })() : null}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}