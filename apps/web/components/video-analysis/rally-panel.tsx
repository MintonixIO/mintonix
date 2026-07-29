"use client";

import { ChevronDown, Filter, ListTree } from "lucide-react";
import { RALLIES } from "@/lib/video-analysis/rallies";
import type { AnalysisScope } from "@/lib/video-analysis/stats";
import { cn } from "@/lib/utils";

type RallyPanelProps = {
  expanded: number;
  shotIdx: number;
  scope: AnalysisScope;
  onSelectRally: (n: number) => void;
  onSelectShot: (idx: number) => void;
};

export function RallyPanel({
  expanded,
  shotIdx,
  scope,
  onSelectRally,
  onSelectShot,
}: RallyPanelProps) {
  return (
    <section className="relative min-h-[480px] overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-edge)]">
      <div className="flex items-center gap-2.5 border-b border-[var(--border-subtle)] px-[15px] py-3.5">
        <ListTree className="h-[17px] w-[17px] text-[var(--accent)]" />
        <div>
          <div className="font-display text-[15px] font-semibold text-[var(--text-strong)]">
            Rally control
          </div>
          <div className="mt-px font-mono text-[11px] text-[var(--text-muted)]">
            9 rallies · expand for shots
          </div>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-[12px] text-[var(--text-secondary)]"
        >
          <Filter className="h-3.5 w-3.5" />
          Filter
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="absolute inset-x-0 bottom-0 top-[62px] space-y-1.5 overflow-y-auto p-2">
        {RALLIES.map((r) => {
          const open = expanded === r.n;
          return (
            <div
              key={r.n}
              className={cn(
                "overflow-hidden rounded-[11px] border",
                open
                  ? "border-[var(--accent)] bg-[var(--surface-2)]"
                  : "border-[var(--border-subtle)] bg-[var(--surface-2)]",
              )}
            >
              <button
                type="button"
                onClick={() => onSelectRally(r.n)}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
              >
                <span className="w-5 font-mono text-[12.5px] font-semibold tabular-nums text-[var(--text-secondary)]">
                  {String(r.n).padStart(2, "0")}
                </span>
                <span
                  className={cn(
                    "h-8 w-0.5 shrink-0 rounded-full",
                    r.tone === "success" && "bg-[var(--success-500)]",
                    r.tone === "danger" && "bg-[var(--danger-500)]",
                    r.tone === "warn" && "bg-[var(--warning-500)]",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[12.5px] tabular-nums text-[var(--text-strong)]">
                      {r.shots} shots
                    </span>
                    <span className="text-[var(--text-faint)]">·</span>
                    <span className="font-mono text-xs text-[var(--text-muted)]">
                      {r.dur}s
                    </span>
                  </div>
                  <div
                    className={cn(
                      "mt-0.5 text-xs",
                      r.tone === "success" && "text-[var(--success-400)]",
                      r.tone === "danger" && "text-[var(--danger-400)]",
                      r.tone === "warn" && "text-[var(--warning-400)]",
                    )}
                  >
                    Ended · {r.end}
                  </div>
                </div>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-[var(--text-muted)] transition-transform",
                    open && "rotate-180 text-[var(--accent)]",
                  )}
                />
              </button>
              {open ? (
                <div className="border-t border-[var(--border-subtle)] px-3 pb-2.5 pt-1">
                  <div className="mb-1.5 flex items-center justify-between px-0.5 py-1.5">
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
                      Shot control
                    </span>
                    <span className="font-mono text-[10px] text-[var(--text-muted)]">
                      {r.shots} strokes
                    </span>
                  </div>
                  <div className="space-y-1">
                    {r.sequence.map((s, idx) => (
                      <button
                        key={s.i}
                        type="button"
                        onClick={() => onSelectShot(idx)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-left",
                          shotIdx === idx && scope === "shot"
                            ? "border-[var(--accent)] bg-[var(--surface-1)]"
                            : "border-[var(--border-subtle)] bg-[var(--surface-1)] hover:border-[var(--border-strong)]",
                        )}
                      >
                        <span className="min-w-4 font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                          {s.i}
                        </span>
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ background: s.color }}
                        />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--text-strong)]">
                          {s.type}
                        </span>
                        <span className="rounded border border-[var(--border)] px-1 font-mono text-[10px] text-[var(--text-muted)]">
                          {s.side}
                        </span>
                        {s.speed ? (
                          <span className="min-w-[52px] text-right font-mono text-[11px] tabular-nums text-[var(--accent)]">
                            {s.speed} km/h
                          </span>
                        ) : (
                          <span className="min-w-[52px]" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
