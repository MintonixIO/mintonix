"use client";

import type { ReactNode } from "react";
import { Activity, Crosshair, Ruler, Target, Wind } from "lucide-react";
import type { Frame, Rally, Shot } from "@/lib/match-viewer/types";
import { cn } from "@/lib/utils";

type AnalysisPanelProps = {
  rally: Rally;
  shot: Shot | null;
  frame: Frame;
  playerA: string;
  playerB: string;
};

/** Compact analysis card — keeps the 2h moments list dominant. */
export function AnalysisPanel({
  rally,
  shot,
  frame,
  playerA,
  playerB,
}: AnalysisPanelProps) {
  const who = shot?.player === "A" ? playerA : playerB;

  return (
    <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-edge)]">
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-2.5 py-1.5">
        <Activity className="h-3.5 w-3.5 text-[var(--cyan-500)]" aria-hidden />
        <div className="min-w-0">
          <div className="font-display text-[12.5px] font-semibold text-[var(--text-strong)]">
            {shot ? `Shot ${shot.index}` : "Rally"}
          </div>
          <div className="truncate font-mono text-[10px] text-[var(--text-muted)]">
            R{rally.n} · {rally.endReason}
          </div>
        </div>
      </div>

      <div className="space-y-2 p-2">
        {shot ? (
          <p className="text-[12px] leading-snug text-[var(--text-secondary)]">
            <span className="font-medium text-[var(--text-strong)]">{who.split(" ").pop()}</span>
            {" — "}
            {shot.analysis}
          </p>
        ) : (
          <p className="text-[12px] leading-snug text-[var(--text-secondary)]">
            Select a shot or scrub to see per-stroke analysis.
          </p>
        )}

        <div className="grid grid-cols-2 gap-1.5">
          <Stat
            icon={<Wind className="h-3 w-3" />}
            label="Speed"
            value={shot ? `${shot.speedKmh}` : `${rally.maxSmashKmh || "—"}`}
            unit={shot || rally.maxSmashKmh ? "km/h" : ""}
            accent={!!shot && shot.speedKmh >= 280}
          />
          <Stat
            icon={<Ruler className="h-3 w-3" />}
            label="Contact"
            value={shot ? shot.contactHeight.toFixed(2) : "—"}
            unit={shot ? "m" : ""}
          />
          <Stat
            icon={<Target className="h-3 w-3" />}
            label="Shuttle Z"
            value={frame.shuttle.z.toFixed(2)}
            unit="m"
          />
          <Stat
            icon={<Crosshair className="h-3 w-3" />}
            label="Shots"
            value={`${rally.shots.length}`}
            unit=""
          />
        </div>

        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-sunken)] p-1.5 font-mono text-[10px] leading-relaxed text-[var(--text-muted)]">
          <div className="mb-0.5 text-[9px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
            3D coords (m)
          </div>
          <CoordRow label="A" v={frame.a} color="var(--player-a)" />
          <CoordRow label="B" v={frame.b} color="var(--player-b)" />
          <CoordRow label="S" v={frame.shuttle} color="var(--cyan-500)" />
        </div>
      </div>
    </section>
  );
}

function Stat({
  icon,
  label,
  value,
  unit,
  accent,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  unit: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2 py-1.5">
      <div className="flex items-center gap-1 text-[var(--text-muted)]">
        {icon}
        <span className="font-mono text-[9px] uppercase tracking-wider">{label}</span>
      </div>
      <div
        className={cn(
          "mt-0.5 font-mono text-[15px] font-semibold tabular-nums leading-none",
          accent ? "text-[var(--danger-400)]" : "text-[var(--text-strong)]",
        )}
      >
        {value}
        {unit ? (
          <span className="ml-0.5 text-[10px] font-normal text-[var(--text-muted)]">{unit}</span>
        ) : null}
      </div>
    </div>
  );
}

function CoordRow({
  label,
  v,
  color,
}: {
  label: string;
  v: { x: number; y: number; z: number };
  color: string;
}) {
  return (
    <div className="flex items-center gap-1.5 tabular-nums">
      <span className="inline-block w-2.5 font-semibold" style={{ color }}>
        {label}
      </span>
      <span>
        {v.x.toFixed(2)} · {v.y.toFixed(2)} · {v.z.toFixed(2)}
      </span>
    </div>
  );
}
