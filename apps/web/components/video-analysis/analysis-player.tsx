"use client";

import type { RefObject } from "react";
import { MediaTransport } from "@/components/media/media-transport";
import type { SpeedLabel } from "@/lib/media/use-video-transport";

const RALLY_SEGMENTS: Array<[number, number, string]> = [
  [4, 8, "var(--accent)"],
  [14, 10, "var(--accent)"],
  [28, 14, "var(--accent)"],
  [46, 11, "var(--warning-500)"],
  [60, 16, "var(--accent)"],
  [78, 8, "var(--success-500)"],
  [88, 7, "var(--accent)"],
];

type AnalysisPlayerProps = {
  videoRef: RefObject<HTMLVideoElement | null>;
  playing: boolean;
  muted: boolean;
  speed: SpeedLabel;
  togglePlay: () => void;
  toggleMute: () => void;
  setSpeed: (s: SpeedLabel) => void;
};

export function AnalysisPlayer({
  videoRef,
  playing,
  muted,
  speed,
  togglePlay,
  toggleMute,
  setSpeed,
}: AnalysisPlayerProps) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-edge)]">
      <div className="relative aspect-video w-full max-h-[calc(100vh-196px)] overflow-hidden bg-[#070b16]">
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full cursor-pointer object-contain"
          src="/media/clip.mp4"
          poster="/media/clip-frame.jpg"
          playsInline
          muted={muted}
          loop
          onClick={togglePlay}
        />
      </div>

      <div className="flex flex-col gap-[11px] border-t border-[var(--border-subtle)] px-[15px] py-[13px] pb-[15px]">
        <div className="relative h-4 cursor-pointer">
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--surface-3)]" />
          {RALLY_SEGMENTS.map(([left, width, color], i) => (
            <div
              key={i}
              className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full opacity-70"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                background: color,
              }}
            />
          ))}
          <div className="absolute left-[38%] top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent)] shadow-[0_0_0_3px_rgba(54,147,255,0.25)]" />
        </div>
        <MediaTransport
          playing={playing}
          muted={muted}
          speed={speed}
          togglePlay={togglePlay}
          toggleMute={toggleMute}
          setSpeed={setSpeed}
          timeLabel={
            <>
              00:00 <span className="text-[var(--text-faint)]">/ 00:24</span>
            </>
          }
        />
      </div>
    </section>
  );
}
