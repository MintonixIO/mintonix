"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  XCircle,
  Clock,
  Activity,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";

interface WorkerHealthMonitorProps {
  runpodJobId: string | null;
  userId: string;
  videoId: string;
  checkInterval?: number; // in milliseconds, default 30000 (30s)
  onRetry?: () => void;
}

interface JobProgress {
  calibration: boolean;
  poseEstimation: boolean;
  shuttleTracking: boolean;
  positionCorrection: boolean;
  visualization: boolean;
  allComplete: boolean;
}

interface JobStatus {
  runpodJobId: string;
  progress: JobProgress;
  recommendation: 'processing' | 'completed' | 'retry';
  message: string;
  workerAlive: boolean;
  workerDied: boolean;
  runpodStatus?: string;
  errorMessage?: string;
}

export function WorkerHealthMonitor({
  runpodJobId,
  userId,
  videoId,
  checkInterval = 30000, // Default 30s
  onRetry,
}: WorkerHealthMonitorProps) {
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);

  // Function to check job status
  const checkStatus = async () => {
    if (!runpodJobId) return;

    setError(null);

    try {
      const params = new URLSearchParams({
        runpodJobId,
        userId,
        videoId,
      });

      const response = await fetch(`/api/job-status?${params.toString()}`);

      if (!response.ok) {
        throw new Error('Failed to check job status');
      }

      const data: JobStatus = await response.json();
      setStatus(data);
      setLastCheck(new Date());

      // Stop checking if job is completed
      if (data.recommendation === 'completed') {
        return true; // Signal to stop interval
      }

      return false; // Continue monitoring
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      return false;
    }
  };

  // Polling-based monitoring every 30 seconds
  useEffect(() => {
    if (!runpodJobId) {
      setStatus(null);
      return;
    }

    // Initial check
    checkStatus();

    // Poll for updates every 30 seconds
    const intervalId = setInterval(async () => {
      const shouldStop = await checkStatus();
      if (shouldStop) {
        clearInterval(intervalId);
      }
    }, checkInterval);

    // Cleanup
    return () => {
      clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runpodJobId, userId, videoId, checkInterval]);

  // Don't render if no runpod job ID
  if (!runpodJobId) {
    return null;
  }

  // Don't render if job completed successfully
  if (status?.recommendation === 'completed') {
    return null;
  }

  // Helper to render progress steps
  const renderProgressSteps = (progress: JobProgress) => {
    const steps = [
      { key: 'calibration', label: 'Court Detection', complete: progress.calibration },
      { key: 'poseEstimation', label: 'Pose Estimation', complete: progress.poseEstimation },
      { key: 'shuttleTracking', label: 'Shuttle Tracking', complete: progress.shuttleTracking },
      { key: 'positionCorrection', label: 'Position Correction', complete: progress.positionCorrection },
      { key: 'visualization', label: 'Visualization', complete: progress.visualization },
    ];

    return (
      <div className="space-y-1.5">
        {steps.map((step) => (
          <div key={step.key} className="flex items-center gap-2 text-xs">
            {step.complete ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
            ) : (
              <Clock className="h-3.5 w-3.5 text-gray-400" />
            )}
            <span className={step.complete ? 'text-green-700 font-medium' : 'text-gray-600'}>
              {step.label}
            </span>
          </div>
        ))}
      </div>
    );
  };

  // Show error state
  if (error) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <XCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-semibold text-red-800">Status Check Failed</h4>
              <p className="text-sm text-red-600 mt-1">{error}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show retry recommendation (worker died)
  if (status?.recommendation === 'retry') {
    return (
      <Card className="border-orange-200 bg-orange-50">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-orange-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="font-semibold text-orange-800">Worker Died</h4>
                  {status.runpodStatus && (
                    <Badge variant="destructive" className="text-xs">
                      {status.runpodStatus}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-orange-700">{status.message}</p>
                {status.errorMessage && (
                  <p className="text-xs text-orange-600 mt-2 bg-orange-100 p-2 rounded border border-orange-200">
                    {status.errorMessage}
                  </p>
                )}
              </div>
            </div>

            {/* Show progress achieved before failure */}
            <div className="bg-white/50 rounded p-3 border border-orange-200">
              <p className="text-xs font-medium text-orange-800 mb-2">Progress before failure:</p>
              {renderProgressSteps(status.progress)}
            </div>

            {/* Retry button if handler provided */}
            {onRetry && (
              <Button
                onClick={onRetry}
                variant="outline"
                size="sm"
                className="w-full border-orange-300 text-orange-700 hover:bg-orange-100"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry Analysis
              </Button>
            )}

            {lastCheck && (
              <p className="text-xs text-orange-500">
                Last checked: {lastCheck.toLocaleTimeString()}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show processing state with progress
  if (status?.recommendation === 'processing') {
    return (
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Activity className="h-5 w-5 text-blue-500 animate-pulse" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="font-semibold text-blue-800">Processing Video</h4>
                  {status.runpodStatus && (
                    <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                      {status.runpodStatus}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-blue-600 mt-1">{status.message}</p>
              </div>
            </div>

            {/* Show current progress */}
            <div className="bg-white/50 rounded p-3 border border-blue-200">
              <p className="text-xs font-medium text-blue-800 mb-2">Analysis Progress:</p>
              {renderProgressSteps(status.progress)}
            </div>

            {lastCheck && (
              <p className="text-xs text-blue-500">
                Last checked: {lastCheck.toLocaleTimeString()}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Fallback: show checking state
  return (
    <Card className="border-gray-200 bg-gray-50">
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <Clock className="h-5 w-5 text-gray-500 animate-pulse" />
          <div>
            <h4 className="font-semibold text-gray-800">Checking Status...</h4>
            <p className="text-sm text-gray-600">Please wait while we verify the job status</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
