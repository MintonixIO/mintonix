"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { playbackRate } from "@/lib/video-analysis/stats";

export type SpeedLabel = "0.5×" | "1×" | "1.5×" | "2×";

export const SPEED_OPTIONS: SpeedLabel[] = ["0.5×", "1×", "1.5×", "2×"];

export type UseVideoTransportOptions = {
  initialMuted?: boolean;
  initialSpeed?: SpeedLabel;
  initialPlaying?: boolean;
};

/** State + handlers only — no refs (safe to pass through React trees). */
export type VideoTransportControls = {
  playing: boolean;
  muted: boolean;
  speed: SpeedLabel;
  speedRate: number;
  setPlaying: (v: boolean | ((p: boolean) => boolean)) => void;
  setMuted: (v: boolean | ((p: boolean) => boolean)) => void;
  setSpeed: (s: SpeedLabel) => void;
  togglePlay: () => void;
  toggleMute: () => void;
  play: () => void;
  pause: () => void;
};

export type UseVideoTransportResult = VideoTransportControls & {
  videoRef: RefObject<HTMLVideoElement | null>;
};

/** @deprecated Prefer VideoTransportControls + videoRef */
export type VideoTransport = UseVideoTransportResult;

/**
 * Shared play/pause/mute/rate transport for product video surfaces.
 * Side effects run in effects, not ref callbacks.
 * Keep `videoRef` separate from control props when passing into children
 * so React Compiler does not treat the whole bag as a ref.
 */
export function useVideoTransport(
  options: UseVideoTransportOptions = {},
): UseVideoTransportResult {
  const {
    initialMuted = true,
    initialSpeed = "1×",
    initialPlaying = false,
  } = options;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(initialPlaying);
  const [muted, setMuted] = useState(initialMuted);
  const [speed, setSpeed] = useState<SpeedLabel>(initialSpeed);

  const speedRate = playbackRate(speed);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = muted;
  }, [muted]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.playbackRate = speedRate;
  }, [speedRate]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (playing) {
      void el.play().catch(() => {
        setPlaying(false);
      });
    } else {
      el.pause();
    }
  }, [playing]);

  const togglePlay = useCallback(() => setPlaying((v) => !v), []);
  const toggleMute = useCallback(() => setMuted((v) => !v), []);
  const play = useCallback(() => setPlaying(true), []);
  const pause = useCallback(() => setPlaying(false), []);

  return {
    videoRef,
    playing,
    muted,
    speed,
    speedRate,
    setPlaying,
    setMuted,
    setSpeed,
    togglePlay,
    toggleMute,
    play,
    pause,
  };
}
