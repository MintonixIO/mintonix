"use client";

import { useEffect, useMemo, useRef } from "react";
import { ChevronDown, Filter, Zap } from "lucide-react";
import type { MomentFilter, Rally, Shot } from "@/lib/match-viewer/types";
import { FILTER_LABELS } from "@/lib/match-viewer/types";
import { cn, formatDuration, formatTime } from "@/lib/utils";

type RallyBrowserProps = {
  rallies: Rally[];
  filtered: Rally[];
  activeRallyId: string;
  activeShotId: string | null;
  filter: MomentFilter;
  setFilter: number | "all";
  onFilter: (f: MomentFilter) => void;
  onSetFilter: (s: number | "all") => void;
  onSelectRally: (id: string) => void;
  onSelectShot: (rallyId: string, shot: Shot) => void;
  sets: number;
};

const FILTERS: MomentFilter[] = [
  "all",
  "fast-smash",
  "long-rally",
  "net-play",
  "winner",
  "unforced",
  "high-intensity",
];

/** Dense moments rail for ~100+ rallies across a 2h match. */
export function RallyBrowser({
  rallies,
  filtered,
  activeRallyId,
  activeShotId,
  filter,
  setFilter,
  onFilter,
  onSetFilter,
  onSelectRally,
  onSelectShot,
  sets,
}: RallyBrowserProps) {
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeRallyId]);

  const counts = useMemo(() => {
    const m: Record<number, number> = {};
    for (const r of rallies) m[r.set] = (m[r.set] ?? 0) + 1;
    return m;
  }, [rallies]);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-edge)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-2.5 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="font-display text-[12.5px] font-semibold text-[var(--text-strong)]">
            Moments
          </div>
          <div className="font-mono text-[10px] text-[var(--text-muted)]">
            {filtered.length}/{rallies.length} · jump by game or tag
          </div>
        </div>
      </div>

      {/* Game chips — primary way to slice a 2h match */}
      <div className="flex shrink-0 gap-0.5 border-b border-[var(--border-subtle)] px-1.5 py-1">
        <SetChip active={setFilter === "all"} onClick={() => onSetFilter("all")} label="All" />
        {Array.from({ length: sets }, (_, i) => i + 1).map((s) => (
          <SetChip
            key={s}
            active={setFilter === s}
            onClick={() => onSetFilter(s)}
            label={`G${s}`}
            count={counts[s]}
          />
        ))}
      </div>

      <div className="shrink-0 border-b border-[var(--border-subtle)] px-1.5 py-1">
        <div className="mb-0.5 flex items-center gap-1 px-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
          <Filter className="h-2.5 w-2.5" />
          Filter
        </div>
        <div className="flex flex-wrap gap-0.5">
          {FILTERS.map((f) => {
            const active = filter === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => onFilter(f)}
                className={cn(
                  "rounded-full border px-1.5 py-0.5 text-[10.5px] transition-colors",
                  active
                    ? "border-[rgba(80,222,255,0.4)] bg-[rgba(80,222,255,0.12)] text-[var(--cyan-500)]"
                    : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]",
                )}
              >
                {FILTER_LABELS[f]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-px overflow-y-auto p-1">
        {filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-[12px] text-[var(--text-muted)]">
            No rallies match.
          </div>
        ) : (
          filtered.map((r) => {
            const open = r.id === activeRallyId;
            const tone = r.tags.includes("unforced")
              ? "danger"
              : r.tags.includes("winner")
                ? "success"
                : "warn";
            return (
              <div
                key={r.id}
                ref={open ? activeRef : undefined}
                className={cn(
                  "overflow-hidden rounded-md border",
                  open
                    ? "border-[rgba(80,222,255,0.4)] bg-[var(--surface-2)]"
                    : "border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--surface-2)]",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelectRally(r.id)}
                  className="flex w-full items-center gap-1.5 px-1.5 py-1 text-left"
                >
                  <span className="w-6 shrink-0 font-mono text-[10px] tabular-nums text-[var(--text-muted)]">
                    {String(r.n).padStart(3, "0")}
                  </span>
                  <span
                    className={cn(
                      "h-5 w-0.5 shrink-0 rounded-full",
                      tone === "success" && "bg-[var(--success-500)]",
                      tone === "danger" && "bg-[var(--danger-500)]",
                      tone === "warn" && "bg-[var(--warning-500)]",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1 text-[11.5px] leading-tight">
                      <span className="font-mono tabular-nums text-[var(--text-strong)]">
                        G{r.set}
                      </span>
                      <span className="text-[var(--text-faint)]">·</span>
                      <span className="truncate text-[var(--text-secondary)]">{r.endReason}</span>
                    </div>
                    <div className="flex items-center gap-1 font-mono text-[9.5px] leading-tight text-[var(--text-muted)]">
                      <span>
                        {r.scoreA}–{r.scoreB}
                      </span>
                      <span>·</span>
                      <span>{r.shots.length}sh</span>
                      <span>·</span>
                      <span>{formatDuration(r.duration)}</span>
                      {r.maxSmashKmh > 0 ? (
                        <>
                          <span>·</span>
                          <span className="inline-flex items-center gap-0.5 text-[var(--danger-400)]">
                            <Zap className="h-2.5 w-2.5" />
                            {r.maxSmashKmh}
                          </span>
                        </>
                      ) : null}
                      <span className="ml-auto text-[var(--text-faint)]">
                        {formatTime(r.matchT0)}
                      </span>
                    </div>
                  </div>
                  <ChevronDown
                    className={cn(
                      "h-3 w-3 shrink-0 text-[var(--text-muted)] transition-transform",
                      open && "rotate-180 text-[var(--cyan-500)]",
                    )}
                  />
                </button>

                {open ? (
                  <div className="border-t border-[var(--border-subtle)] px-1.5 pb-1.5 pt-0.5">
                    <div className="max-h-32 space-y-px overflow-y-auto">
                      {r.shots.map((s) => {
                        const selected = activeShotId === s.id;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => onSelectShot(r.id, s)}
                            className={cn(
                              "flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-left",
                              selected
                                ? "bg-[var(--surface-1)] ring-1 ring-[var(--brand)]"
                                : "hover:bg-[var(--surface-1)]",
                            )}
                          >
                            <span className="w-3.5 font-mono text-[9.5px] tabular-nums text-[var(--text-muted)]">
                              {s.index}
                            </span>
                            <span
                              className={cn(
                                "h-1.5 w-1.5 rounded-full",
                                s.player === "A" ? "bg-[var(--player-a)]" : "bg-[var(--player-b)]",
                              )}
                            />
                            <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-strong)]">
                              {s.type}
                            </span>
                            {s.speedKmh >= 100 ? (
                              <span className="font-mono text-[9.5px] tabular-nums text-[var(--cyan-500)]">
                                {s.speedKmh}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function SetChip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium",
        active
          ? "bg-[var(--brand-subtle)] text-[var(--cyan-500)]"
          : "text-[var(--text-muted)] hover:text-[var(--text-strong)]",
      )}
    >
      {label}
      {count != null ? (
        <span className="font-mono text-[9.5px] opacity-70">{count}</span>
      ) : null}
    </button>
  );
}
