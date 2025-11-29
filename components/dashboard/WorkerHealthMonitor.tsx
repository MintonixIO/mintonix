"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  XCircle,
  Clock,
  Server,
  Activity,
} from "lucide-react";

interface WorkerHealthMonitorProps {
  runpodJobId: string | null;
  userId: string;
  videoId: string;
  checkInterval?: number; // in milliseconds, default 30000 (30s)
}

interface WorkerHealthStatus {
  runpodJobId: string;
  status: string;
  runpodStatus: string;
  isAlive: boolean;
  workerDied: boolean;
  filesExist: boolean;
  recommendation: 'wait' | 'retry' | 'success' | 'failed';
  message: string;
  errorMessage?: string;
}

export function WorkerHealthMonitor({
  runpodJobId,
  userId,
  videoId,
  checkInterval = 30000, // Default 30s
}: WorkerHealthMonitorProps) {
  const [healthStatus, setHealthStatus] = useState<WorkerHealthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);

  // Function to check worker health
  const checkHealth = async () => {
    if (!runpodJobId) return;

    setError(null);

    try {
      const params = new URLSearchParams({
        runpodJobId,
        userId,
        videoId,
      });

      const response = await fetch(`/api/check-worker-health?${params.toString()}`);

      if (!response.ok) {
        throw new Error('Failed to check worker health');
      }

      const data: WorkerHealthStatus = await response.json();
      setHealthStatus(data);
      setLastCheck(new Date());

      // Stop checking if job is completed or failed permanently
      if (data.recommendation === 'success' || data.recommendation === 'failed') {
        // Job is in final state, stop monitoring
        return true; // Signal to stop interval
      }

      return false; // Continue monitoring
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      return false;
    }
  };

  // Polling-based monitoring (checks RunPod + R2 directly)
  useEffect(() => {
    if (!runpodJobId) {
      setHealthStatus(null);
      return;
    }

    // Initial check
    checkHealth();

    // Poll for updates
    const intervalId = setInterval(async () => {
      const shouldStop = await checkHealth();
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
  if (healthStatus?.recommendation === 'success') {
    return null;
  }

  // Don't render if still waiting and no issues
  if (healthStatus?.recommendation === 'wait' && !error) {
    return (
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Activity className="h-5 w-5 text-blue-500 animate-pulse" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h4 className="font-semibold text-blue-800">Worker Processing</h4>
                <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                  {healthStatus.runpodStatus}
                </Badge>
              </div>
              <p className="text-sm text-blue-600 mt-1">{healthStatus.message}</p>
              {lastCheck && (
                <p className="text-xs text-blue-500 mt-1">
                  Last checked: {lastCheck.toLocaleTimeString()}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show error state
  if (error || healthStatus?.recommendation === 'failed') {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <XCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-semibold text-red-800">Health Check Failed</h4>
              <p className="text-sm text-red-600 mt-1">
                {error || healthStatus?.errorMessage || 'Unable to check worker status'}
              </p>
              {healthStatus && (
                <div className="mt-2 text-xs text-red-500 space-y-1">
                  <div>RunPod Job: {healthStatus.runpodJobId}</div>
                  <div>Status: {healthStatus.runpodStatus}</div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show retry recommendation
  if (healthStatus?.recommendation === 'retry') {
    return (
      <Card className="border-orange-200 bg-orange-50">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-orange-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1 space-y-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="font-semibold text-orange-800">Worker Died</h4>
                  <Badge variant="destructive" className="text-xs">
                    {healthStatus.runpodStatus}
                  </Badge>
                </div>
                <p className="text-sm text-orange-700">{healthStatus.message}</p>
                {healthStatus.errorMessage && (
                  <p className="text-xs text-orange-600 mt-1 bg-orange-100 p-2 rounded border border-orange-200">
                    {healthStatus.errorMessage}
                  </p>
                )}
              </div>

              <div className="bg-orange-100 border border-orange-200 rounded p-2 text-xs text-orange-700">
                <div className="flex items-start gap-2">
                  <Server className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-medium">What happened?</div>
                    <div className="mt-1">
                      The RunPod worker processing your video has stopped unexpectedly.
                      {!healthStatus.filesExist && ' Output files are missing.'}
                      Please contact support or try uploading the video again.
                    </div>
                  </div>
                </div>
              </div>

              {lastCheck && (
                <p className="text-xs text-orange-500">
                  Last checked: {lastCheck.toLocaleTimeString()}
                </p>
              )}
            </div>
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
            <h4 className="font-semibold text-gray-800">Checking Worker Health...</h4>
            <p className="text-sm text-gray-600">Please wait while we verify the worker status</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
