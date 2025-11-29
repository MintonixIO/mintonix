"use client";

import { useParams } from "next/navigation";
import { useEffect, useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, Activity, Target, Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Maximize, Loader2 } from "lucide-react";
import Link from "next/link";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export default function SharedAnalysisPage() {
  const params = useParams();
  const token = params.token as string;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analysisData, setAnalysisData] = useState<Record<string, unknown> | null>(null);
  const [playerNames, setPlayerNames] = useState<Record<string, string>>({});
  const [videoUrl, setVideoUrl] = useState<string>('');

  // Video player state
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    fetchSharedAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const fetchSharedAnalysis = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/share/${token}`);

      if (!response.ok) {
        if (response.status === 404) {
          setError('This share link is invalid or has been revoked.');
        } else if (response.status === 410) {
          setError('This share link has expired.');
        } else if (response.status === 202) {
          setError('The analysis for this video is not yet complete. Please try again later.');
        } else {
          setError('Failed to load shared analysis.');
        }
        return;
      }

      const data = await response.json();
      setAnalysisData(data.positionAnalysisData);
      setPlayerNames(data.playerNames || {});
      setVideoUrl(`/api/share/${token}/video`);
    } catch (err) {
      console.error('Error fetching shared analysis:', err);
      setError('Failed to load shared analysis.');
    } finally {
      setLoading(false);
    }
  };

  // Video player handlers
  const togglePlay = useCallback(() => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
    }
  }, [isPlaying]);

  const seekRelative = useCallback((seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, Math.min(videoRef.current.currentTime + seconds, duration));
    }
  }, [duration]);

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

  const setPlaybackSpeed = (rate: number) => {
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
      setPlaybackRate(rate);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.target !== document.body) return;

      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
        case 'j':
          e.preventDefault();
          seekRelative(-10);
          break;
        case 'ArrowRight':
        case 'l':
          e.preventDefault();
          seekRelative(10);
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
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [togglePlay, seekRelative, volume, toggleFullscreen, toggleMute, handleVolumeChange]);

  // Fullscreen change listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[hsl(var(--tech-bg))] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-[hsl(var(--tech-accent))]" />
          <div className="text-[hsl(var(--tech-text-secondary))]">Loading shared analysis...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[hsl(var(--tech-bg))] flex items-center justify-center">
        <div className="text-center max-w-md p-8">
          <h1 className="text-2xl font-bold mb-4 text-[hsl(var(--tech-text-primary))]">Unable to Load Analysis</h1>
          <p className="text-[hsl(var(--tech-text-secondary))] mb-6">{error}</p>
          <Link href="/">
            <Button className="bg-[hsl(var(--tech-accent))] hover:bg-[hsl(var(--tech-accent-hover))] text-[hsl(var(--tech-text-primary))]">
              Go to Home
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[hsl(var(--tech-bg))]">
      <main className="w-full bg-[hsl(var(--tech-bg))]">
        {/* Header */}
        <div className="border-b border-[hsl(var(--tech-border))] bg-[hsl(var(--tech-bg-secondary))]">
          <div className="max-w-7xl mx-auto px-8 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-[hsl(var(--tech-text-primary))]">Shared Analysis</h1>
                <p className="text-sm text-[hsl(var(--tech-text-secondary))]">
                  Badminton video analysis powered by Mintonix
                </p>
              </div>
              <Link href="/">
                <Button variant="outline" size="sm">
                  Try Mintonix
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* Video Player Section */}
        <div className="bg-[hsl(var(--tech-bg-secondary))] border-b border-[hsl(var(--tech-border))]">
          <div className="max-w-7xl mx-auto px-8 py-6">
            <div className="w-full">
              {/* Video Header */}
              <div className="flex items-center justify-between mb-3 px-1">
                <h3 className="text-sm font-medium text-[hsl(var(--tech-text-secondary))] tracking-wide uppercase">
                  Analyzed Video
                </h3>
              </div>

              {/* Video Container */}
              <div className="bg-[hsl(var(--tech-bg-tertiary))] rounded-xl border border-[hsl(var(--tech-border))]/50 overflow-hidden">
                <div className="space-y-3 p-3">
                  <div
                    ref={containerRef}
                    className={`relative bg-black overflow-hidden group cursor-pointer ${
                      isFullscreen ? 'fixed inset-0 z-50' : 'rounded-lg aspect-video'
                    }`}
                    onClick={togglePlay}
                  >
                    <video
                      ref={videoRef}
                      src={videoUrl}
                      className="w-full h-full object-contain"
                      onLoadedMetadata={() => {
                        if (videoRef.current) {
                          setDuration(videoRef.current.duration);
                        }
                      }}
                      onTimeUpdate={() => {
                        if (videoRef.current) {
                          setCurrentTime(videoRef.current.currentTime);
                        }
                      }}
                      onPlay={() => setIsPlaying(true)}
                      onPause={() => setIsPlaying(false)}
                    />

                    {/* Center Play Button */}
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
                  </div>

                  {/* Controls */}
                  {!isFullscreen && (
                    <div className="bg-[hsl(var(--tech-bg))]/40 rounded-b-lg p-3 space-y-3">
                      {/* Timeline */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm text-[hsl(var(--tech-text-secondary))]">
                          <span>Timeline</span>
                          <span className="font-mono">
                            {formatTime(currentTime)} / {formatTime(duration)}
                          </span>
                        </div>
                        <div
                          className="relative w-full h-3 bg-[hsl(var(--tech-border))] rounded-full cursor-pointer"
                          onClick={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            const percent = (e.clientX - rect.left) / rect.width;
                            if (videoRef.current) {
                              videoRef.current.currentTime = percent * duration;
                            }
                          }}
                        >
                          <div
                            className="absolute top-0 left-0 h-full bg-[hsl(var(--tech-accent))] rounded-full"
                            style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
                          />
                        </div>
                      </div>

                      {/* Control Buttons */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={togglePlay}>
                            {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                          </Button>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => seekRelative(-10)}>
                            <SkipBack className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => seekRelative(10)}>
                            <SkipForward className="h-3.5 w-3.5" />
                          </Button>
                        </div>

                        <div className="flex items-center gap-2">
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={toggleMute}>
                            {isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-8 px-2 text-xs font-medium">
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
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={toggleFullscreen}>
                            <Maximize className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Stats Bar */}
        {analysisData && (
          <div className="bg-[hsl(var(--tech-bg-tertiary))] border-b border-[hsl(var(--tech-border))]">
            <div className="max-w-7xl mx-auto px-8 py-4">
              <div className="flex items-center gap-6 flex-wrap">
                <Badge variant="outline" className="px-4 py-2 text-sm">
                  <Activity className="h-4 w-4 mr-2" />
                  Status: Analyzed
                </Badge>
                {(analysisData.players && Object.keys(analysisData.players as Record<string, unknown>).length > 0) ? (
                  <>
                    <div className="flex items-center gap-2 text-sm">
                      <Target className="h-4 w-4 text-[hsl(var(--tech-accent))]" />
                      <span className="text-[hsl(var(--tech-text-secondary))]">Players:</span>
                      <span className="font-semibold text-[hsl(var(--tech-text-primary))]">
                        {Object.keys(analysisData.players).length}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="h-4 w-4 text-[hsl(var(--tech-accent))]" />
                      <span className="text-[hsl(var(--tech-text-secondary))]">Tracked:</span>
                      <span className="font-semibold text-[hsl(var(--tech-text-primary))]">
                        {(Object.values(analysisData.players)[0] as Record<string, unknown>)?.time_tracked_seconds as number || 0}s
                      </span>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        )}

        {/* Analysis Content */}
        <div className="max-w-7xl mx-auto px-8 py-8">
          {analysisData?.players ? (() => {
            const playerEntries = Object.entries(analysisData.players as Record<string, unknown>);
            const getPlayerName = (playerId: string) => {
              if (playerNames[playerId]) return playerNames[playerId];
              const match = playerId.match(/player_(\d+)/i);
              return match ? `Player ${match[1]}` : playerId;
            };
            const getPlayerLabel = (playerId: string) => {
              const match = playerId.match(/player_(\d+)/i);
              return match ? `P${match[1]}` : playerId.toUpperCase();
            };

            return (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {playerEntries.map(([playerId, playerDataRaw]) => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const playerData = playerDataRaw as any;
                  return (
                  <div key={playerId} className="space-y-4">
                    <div className="bg-[hsl(var(--tech-bg-tertiary))] rounded-lg p-3">
                      <div className="flex flex-col items-center justify-center w-full">
                        <h4 className="text-lg font-semibold text-[hsl(var(--tech-text-primary))] text-center w-full">
                          {getPlayerName(playerId)}
                        </h4>
                        <p className="text-xs text-[hsl(var(--tech-text-secondary))] mt-1 text-center w-full">
                          ({getPlayerLabel(playerId)})
                        </p>
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
                          {playerData.movement_efficiency.return_to_center && (
                            <div className="grid grid-cols-2 gap-3 text-sm">
                              <div className="bg-[hsl(var(--tech-bg-secondary))] rounded p-2">
                                <div className="text-[hsl(var(--tech-text-secondary))] text-xs">Avg Distance from Center</div>
                                <div className="text-[hsl(var(--tech-text-primary))] font-semibold">
                                  {playerData.movement_efficiency.return_to_center.average_distance_from_center_m}m
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
                            </div>
                          )}
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
                              </div>
                            </div>
                          )}
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

        {/* Footer */}
        <div className="border-t border-[hsl(var(--tech-border))] bg-[hsl(var(--tech-bg-secondary))]">
          <div className="max-w-7xl mx-auto px-8 py-6 text-center">
            <p className="text-sm text-[hsl(var(--tech-text-secondary))]">
              Analysis powered by <Link href="/" className="text-[hsl(var(--tech-accent))] hover:underline">Mintonix</Link> - AI-powered badminton video analysis
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
