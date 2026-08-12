"use client";

import { useEffect, useRef, type ReactNode } from "react";
import {
  Gauge,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  StepBack,
  StepForward,
} from "lucide-react";
import type { Shot, TimelineScope } from "@/lib/match-viewer/types";
import { formatMatchClock } from "@/lib/match-viewer/format";
import { cn } from "@/lib/utils";

export type TransportMarker = {
  id: string;
  /** Local time within the active scope */
  t: number;
  kind: "shot" | "smash" | "rally";
  label?: string;
};

type TransportProps = {
  scope: TimelineScope;
  scopeLabel: string;
  scopeDuration: number;
  scopeT: number;
  shot: Shot | null;
  playing: boolean;
  speed: number;
  markers?: TransportMarker[];
  onToggle: () => void;
  onSeek: (scopeLocalT: number) => void;
  onPrevShot: () => void;
  onNextShot: () => void;
  onPrevRally: () => void;
  onNextRally: () => void;
  onSpeed: (s: number) => void;
};

const SPEEDS = [0.25, 0.5, 1, 1.5, 2];

/** Classic transport chrome — scrubs the active timeline scope under the hood. */
export function Transport({
  scope,
  scopeLabel,
  scopeDuration,
  scopeT,
  shot,
  playing,
  speed,
  markers = [],
  onToggle,
  onSeek,
  onPrevShot,
  onNextShot,
  onPrevRally,
  onNextRally,
  onSpeed,
}: TransportProps) {
  const duration = Math.max(0.001, scopeDuration);
  const t = Math.max(0, Math.min(duration, scopeT));
  const progress = t / duration;

  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
    };
  }, []);

  const seekFromEvent = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return;
    const next = ((clientX - r.left) / r.width) * duration;
    onSeek(Math.max(0, Math.min(duration, next)));
  };

  return (
    <div className="space-y-1.5 border-t border-[var(--border-subtle)] bg-[rgba(10,16,32,0.72)] px-2.5 py-2 sm:px-3">
      <div
        className="relative h-6 cursor-pointer touch-none"
        role="slider"
        aria-label={scopeLabel}
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={t}
        tabIndex={0}
        onClick={(e) => seekFromEvent(e.clientX, e.currentTarget)}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const el = e.currentTarget;
          el.setPointerCapture(e.pointerId);
          seekFromEvent(e.clientX, el);
          const move = (ev: PointerEvent) => seekFromEvent(ev.clientX, el);
          const up = () => {
            try {
              el.releasePointerCapture(e.pointerId);
            } catch {
              /* already released */
            }
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", up);
            dragCleanupRef.current = null;
          };
          dragCleanupRef.current?.();
          dragCleanupRef.current = up;
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
          window.addEventListener("pointercancel", up);
        }}
        onKeyDown={(e) => {
          const step = scope.level === "rally" ? 0.1 : scope.level === "set" ? 2 : 15;
          if (e.key === "ArrowLeft") onSeek(Math.max(0, t - step));
          if (e.key === "ArrowRight") onSeek(Math.min(duration, t + step));
        }}
      >
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-sm bg-[#1b2744]" />

        {markers.map((m) => {
          const left = (m.t / duration) * 100;
          if (m.kind === "smash") {
            return (
              <div
                key={m.id}
                className="pointer-events-none absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--danger-500)] shadow-[0_0_6px_rgba(244,81,92,0.6)]"
                style={{ left: `${left}%` }}
                title={m.label}
              />
            );
          }
          return (
            <div
              key={m.id}
              className="pointer-events-none absolute top-1/2 h-2 w-px -translate-y-1/2 bg-[var(--border-strong)]"
              style={{ left: `${left}%` }}
              title={m.label}
            />
          );
        })}

        <div
          className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-sm bg-[linear-gradient(90deg,var(--brand),var(--cyan-500))]"
          style={{ width: `${progress * 100}%` }}
        />
        <div
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--bg-base)] bg-[var(--cyan-500)] shadow-[0_0_8px_rgba(80,222,255,0.5)]"
          style={{ left: `${progress * 100}%` }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        <div className="flex items-center gap-0.5">
          <IconBtn label="Previous rally" onClick={onPrevRally}>
            <SkipBack className="h-[14px] w-[14px]" />
          </IconBtn>
          <IconBtn label="Previous shot" onClick={onPrevShot}>
            <StepBack className="h-[14px] w-[14px]" />
          </IconBtn>
          <button
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            onClick={onToggle}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--brand)] text-white shadow-[0_0_16px_rgba(54,147,255,0.35)]"
          >
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 pl-0.5" />}
          </button>
          <IconBtn label="Next shot" onClick={onNextShot}>
            <StepForward className="h-[14px] w-[14px]" />
          </IconBtn>
          <IconBtn label="Next rally" onClick={onNextRally}>
            <SkipForward className="h-[14px] w-[14px]" />
          </IconBtn>
        </div>

        <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
          {formatMatchClock(t)}
          <span className="text-[var(--text-faint)]"> / </span>
          {formatMatchClock(duration)}
        </span>

        {shot ? (
          <span className="hidden items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-2 py-0.5 text-[11.5px] sm:inline-flex">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                shot.player === "A" ? "bg-[var(--player-a)]" : "bg-[var(--player-b)]",
              )}
            />
            <span className="text-[var(--text-strong)]">
              {shot.index}: {shot.type}
            </span>
            {shot.speedKmh >= 200 ? (
              <span className="font-mono text-[10px] text-[var(--danger-400)]">
                {shot.speedKmh}
              </span>
            ) : null}
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-0.5">
          <Gauge className="h-3 w-3 text-[var(--text-muted)]" aria-hidden />
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSpeed(s)}
              className={cn(
                "rounded px-1.5 py-0.5 font-mono text-[10.5px] tabular-nums",
                speed === s
                  ? "bg-[var(--brand-subtle)] text-[var(--cyan-500)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-strong)]",
              )}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:text-[var(--text-strong)]"
    >
      {children}
    </button>
  );
}
