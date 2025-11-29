"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ThumbnailRegenerator } from "./ThumbnailRegenerator";
import {
  Play,
  CheckCircle,
  Clock,
  AlertCircle,
  Camera,
  User,
  MapPin,
  Filter,
  BarChart3,
  ChevronRight,
  Settings,
  RefreshCw,
  AlertTriangle
} from "lucide-react";

interface AnalysisPipelineProps {
  videoId: string;
  userId: string;
  videoDurationSeconds?: number;
  video?: {
    key: string;
    fileName: string;
    size: number;
    uploadedAt: Date;
    userId: string;
    videoId: string;
  };
  videoElement?: HTMLVideoElement | null;
  onReset?: () => void;
  onComplete?: () => void;
}

type StepStatus = 'pending' | 'running' | 'completed' | 'failed';

interface AnalysisStep {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  status: StepStatus;
  progress: number;
  estimatedTime: string;
  dependencies: string[];
  currentStage?: string;
  errorMessage?: string;
  startTime?: number;
  endTime?: number;
  retryCount?: number;
  maxRetries?: number;
}

interface ResultsData {
  error?: string;
  message?: string;
  summary?: {
    reprojection_error_pixels?: number;
    camera_height_meters?: number;
    focal_length_pixels?: number;
    total_points_available?: number;
    points_used?: number;
    total_processing_time?: number;
    poses_detected?: number;
    frames_processed?: number;
    position_frames?: number;
    artifacts_corrected?: number;
    ml_jumps_detected?: number;
    players_analyzed?: number;
  };
  detected_points?: Record<string, unknown>;
  pose_summary?: {
    total_poses_detected: number;
    processing_info: Record<string, unknown>;
    video_info: Record<string, unknown>;
    court_points: Record<string, unknown>;
    camera_info: Record<string, unknown>;
    frames_processed: number;
    model_device: string;
    pose_analysis_summary: {
      total_frames_with_poses: number;
      avg_poses_per_frame: number;
      player_detections: number;
    };
  };
  position_summary?: {
    frames_with_data: number;
    total_ankle_detections: number;
    player_0_detections: number;
    player_1_detections: number;
    tracking_method: string;
    advanced_tracking: boolean;
    tracking_quality: Record<string, unknown>;
  };
  files?: Array<{
    name: string;
    url: string;
  }>;
}

export function AnalysisPipeline({ videoId, userId, videoDurationSeconds, video, videoElement, onReset, onComplete }: AnalysisPipelineProps) {
  const getEstimatedTime = (stepId: string) => {
    if (!videoDurationSeconds) return '...';

    const durationMinutes = videoDurationSeconds / 60;

    switch (stepId) {
      case 'calibration':
        return '2-3 minutes';
      case 'pose_position_artifacts':
        const poseMin = Math.ceil(durationMinutes * 2);
        let poseMax = Math.ceil(durationMinutes * 3);
        if (poseMin === poseMax) poseMax = poseMin + 1;
        return `${poseMin}-${poseMax} minutes`;
      case 'visualization':
        return '1-2 minutes';
      default:
        return '...';
    }
  };

  const [steps, setSteps] = useState<AnalysisStep[]>([
    {
      id: 'calibration',
      name: 'Court & Camera Calibration',
      description: 'Detect court boundaries and calibrate camera perspective',
      icon: <Camera className="h-5 w-5" />,
      status: 'pending',
      progress: 0,
      estimatedTime: getEstimatedTime('calibration'),
      dependencies: [],
      retryCount: 0,
      maxRetries: 3
    },
    {
      id: 'pose_position_artifacts',
      name: 'Pose, Position & Artifact Removal',
      description: 'Extract player poses, calculate real-world positions, and remove tracking artifacts using physics-based corrections',
      icon: <div className="flex"><User className="h-4 w-4" /><MapPin className="h-4 w-4 -ml-1" /><Filter className="h-4 w-4 -ml-1" /></div>,
      status: 'pending',
      progress: 0,
      estimatedTime: getEstimatedTime('pose_position_artifacts'),
      dependencies: ['calibration'],
      retryCount: 0,
      maxRetries: 2
    },
    {
      id: 'visualization',
      name: 'Visualization',
      description: 'Generate analyzed video with player tracking overlay',
      icon: <BarChart3 className="h-5 w-5" />,
      status: 'pending',
      progress: 0,
      estimatedTime: getEstimatedTime('visualization'),
      dependencies: ['pose_position_artifacts'],
      retryCount: 0,
      maxRetries: 2
    }
  ]);

  const [isRunning, setIsRunning] = useState(false);
  const [showResults, setShowResults] = useState<string | null>(null);
  const [resultsData, setResultsData] = useState<ResultsData | null>(null);
  const [loadingResults, setLoadingResults] = useState(false);
  // Removed visualizationKey state - will be needed when CourtVisualization component is implemented
  // const [visualizationKey, setVisualizationKey] = useState(0);
  const stepsRef = useRef(steps);

  // Removed auto-loading of analysis status to prevent starting at 50%
  // This was causing the progress bar to incorrectly show completed steps
  // when the component mounts

  // Update estimated times when video duration changes
  useEffect(() => {
    setSteps(prev => prev.map(step => ({
      ...step,
      estimatedTime: getEstimatedTime(step.id)
    })));
  }, [videoDurationSeconds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update ref when steps change
  useEffect(() => {
    stepsRef.current = steps;
  }, [steps]);

  const getStatusIcon = (status: StepStatus) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'running':
        return <Clock className="h-5 w-5 text-blue-500 animate-pulse" />;
      case 'failed':
        return <AlertCircle className="h-5 w-5 text-red-500" />;
      default:
        return <Clock className="h-5 w-5 text-gray-400" />;
    }
  };

  const getStatusBadge = (status: StepStatus) => {
    switch (status) {
      case 'completed':
        return <Badge variant="secondary" className="bg-green-100 text-green-800">Completed</Badge>;
      case 'running':
        return <Badge variant="secondary" className="bg-blue-100 text-blue-800">Running</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="outline">Pending</Badge>;
    }
  };

  const canRunStep = (step: AnalysisStep) => {
    return step.dependencies.every(depId =>
        steps.find(s => s.id === depId)?.status === 'completed'
    );
  };

  const runStep = async (stepId: string) => {
    const startTime = Date.now();

    setSteps(prev => prev.map(step =>
        step.id === stepId
            ? {
              ...step,
              status: 'running' as StepStatus,
              progress: 0,
              currentStage: stepId === 'calibration' ? 'Initializing court detection...' : 'Starting analysis...',
              errorMessage: undefined,
              startTime
            }
            : step
    ));

    try {
      let progressInterval: NodeJS.Timeout;

      if (stepId === 'calibration') {
        // Enhanced progress tracking for calibration
        const stages = [
          'Downloading video from storage...',
          'Running court detection algorithm...',
          'Analyzing court boundaries...',
          'Calibrating camera parameters...',
          'Saving calibration results...'
        ];

        let currentStageIndex = 0;
        progressInterval = setInterval(() => {
          setSteps(prev => prev.map(step => {
            if (step.id === stepId && step.status === 'running') {
              const newProgress = Math.min(step.progress + 2, 95);

              // Update stage based on progress
              if (newProgress > 20 && currentStageIndex === 0) {
                currentStageIndex = 1;
              } else if (newProgress > 40 && currentStageIndex === 1) {
                currentStageIndex = 2;
              } else if (newProgress > 60 && currentStageIndex === 2) {
                currentStageIndex = 3;
              } else if (newProgress > 80 && currentStageIndex === 3) {
                currentStageIndex = 4;
              }

              return {
                ...step,
                progress: newProgress,
                currentStage: stages[currentStageIndex]
              };
            }
            return step;
          }));
        }, 1000);
      } else if (stepId === 'pose_position_artifacts') {
        // Enhanced progress tracking for combined pose, position, and artifact removal
        const stages = [
          'Loading court data from storage...',
          'Initializing pose detection model...',
          'Running pose detection on frames...',
          'Calculating real-world positions...',
          'Detecting and removing artifacts...',
          'Applying physics-based corrections...',
          'Calculating player statistics...',
          'Saving analysis results...'
        ];

        let currentStageIndex = 0;
        progressInterval = setInterval(() => {
          setSteps(prev => prev.map(step => {
            if (step.id === stepId && step.status === 'running') {
              const newProgress = Math.min(step.progress + 1.2, 95);

              // Update stage based on progress
              if (newProgress > 12 && currentStageIndex === 0) {
                currentStageIndex = 1;
              } else if (newProgress > 25 && currentStageIndex === 1) {
                currentStageIndex = 2;
              } else if (newProgress > 50 && currentStageIndex === 2) {
                currentStageIndex = 3;
              } else if (newProgress > 65 && currentStageIndex === 3) {
                currentStageIndex = 4;
              } else if (newProgress > 75 && currentStageIndex === 4) {
                currentStageIndex = 5;
              } else if (newProgress > 85 && currentStageIndex === 5) {
                currentStageIndex = 6;
              } else if (newProgress > 92 && currentStageIndex === 6) {
                currentStageIndex = 7;
              }

              return {
                ...step,
                progress: newProgress,
                currentStage: stages[currentStageIndex]
              };
            }
            return step;
          }));
        }, 2000);
      } else {
        // Basic progress for other steps
        progressInterval = setInterval(() => {
          setSteps(prev => prev.map(step => {
            if (step.id === stepId && step.status === 'running') {
              const newProgress = Math.min(step.progress + 5, 95);
              return { ...step, progress: newProgress };
            }
            return step;
          }));
        }, 500);
      }

      // Use the async analysis endpoint for all steps
      const response = await fetch('/api/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, videoId })
      });

      clearInterval(progressInterval);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      const endTime = Date.now();
      const duration = Math.round((endTime - startTime) / 1000);

      if (stepId === 'pose_position_artifacts') {
        // Handle unified analysis result
        setResultsData(result);

        setSteps(prev => prev.map(step =>
          step.id === stepId
            ? {
                ...step,
                status: 'completed' as StepStatus,
                progress: 100,
                currentStage: `Completed! Processed ${result.summary?.poses_detected || 0} poses, corrected ${result.summary?.artifacts_corrected || 0} artifacts`,
                endTime
              }
            : step
        ));
      } else {
        setSteps(prev => prev.map(step =>
            step.id === stepId
                ? {
                  ...step,
                  status: 'completed' as StepStatus,
                  progress: 100,
                  currentStage: `Completed in ${duration}s`,
                  endTime
                }
                : step
        ));
      }
    } catch (error) {
      setSteps(prev => prev.map(step =>
          step.id === stepId
              ? {
                ...step,
                status: 'failed' as StepStatus,
                currentStage: 'Failed',
                errorMessage: error instanceof Error ? error.message : 'Unknown error occurred',
                endTime: Date.now(),
                retryCount: (step.retryCount || 0) + 1
              }
              : step
      ));
    }
  };

  const retryStep = async (stepId: string) => {
    const step = steps.find(s => s.id === stepId);
    if (!step || (step.retryCount || 0) >= (step.maxRetries || 0)) {
      return;
    }

    // Reset step state but keep retry count
    setSteps(prev => prev.map(s =>
        s.id === stepId
            ? {
              ...s,
              status: 'pending' as StepStatus,
              progress: 0,
              currentStage: undefined,
              errorMessage: undefined,
              startTime: undefined,
              endTime: undefined
            }
            : s
    ));

    // Run the step again
    await runStep(stepId);
  };

  const runAllSteps = async () => {
    setIsRunning(true);

    const stepOrder = ['calibration', 'pose_position_artifacts', 'visualization'];

    for (const stepId of stepOrder) {
      // Get current state from ref
      const currentSteps = stepsRef.current;
      const currentStep = currentSteps.find(s => s.id === stepId);

      if (currentStep && currentStep.status === 'pending') {
        // Check if dependencies are met
        const canRun = currentStep.dependencies.every(depId =>
            currentSteps.find(s => s.id === depId)?.status === 'completed'
        );

        if (canRun) {
          await new Promise(resolve => {
            runStep(stepId);
            setTimeout(resolve, 2500);
          });

          // Wait for state to update
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }

    setIsRunning(false);

    // Check if all steps completed successfully
    const finalSteps = stepsRef.current;
    const allCompleted = finalSteps.every(s => s.status === 'completed');

    if (allCompleted && onComplete) {
      // Notify parent that analysis completed successfully
      onComplete();
    }
  };

  const viewResults = async (stepId: string) => {
    setLoadingResults(true);
    setShowResults(stepId);

    try {
      if (stepId === 'calibration') {
        // Fetch calibration summary
        const response = await fetch(`/api/analysis-results?userId=${userId}&videoId=${videoId}&step=${stepId}`);
        if (response.ok) {
          const data = await response.json();
          setResultsData(data);
        } else {
          setResultsData({ error: 'Failed to load results' });
        }
      } else if (stepId === 'pose_position_artifacts') {
        // Show unified analysis results
        if (resultsData && resultsData.summary) {
          // Results are already loaded from the API call
          setResultsData(resultsData);
        } else {
          setResultsData({ error: 'Results not available' });
        }
      } else {
        // For other steps, show placeholder
        setResultsData({ message: `Results for ${stepId} will be available here` });
      }
    } catch (error) {
      console.error('Error loading results:', error);
      setResultsData({ error: 'Error loading results' });
    } finally {
      setLoadingResults(false);
    }
  };

  const resetPipeline = async () => {
    try {
      // Delete all analysis files
      const response = await fetch(`/api/analysis-reset?userId=${userId}&videoId=${videoId}`, {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error('Failed to reset analysis');

      // Reset UI state
      setSteps(prev => prev.map(step => ({
        ...step,
        status: 'pending' as StepStatus,
        progress: 0,
        currentStage: undefined,
        errorMessage: undefined,
        startTime: undefined,
        endTime: undefined,
        retryCount: 0
      })));
      setIsRunning(false);
      setShowResults(null);
      setResultsData(null);

      // Notify parent component that reset occurred
      if (onReset) {
        onReset();
      }
    } catch (error) {
      console.error('Error resetting analysis:', error);
    }
  };

  const completedSteps = steps.filter(step => step.status === 'completed').length;
  const totalSteps = steps.length;

  return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Analysis Pipeline</span>
            <div className="flex gap-2">
              <Button
                  onClick={resetPipeline}
                  variant="outline"
                  size="sm"
                  disabled={isRunning}
              >
                <Settings className="h-4 w-4 mr-2" />
                Reset
              </Button>
              <Button
                  onClick={runAllSteps}
                  disabled={isRunning || completedSteps === totalSteps}
                  size="sm"
              >
                <Play className="h-4 w-4 mr-2" />
                {isRunning ? 'Running...' : 'Start Analysis'}
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Overall Progress */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Overall Progress</span>
              <span>{completedSteps}/{totalSteps} steps completed</span>
            </div>
            <Progress value={(completedSteps / totalSteps) * 100} className="h-2" />
          </div>

          {/* Steps */}
          <div className="space-y-4">
            {steps.map((step, index) => (
                <div key={step.id} className="relative">
                  {/* Connection line to next step */}
                  {index < steps.length - 1 && (
                      <div className="absolute left-6 top-12 w-px h-8 bg-border" />
                  )}

                  <Card className={`transition-all duration-200 ${
                      step.status === 'running' ? 'ring-2 ring-blue-500 ring-opacity-50' : ''
                  }`}>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        <div className="flex-shrink-0 mt-1">
                          {getStatusIcon(step.status)}
                        </div>

                        <div className="flex-1 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              {step.icon}
                              <h3 className="font-semibold">{step.name}</h3>
                            </div>
                            {getStatusBadge(step.status)}
                          </div>

                          <p className="text-sm text-muted-foreground">
                            {step.description}
                          </p>

                          <div className="flex items-center justify-between text-sm text-muted-foreground">
                            <span>Est. time: {step.estimatedTime}</span>
                            {step.dependencies.length > 0 && (
                                <span className="text-xs">
                            Requires: {step.dependencies.map(dep =>
                                    steps.find(s => s.id === dep)?.name
                                ).join(', ')}
                          </span>
                            )}
                          </div>

                          {step.status === 'running' && (
                              <div className="space-y-2">
                                <div className="text-sm font-medium text-blue-600">
                                  {step.currentStage}
                                </div>
                                <Progress value={step.progress} className="h-2" />
                                <div className="text-xs text-muted-foreground">
                                  {step.progress}% complete
                                </div>
                              </div>
                          )}

                          {step.status === 'pending' && (
                              <Button
                                  onClick={() => runStep(step.id)}
                                  disabled={!canRunStep(step) || isRunning}
                                  variant="outline"
                                  size="sm"
                                  className="mt-2"
                              >
                                <Play className="h-3 w-3 mr-1" />
                                Run Step
                              </Button>
                          )}

                          {step.status === 'completed' && (
                              <div className="space-y-2">
                                <div className="flex items-center gap-2 text-sm text-green-600">
                                  <CheckCircle className="h-4 w-4" />
                                  <span>{step.currentStage || 'Step completed successfully'}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                                  <Button
                                      variant="link"
                                      size="sm"
                                      className="h-auto p-0 text-blue-600"
                                      onClick={() => viewResults(step.id)}
                                      disabled={loadingResults}
                                  >
                                    {loadingResults && showResults === step.id ? 'Loading...' : 'View Results'}
                                  </Button>
                                </div>
                                {step.id === 'pose_position_artifacts' && resultsData?.summary && (
                                  <div className="mt-2 text-xs text-muted-foreground space-y-1 bg-gray-50 p-2 rounded">
                                    <div>• {resultsData.summary.poses_detected} poses detected across {resultsData.summary.frames_processed} frames</div>
                                    <div>• {resultsData.summary.position_frames} position frames calculated</div>
                                    <div>• {resultsData.summary.artifacts_corrected} tracking artifacts corrected</div>
                                    <div>• {resultsData.summary.ml_jumps_detected} ML jumps detected</div>
                                    <div>• {resultsData.summary.players_analyzed} players analyzed</div>
                                  </div>
                                )}
                              </div>
                          )}

                          {step.status === 'failed' && (
                              <div className="space-y-3">
                                <div className="flex items-start gap-2 text-sm">
                                  <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                                  <div className="flex-1">
                                    <div className="font-medium text-red-600 mb-1">
                                      Step Failed {step.retryCount && step.retryCount > 1 ? `(Attempt ${step.retryCount})` : ''}
                                    </div>
                                    <div className="text-red-600 text-xs bg-red-50 p-2 rounded border">
                                      {step.errorMessage}
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2">
                                  {(step.retryCount || 0) < (step.maxRetries || 0) && (
                                      <Button
                                          onClick={() => retryStep(step.id)}
                                          variant="outline"
                                          size="sm"
                                          className="text-orange-600 border-orange-200 hover:bg-orange-50"
                                          disabled={isRunning}
                                      >
                                        <RefreshCw className="h-3 w-3 mr-1" />
                                        Retry ({(step.maxRetries || 0) - (step.retryCount || 0)} left)
                                      </Button>
                                  )}

                                  {(step.retryCount || 0) >= (step.maxRetries || 0) && (
                                      <div className="text-xs text-red-500">
                                        Max retries exceeded. Please check the error or reset the pipeline.
                                      </div>
                                  )}
                                </div>
                              </div>
                          )}

                          {/* Results Display */}
                          {showResults === step.id && resultsData && (
                              <div className="mt-4 bg-gray-950 rounded-lg border border-gray-800 overflow-hidden">
                                {/* Header */}
                                <div className="bg-gray-900 border-b border-gray-800">
                                  <div className="flex items-center justify-between p-4">
                                    <div className="flex items-center gap-3">
                                      <BarChart3 className="h-5 w-5 text-gray-400" />
                                      <h4 className="font-medium text-white">{step.name} Results</h4>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setShowResults(null)}
                                        className="h-8 w-8 p-0 hover:bg-gray-800 text-gray-500 hover:text-gray-300"
                                    >
                                      ×
                                    </Button>
                                  </div>
                                </div>

                                <div className="p-4">
                                  {resultsData.error ? (
                                      <div className="bg-red-950/30 border border-red-900/50 rounded-lg p-4">
                                        <div className="flex items-center gap-2">
                                          <AlertCircle className="h-4 w-4 text-red-400" />
                                          <span className="text-red-300 font-medium">Error Loading Results</span>
                                        </div>
                                        <p className="text-red-200/80 text-sm mt-2">{String(resultsData.error)}</p>
                                      </div>
                                  ) : resultsData.message ? (
                                      <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4">
                                        <div className="flex items-center gap-2">
                                          <Clock className="h-4 w-4 text-gray-400" />
                                          <span className="text-gray-300 font-medium">
                                            Coming Soon
                                          </span>
                                        </div>
                                        <p className="text-gray-400 text-sm mt-2">{String(resultsData.message)}</p>
                                      </div>
                                  ) : (
                                      <div className="space-y-6">
                                        {/* Display results content based on step type */}
                                        {step.id === 'calibration' && resultsData.summary && (
                                          <div className="grid grid-cols-2 gap-3 text-sm">
                                            <div className="bg-gray-900 p-3 rounded-lg border border-gray-800">
                                              <div className="text-gray-400 text-xs">Reprojection Error</div>
                                              <div className="text-white text-lg font-medium mt-1">
                                                {resultsData.summary.reprojection_error_pixels?.toFixed(2)}px
                                              </div>
                                            </div>
                                            <div className="bg-gray-900 p-3 rounded-lg border border-gray-800">
                                              <div className="text-gray-400 text-xs">Camera Height</div>
                                              <div className="text-white text-lg font-medium mt-1">
                                                {resultsData.summary.camera_height_meters?.toFixed(1)}m
                                              </div>
                                            </div>
                                          </div>
                                        )}

                                        {step.id === 'pose_position_artifacts' && resultsData.summary && (
                                          <div className="grid grid-cols-2 gap-3 text-sm">
                                            <div className="bg-gray-900 p-3 rounded-lg border border-gray-800">
                                              <div className="text-gray-400 text-xs">Poses Detected</div>
                                              <div className="text-white text-lg font-medium mt-1">
                                                {resultsData.summary.poses_detected?.toLocaleString()}
                                              </div>
                                            </div>
                                            <div className="bg-gray-900 p-3 rounded-lg border border-gray-800">
                                              <div className="text-gray-400 text-xs">Position Frames</div>
                                              <div className="text-white text-lg font-medium mt-1">
                                                {resultsData.summary.position_frames?.toLocaleString()}
                                              </div>
                                            </div>
                                            <div className="bg-gray-900 p-3 rounded-lg border border-gray-800">
                                              <div className="text-gray-400 text-xs">Artifacts Corrected</div>
                                              <div className="text-white text-lg font-medium mt-1">
                                                {resultsData.summary.artifacts_corrected}
                                              </div>
                                            </div>
                                            <div className="bg-gray-900 p-3 rounded-lg border border-gray-800">
                                              <div className="text-gray-400 text-xs">Players Analyzed</div>
                                              <div className="text-white text-lg font-medium mt-1">
                                                {resultsData.summary.players_analyzed}
                                              </div>
                                            </div>
                                          </div>
                                        )}


                                        {/* Court Visualization for calibration */}
                                        {step.id === 'calibration' && resultsData.detected_points && Object.keys(resultsData.detected_points).length > 0 && (
                                            <div>
                                              <div className="flex items-center justify-between mb-4">
                                                <div className="flex items-center gap-2">
                                                  <MapPin className="h-4 w-4 text-gray-400"/>
                                                  <h5 className="font-medium text-white">Court Detection</h5>
                                                </div>
                                                {video && (
                                                    <ThumbnailRegenerator
                                                        userId={userId}
                                                        videoId={videoId}
                                                        videoKey={video.key}
                                                        videoElement={videoElement}
                                                        onThumbnailRegenerated={() => {
                                                          // Will be used when CourtVisualization is implemented
                                                          // setVisualizationKey(prev => prev + 1);
                                                        }}
                                                        className="bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700 hover:text-white text-xs"
                                                    />
                                                )}
                                              </div>
                                                <div
                                                    className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden"
                                                    style={{aspectRatio: '16 / 9'}}
                                                >
                                                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                                                    Court visualization coming soon
                                                  </div>
                                                </div>
                                              </div>
                                          )}
                                      </div>
                                  )}
                                </div>
                              </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
            ))}
          </div>

          {/* Analysis Results */}
          {completedSteps === totalSteps && (
              <Card className="border-green-200 bg-green-50">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <CheckCircle className="h-6 w-6 text-green-500"/>
                    <div>
                      <h3 className="font-semibold text-green-800">Analysis Complete!</h3>
                      <p className="text-sm text-green-600">
                        Your badminton video has been fully analyzed with player tracking. View detailed insights and visualizations.
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Button size="sm" className="bg-green-600 hover:bg-green-700">
                      <BarChart3 className="h-4 w-4 mr-2"/>
                      View Analysis
                    </Button>
                    <Button variant="outline" size="sm">
                      Export Data
                    </Button>
                  </div>
                </CardContent>
              </Card>
          )}
        </CardContent>
      </Card>
  );
}