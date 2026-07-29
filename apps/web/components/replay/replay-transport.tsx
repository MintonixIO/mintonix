"use client";

import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { SHOTS } from "@/lib/replay/data";

type ReplayTransportProps = {
  shot: number;
  setShot: (v: number | ((s: number) => number)) => void;
  playing: boolean;
  togglePlay: () => void;
};

export function ReplayTransport({
  shot,
  setShot,
  playing,
  togglePlay,
}: ReplayTransportProps) {
  return (
    <div className="flex items-center gap-3 border-t border-[var(--border-subtle)] bg-[rgba(10,16,32,0.6)] px-3.5 py-2.5">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label="Previous shot"
          onClick={() => setShot((s) => Math.max(1, s - 1))}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:text-[var(--text-strong)]"
        >
          <SkipBack className="h-[15px] w-[15px]" />
        </button>
        <button
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          onClick={togglePlay}
          className="inline-flex h-9 w-9 items-center justify-center rounded-[9px] bg-[var(--accent)] text-white shadow-[0_0_16px_rgba(54,147,255,0.35)]"
        >
          {playing ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </button>
        <button
          type="button"
          aria-label="Next shot"
          onClick={() => setShot((s) => Math.min(SHOTS.length, s + 1))}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:text-[var(--text-strong)]"
        >
          <SkipForward className="h-[15px] w-[15px]" />
        </button>
      </div>
      <span className="whitespace-nowrap font-mono text-[11.5px] tabular-nums text-[var(--text-muted)]">
        Shot {shot} / {SHOTS.length}
      </span>
      <div
        className="relative h-6 flex-1 cursor-pointer"
        role="slider"
        aria-label="Shot scrubber"
        aria-valuemin={1}
        aria-valuemax={SHOTS.length}
        aria-valuenow={shot}
        tabIndex={0}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const t = Math.max(
            1,
            Math.min(
              SHOTS.length,
              Math.round(((e.clientX - r.left) / r.width) * SHOTS.length),
            ),
          );
          setShot(t);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setShot((s) => Math.max(1, s - 1));
          if (e.key === "ArrowRight")
            setShot((s) => Math.min(SHOTS.length, s + 1));
        }}
      >
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-sm bg-[#1b2744]" />
        {/* shot tick marks */}
        {SHOTS.map((s) => (
          <div
            key={s.n}
            className="pointer-events-none absolute top-1/2 h-2 w-px -translate-y-1/2 bg-[var(--border)]"
            style={{ left: `${((s.n - 0.5) / SHOTS.length) * 100}%` }}
          />
        ))}
        <div
          className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-sm bg-[linear-gradient(90deg,var(--accent),var(--cyan-500))]"
          style={{ width: `${(shot / SHOTS.length) * 100}%` }}
        />
        <div
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--cyan-500)] shadow-[0_0_8px_rgba(80,222,255,0.5)]"
          style={{ left: `${(shot / SHOTS.length) * 100}%` }}
        />
      </div>
      <span className="font-mono text-[11.5px] tabular-nums text-[var(--text-muted)]">
        {SHOTS[shot - 1]?.t ?? "0.0s"}
      </span>
    </div>
  );
}
