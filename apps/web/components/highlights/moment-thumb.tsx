import { Play } from "lucide-react";
import { CourtDot } from "@/components/charts/court-dot";
import { CourtThumb } from "@/components/media/court-thumb";
import type { Moment } from "@/lib/highlights/moments";
import { cn } from "@/lib/utils";

export function durLabel(secs: number) {
  return `0:${String(secs).padStart(2, "0")}`;
}

export function fmtSecs(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function MomentThumb({
  m,
  large,
  className,
}: {
  m: Moment;
  large?: boolean;
  className?: string;
}) {
  return (
    <CourtThumb
      className={cn(large ? "aspect-[16/8.4]" : "aspect-video", className)}
      gridOpacity={0.5}
    >
      <CourtDot x={m.dotX} y={m.dotY} size={large ? 10 : 8} />
      <span className="absolute top-2.5 left-2.5 rounded-full border border-[var(--border)] bg-[rgba(7,11,22,0.72)] px-2 py-0.5 font-mono text-[10px] tracking-[0.06em] text-[var(--text-secondary)] backdrop-blur-[6px]">
        {m.speed
          ? `${m.type} · ${m.speed} km/h`
          : m.kind === "rally"
            ? `Rally · ${m.rallyLen} shots`
            : `${m.type} · winner`}
      </span>
      <span className="absolute right-2.5 bottom-2 rounded border border-[var(--border)] bg-[rgba(7,11,22,0.78)] px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--text-strong)]">
        {durLabel(m.dur)}
      </span>
      {large ? (
        <span className="absolute top-1/2 left-1/2 inline-flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[rgba(54,147,255,0.92)] text-white shadow-[var(--glow-blue)]">
          <Play className="ml-0.5 h-5 w-5" />
        </span>
      ) : null}
    </CourtThumb>
  );
}

/** Compact court thumb for discovery side-cards. */
export function CompactMomentThumb({
  m,
  className,
}: {
  m: Moment;
  className?: string;
}) {
  return (
    <CourtThumb className={cn("relative h-full w-full", className)} gridOpacity={0.5}>
      <CourtDot x={m.dotX} y={m.dotY} size={7} />
      <span className="absolute right-1.5 bottom-1 rounded bg-[rgba(7,11,22,0.78)] px-1 font-mono text-[10px] text-[var(--text-strong)]">
        {durLabel(m.dur)}
      </span>
    </CourtThumb>
  );
}
