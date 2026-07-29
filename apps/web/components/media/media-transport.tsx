"use client";

import type { ReactNode } from "react";
import {
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SPEED_OPTIONS,
  type SpeedLabel,
  type VideoTransportControls,
} from "@/lib/media/use-video-transport";

export type MediaTransportProps = {
  playing: boolean;
  muted: boolean;
  speed: SpeedLabel;
  togglePlay: () => void;
  toggleMute: () => void;
  setSpeed: (s: SpeedLabel) => void;
  /** Current / total time labels (formatted). */
  timeLabel?: ReactNode;
  showSkip?: boolean;
  onSkipBack?: () => void;
  onSkipForward?: () => void;
  className?: string;
  /** Extra controls on the right of the bar (before speed). */
  trailing?: ReactNode;
};

/** Build props from a controls object (no videoRef). */
export function mediaTransportFromControls(
  c: Pick<
    VideoTransportControls,
    "playing" | "muted" | "speed" | "togglePlay" | "toggleMute" | "setSpeed"
  >,
): Pick<
  MediaTransportProps,
  "playing" | "muted" | "speed" | "togglePlay" | "toggleMute" | "setSpeed"
> {
  return {
    playing: c.playing,
    muted: c.muted,
    speed: c.speed,
    togglePlay: c.togglePlay,
    toggleMute: c.toggleMute,
    setSpeed: c.setSpeed,
  };
}

/**
 * Shared transport chrome: skip / play / mute / speed.
 * Pair with a <video ref={videoRef} /> in the parent — do not pass the ref here.
 */
export function MediaTransport({
  playing,
  muted,
  speed,
  togglePlay,
  toggleMute,
  setSpeed,
  timeLabel,
  showSkip = true,
  onSkipBack,
  onSkipForward,
  className,
  trailing,
}: MediaTransportProps) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="flex items-center gap-1">
        {showSkip ? (
          <button
            type="button"
            aria-label="Skip back"
            onClick={onSkipBack}
            className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)]"
          >
            <SkipBack className="h-4 w-4" />
          </button>
        ) : null}
        <button
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          onClick={togglePlay}
          className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-[9px] bg-[var(--accent)] text-white"
        >
          {playing ? (
            <Pause className="h-[17px] w-[17px]" />
          ) : (
            <Play className="ml-0.5 h-[17px] w-[17px]" />
          )}
        </button>
        {showSkip ? (
          <button
            type="button"
            aria-label="Skip forward"
            onClick={onSkipForward}
            className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)]"
          >
            <SkipForward className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {timeLabel ? (
        <span className="font-mono text-[12.5px] tabular-nums tracking-wide text-[var(--text-strong)]">
          {timeLabel}
        </span>
      ) : null}

      <div className="flex-1" />

      {trailing}

      <button
        type="button"
        aria-label={muted ? "Unmute" : "Mute"}
        onClick={toggleMute}
        className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-strong)]"
      >
        {muted ? (
          <VolumeX className="h-4 w-4" />
        ) : (
          <Volume2 className="h-4 w-4" />
        )}
      </button>

      <div className="flex gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
        {SPEED_OPTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSpeed(s)}
            className={cn(
              "rounded-md px-2 py-1 font-mono text-[11px]",
              speed === s
                ? "bg-[var(--accent)] text-white"
                : "text-[var(--text-muted)]",
            )}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
