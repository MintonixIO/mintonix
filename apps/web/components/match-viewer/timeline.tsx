"use client";

import type { MatchData, Rally, Shot, TimelineScope } from "@/lib/match-viewer/types";
import { formatMatchClock } from "@/lib/match-viewer/format";
import { cn } from "@/lib/utils";

export type { TimelineScope };

type TimelineSegment = {
  id: string;
  t0: number;
  t1: number;
  color: string;
  title: string;
  active: boolean;
  onClick: () => void;
};

type TimelineProps = {
  rallies: Rally[];
  setBounds: MatchData["setBounds"];
  scope: TimelineScope;
  activeRallyId: string;
  matchT: number;
  totalDuration: number;
  onScopeChange: (scope: TimelineScope) => void;
  onSelectRally: (id: string) => void;
  onSelectShot?: (rallyId: string, shot: Shot) => void;
  compact?: boolean;
};

function tagColor(tags: string[], intensity: number): string {
  if (tags.includes("fast-smash")) return `rgba(244, 81, 92, ${0.5 + intensity * 0.4})`;
  if (tags.includes("long-rally")) return `rgba(54, 147, 255, ${0.45 + intensity * 0.4})`;
  if (tags.includes("net-play")) return `rgba(45, 212, 167, ${0.4 + intensity * 0.4})`;
  if (tags.includes("unforced")) return `rgba(251, 191, 36, ${0.4 + intensity * 0.35})`;
  return `rgba(80, 222, 255, ${0.28 + intensity * 0.4})`;
}

/**
 * Banded timeline with hierarchical select (Match → Game → Rally).
 * Renders one segment list for both label row and bar row.
 */
export function MatchTimeline({
  rallies,
  setBounds,
  scope,
  activeRallyId,
  matchT,
  totalDuration,
  onScopeChange,
  onSelectRally,
  onSelectShot,
  compact,
}: TimelineProps) {
  const activeRally = rallies.find((r) => r.id === activeRallyId) ?? rallies[0]!;

  const scopedRally =
    scope.level === "rally"
      ? (rallies.find((r) => r.id === scope.rallyId) ?? activeRally)
      : null;

  const setNum =
    scope.level === "set"
      ? scope.set
      : scope.level === "rally"
        ? scopedRally!.set
        : null;

  const setBound =
    setNum != null ? setBounds.find((s) => s.set === setNum) : undefined;

  const setRallies =
    setNum != null ? rallies.filter((r) => r.set === setNum) : [];

  const winT0 =
    scope.level === "match" ? 0 : scope.level === "set" ? setBound!.t0 : scopedRally!.matchT0;
  const winT1 =
    scope.level === "match"
      ? totalDuration
      : scope.level === "set"
        ? setBound!.t1
        : scopedRally!.matchT0 + scopedRally!.duration;
  const winSpan = Math.max(0.001, winT1 - winT0);
  const playheadPct = ((matchT - winT0) / winSpan) * 100;

  const title =
    scope.level === "match"
      ? "Match timeline"
      : scope.level === "set"
        ? `Game ${scope.set} timeline`
        : `Rally ${scopedRally!.n} timeline`;

  const localClock = Math.max(0, Math.min(winSpan, matchT - winT0));

  const tickStep = winSpan > 5400 ? 15 : winSpan > 1800 ? 10 : winSpan > 300 ? 5 : 1;
  const ticks: number[] = [];
  if (scope.level !== "rally") {
    for (let m = tickStep; m * 60 < winSpan; m += tickStep) ticks.push(winT0 + m * 60);
  }

  let labels: TimelineSegment[] = [];
  let segments: TimelineSegment[] = [];

  if (scope.level === "match") {
    labels = setBounds.map((s) => ({
      id: `label-set-${s.set}`,
      t0: s.t0,
      t1: s.t1,
      color: "transparent",
      title: `G${s.set} ${s.score}`,
      active: activeRally.set === s.set,
      onClick: () => {
        onScopeChange({ level: "set", set: s.set });
        const first = rallies.find((r) => r.set === s.set);
        if (first) onSelectRally(first.id);
      },
    }));
    segments = rallies.map((rally) => ({
      id: rally.id,
      t0: rally.matchT0,
      t1: rally.matchT0 + rally.duration,
      color: tagColor(rally.tags, rally.intensity),
      title: `R${rally.n} · G${rally.set} · ${rally.endReason}`,
      active: rally.id === activeRallyId,
      onClick: () => {
        onSelectRally(rally.id);
        onScopeChange({ level: "set", set: rally.set });
      },
    }));
  } else if (scope.level === "set" && setBound) {
    labels = setRallies.map((r) => ({
      id: `label-${r.id}`,
      t0: r.matchT0,
      t1: r.matchT0 + r.duration,
      color: "transparent",
      title: `R${r.n}`,
      active: r.id === activeRallyId,
      onClick: () => {
        onSelectRally(r.id);
        onScopeChange({ level: "rally", rallyId: r.id });
      },
    }));
    segments = setRallies.map((rally) => ({
      id: rally.id,
      t0: rally.matchT0,
      t1: rally.matchT0 + rally.duration,
      color: tagColor(rally.tags, rally.intensity),
      title: `R${rally.n} · ${rally.scoreA}–${rally.scoreB} · ${rally.endReason}`,
      active: rally.id === activeRallyId,
      onClick: () => {
        onSelectRally(rally.id);
        onScopeChange({ level: "rally", rallyId: rally.id });
      },
    }));
  } else if (scope.level === "rally" && scopedRally) {
    labels = scopedRally.shots.map((s) => ({
      id: `label-${s.id}`,
      t0: scopedRally.matchT0 + s.t0,
      t1: scopedRally.matchT0 + s.t1,
      color: "transparent",
      title: `${s.index}. ${s.type}`,
      active: false,
      onClick: () => onSelectShot?.(scopedRally.id, s),
    }));
    segments = scopedRally.shots.map((s) => {
      const local = matchT - scopedRally.matchT0;
      const active = local >= s.t0 && local <= s.t1 + 0.05;
      return {
        id: s.id,
        t0: scopedRally.matchT0 + s.t0,
        t1: scopedRally.matchT0 + s.t1,
        color:
          s.type === "Smash" ? "rgba(244, 81, 92, 0.75)" : "rgba(80, 222, 255, 0.45)",
        title: `${s.index}. ${s.type} · ${s.speedKmh} km/h`,
        active,
        onClick: () => onSelectShot?.(scopedRally.id, s),
      };
    });
  }

  const minLabelWidth = scope.level === "match" ? 4 : scope.level === "set" ? 1.2 : 3;
  const minSegWidth =
    scope.level === "match" ? 0.12 : scope.level === "set" ? 0.35 : 0.8;

  return (
    <div className={cn("space-y-1", compact && "space-y-0.5")}>
      <div className="flex items-center justify-between gap-2 px-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="mx-eyebrow">{title}</span>
          {scope.level !== "match" ? (
            <button
              type="button"
              onClick={() =>
                onScopeChange(
                  scope.level === "rally"
                    ? { level: "set", set: scopedRally!.set }
                    : { level: "match" },
                )
              }
              className="rounded px-1 py-0.5 font-mono text-[10px] text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--cyan-500)]"
            >
              ← back
            </button>
          ) : null}
        </div>
        <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
          {formatMatchClock(localClock)}
          <span className="text-[var(--text-faint)]"> / </span>
          {formatMatchClock(winSpan)}
        </span>
      </div>

      <div className="relative h-3.5">
        {labels.map((seg) => {
          const left = ((seg.t0 - winT0) / winSpan) * 100;
          const width = ((seg.t1 - seg.t0) / winSpan) * 100;
          const showText =
            scope.level === "match" ||
            (scope.level === "set" && (setRallies.length <= 24 || seg.active)) ||
            (scope.level === "rally" && (scopedRally?.shots.length ?? 0) <= 12);
          return (
            <button
              key={seg.id}
              type="button"
              onClick={seg.onClick}
              className={cn(
                "absolute top-0 truncate text-left font-mono text-[10px]",
                seg.active
                  ? "text-[var(--cyan-500)]"
                  : "text-[var(--text-muted)] hover:text-[var(--cyan-500)]",
              )}
              style={{ left: `${left}%`, width: `${Math.max(width, minLabelWidth)}%` }}
              title={seg.title}
            >
              {showText
                ? scope.level === "rally"
                  ? seg.title.split(" ")[1]?.slice(0, 2) ?? ""
                  : scope.level === "set"
                    ? seg.title
                    : seg.title
                : ""}
            </button>
          );
        })}
      </div>

      <div
        className={cn(
          "relative overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-sunken)]",
          compact ? "h-7" : "h-8",
        )}
        role="listbox"
        aria-label={title}
      >
        {scope.level === "match"
          ? setBounds.map((s, i) => {
              const left = ((s.t0 - winT0) / winSpan) * 100;
              const width = ((s.t1 - s.t0) / winSpan) * 100;
              return (
                <div
                  key={`bg-${s.set}`}
                  className="pointer-events-none absolute inset-y-0"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    background:
                      i % 2 === 0 ? "rgba(54,147,255,0.04)" : "rgba(80,222,255,0.03)",
                  }}
                />
              );
            })
          : (
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  scope.level === "set"
                    ? "rgba(54,147,255,0.04)"
                    : "rgba(80,222,255,0.03)",
              }}
            />
          )}

        {ticks.map((tick) => (
          <div
            key={tick}
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-[var(--border-subtle)]"
            style={{ left: `${((tick - winT0) / winSpan) * 100}%` }}
          />
        ))}

        {segments.map((seg) => {
          const left = ((seg.t0 - winT0) / winSpan) * 100;
          const width = ((seg.t1 - seg.t0) / winSpan) * 100;
          return (
            <button
              key={seg.id}
              type="button"
              role="option"
              aria-selected={seg.active}
              title={seg.title}
              onClick={(e) => {
                e.stopPropagation();
                seg.onClick();
              }}
              className={cn(
                "absolute top-1.5 bottom-1.5 rounded-[1px]",
                seg.active && "z-10 ring-1 ring-[var(--cyan-500)]",
              )}
              style={{
                left: `${left}%`,
                width: `${Math.max(width, minSegWidth)}%`,
                background: seg.color,
              }}
            />
          );
        })}

        <div
          className="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 bg-[var(--cyan-500)] shadow-[0_0_8px_rgba(80,222,255,0.7)]"
          style={{ left: `${Math.max(0, Math.min(100, playheadPct))}%` }}
        />
      </div>

      {!compact ? (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[var(--text-muted)]">
          <Legend color="rgba(244,81,92,0.75)" label="Smash" />
          <Legend color="rgba(54,147,255,0.75)" label="Long" />
          <Legend color="rgba(45,212,167,0.75)" label="Net" />
          <Legend color="rgba(251,191,36,0.7)" label="Error" />
          <span className="text-[var(--text-faint)]">
            {scope.level === "match"
              ? `${rallies.length} rallies · tap game or rally to zoom`
              : scope.level === "set"
                ? `${setRallies.length} rallies · tap to open · gaps = dead time`
                : `${scopedRally?.shots.length ?? 0} shots`}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-1.5 w-2 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}
