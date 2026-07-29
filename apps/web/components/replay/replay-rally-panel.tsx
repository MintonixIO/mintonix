"use client";

import Link from "next/link";
import { Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RALLIES, SHOTS } from "@/lib/replay/data";
import { cn } from "@/lib/utils";

type ReplayRallyPanelProps = {
  rally: number;
  setRally: (n: number) => void;
  shot: number;
  setShot: (n: number) => void;
  scoreA: number;
  scoreB: number;
};

export function ReplayRallyPanel({
  rally,
  setRally,
  shot,
  setShot,
  scoreA,
  scoreB,
}: ReplayRallyPanelProps) {
  return (
    <aside className="flex w-[320px] shrink-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-edge)]">
      <div className="flex items-center gap-2.5 border-b border-[var(--border-subtle)] px-4 py-3.5">
        <Video className="h-4 w-4 text-[var(--cyan-500)]" aria-hidden />
        <div>
          <div className="font-display text-[15px] font-semibold text-[var(--text-strong)]">
            Rally {rally}
          </div>
          <div className="font-mono text-[11px] text-[var(--text-muted)]">
            {SHOTS.length} shots · G3 · {scoreA}–{scoreB}
          </div>
        </div>
      </div>

      <div className="border-b border-[var(--border-subtle)] p-2">
        <div className="mb-1.5 px-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
          Rallies
        </div>
        <div className="max-h-[160px] space-y-1 overflow-y-auto">
          {RALLIES.map((r) => (
            <button
              key={r.n}
              type="button"
              onClick={() => setRally(r.n)}
              className={cn(
                "flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left",
                rally === r.n
                  ? "border border-[rgba(80,222,255,0.35)] bg-[rgba(80,222,255,0.1)]"
                  : "border border-transparent hover:bg-[var(--surface-2)]",
              )}
            >
              <span className="font-mono text-[12px] font-semibold tabular-nums text-[var(--text-secondary)]">
                {r.n}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--text-strong)]">
                {r.result}
              </span>
              <span className="font-mono text-[10px] text-[var(--text-muted)]">
                {r.shots}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="mb-1.5 px-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
          Shots in rally
        </div>
        <div className="space-y-1" role="listbox" aria-label="Shots in rally">
          {SHOTS.map((s) => (
            <button
              key={s.n}
              type="button"
              role="option"
              aria-selected={shot === s.n}
              onClick={() => setShot(s.n)}
              className={cn(
                "flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left",
                shot === s.n
                  ? "border border-[var(--border)] bg-[var(--accent-soft)]"
                  : "border border-transparent hover:bg-[var(--surface-2)]",
              )}
            >
              <span className="font-mono text-[12px] tabular-nums text-[var(--text-muted)]">
                {s.n}
              </span>
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  s.who === "A" ? "bg-[var(--player-a)]" : "bg-[var(--player-b)]",
                )}
              />
              <span className="flex-1 text-[12.5px] text-[var(--text-strong)]">
                {s.type}
              </span>
              <span className="font-mono text-[10px] text-[var(--text-muted)]">
                {s.t}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-[var(--border-subtle)] p-3">
        <Link href="/video-analysis" className="block">
          <Button variant="outline" block size="sm">
            Open match analysis
          </Button>
        </Link>
      </div>
    </aside>
  );
}
