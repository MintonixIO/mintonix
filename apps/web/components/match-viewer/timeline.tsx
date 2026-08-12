"use client";

import type { MatchData, Rally, Shot } from "@/lib/match-viewer/types";
import { cn, formatTime } from "@/lib/utils";

/** Drill-down scope for the match navigator + transport scrubber. */
export type TimelineScope =
  | { level: "match" }
  | { level: "set"; set: number }
  | { level: "rally"; rallyId: string };

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
 * Classic banded timeline look with hierarchical select:
 * Match → Game → Rally. Transport (blue bar) scrubs the active section.
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

  const clockLabel = () => {
    if (scope.level === "match") {
      return (
        <>
          {formatTime(matchT)}
          <span className="text-[var(--text-faint)]"> / </span>
          {formatTime(totalDuration)}
        </>
      );
    }
    if (scope.level === "set" && setBound) {
      const local = Math.max(0, matchT - setBound.t0);
      return (
        <>
          {formatTime(local)}
          <span className="text-[var(--text-faint)]"> / </span>
          {formatTime(setBound.t1 - setBound.t0)}
        </>
      );
    }
    const local = Math.max(0, Math.min(scopedRally!.duration, matchT - scopedRally!.matchT0));
    return (
      <>
        {formatTime(local)}
        <span className="text-[var(--text-faint)]"> / </span>
        {formatTime(scopedRally!.duration)}
      </>
    );
  };

  const tickStep = winSpan > 5400 ? 15 : winSpan > 1800 ? 10 : winSpan > 300 ? 5 : 1;
  const ticks: number[] = [];
  if (scope.level !== "rally") {
    for (let m = tickStep; m * 60 < winSpan; m += tickStep) ticks.push(winT0 + m * 60);
  }

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
          {clockLabel()}
        </span>
      </div>

      <div className="relative h-3.5">
        {scope.level === "match"
          ? setBounds.map((s) => {
              const left = (s.t0 / totalDuration) * 100;
              const width = ((s.t1 - s.t0) / totalDuration) * 100;
              return (
                <button
                  key={s.set}
                  type="button"
                  onClick={() => {
                    onScopeChange({ level: "set", set: s.set });
                    const first = rallies.find((r) => r.set === s.set);
                    if (first) onSelectRally(first.id);
                  }}
                  className="absolute top-0 truncate text-left font-mono text-[10px] text-[var(--text-muted)] hover:text-[var(--cyan-500)]"
                  style={{ left: `${left}%`, width: `${Math.max(width, 4)}%` }}
                  title={`Expand game ${s.set} · ${s.score}`}
                >
                  G{s.set} {s.score}
                </button>
              );
            })
          : null}

        {scope.level === "set" && setBound
          ? setRallies.map((r) => {
              const left = ((r.matchT0 - setBound.t0) / winSpan) * 100;
              const width = (r.duration / winSpan) * 100;
              const active = r.id === activeRallyId;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    onSelectRally(r.id);
                    onScopeChange({ level: "rally", rallyId: r.id });
                  }}
                  className={cn(
                    "absolute top-0 truncate text-left font-mono text-[10px]",
                    active
                      ? "text-[var(--cyan-500)]"
                      : "text-[var(--text-muted)] hover:text-[var(--cyan-500)]",
                  )}
                  style={{ left: `${left}%`, width: `${Math.max(width, 1.2)}%` }}
                  title={`Expand R${r.n}`}
                >
                  {setRallies.length <= 24 || active ? `R${r.n}` : ""}
                </button>
              );
            })
          : null}

        {scope.level === "rally" && scopedRally
          ? scopedRally.shots.map((s) => {
              const left = (s.t0 / scopedRally.duration) * 100;
              const width = ((s.t1 - s.t0) / scopedRally.duration) * 100;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSelectShot?.(scopedRally.id, s)}
                  className="absolute top-0 truncate text-left font-mono text-[10px] text-[var(--text-muted)] hover:text-[var(--cyan-500)]"
                  style={{ left: `${left}%`, width: `${Math.max(width, 3)}%` }}
                  title={`${s.index}. ${s.type}`}
                >
                  {scopedRally.shots.length <= 12 ? s.type.slice(0, 2) : ""}
                </button>
              );
            })
          : null}
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
              const left = (s.t0 / totalDuration) * 100;
              const width = ((s.t1 - s.t0) / totalDuration) * 100;
              return (
                <button
                  key={s.set}
                  type="button"
                  role="option"
                  aria-selected={activeRally.set === s.set}
                  title={`Game ${s.set} · ${s.score}`}
                  onClick={() => {
                    onScopeChange({ level: "set", set: s.set });
                    const first = rallies.find((r) => r.set === s.set);
                    if (first) onSelectRally(first.id);
                  }}
                  className="absolute inset-y-0 hover:bg-[rgba(54,147,255,0.06)]"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    background:
                      i % 2 === 0 ? "rgba(54,147,255,0.04)" : "rgba(80,222,255,0.03)",
                  }}
                />
              );
            })
          : null}

        {scope.level === "set" ? (
          <div className="absolute inset-0 bg-[rgba(54,147,255,0.04)]" />
        ) : null}

        {scope.level === "rally" ? (
          <div className="absolute inset-0 bg-[rgba(80,222,255,0.03)]" />
        ) : null}

        {ticks.map((t) => (
          <div
            key={t}
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-[var(--border-subtle)]"
            style={{ left: `${((t - winT0) / winSpan) * 100}%` }}
          />
        ))}

        {scope.level === "match"
          ? rallies.map((rally) => {
              const left = (rally.matchT0 / totalDuration) * 100;
              const width = (rally.duration / totalDuration) * 100;
              const active = rally.id === activeRallyId;
              return (
                <button
                  key={rally.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  title={`R${rally.n} · G${rally.set} · ${rally.endReason}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectRally(rally.id);
                    onScopeChange({ level: "set", set: rally.set });
                  }}
                  className={cn(
                    "absolute top-1.5 bottom-1.5 rounded-[1px]",
                    active && "z-10 ring-1 ring-[var(--cyan-500)]",
                  )}
                  style={{
                    left: `${left}%`,
                    width: `${Math.max(width, 0.12)}%`,
                    background: tagColor(rally.tags, rally.intensity),
                  }}
                />
              );
            })
          : null}

        {scope.level === "set" && setBound
          ? setRallies.map((rally) => {
              const left = ((rally.matchT0 - setBound.t0) / winSpan) * 100;
              const width = (rally.duration / winSpan) * 100;
              const active = rally.id === activeRallyId;
              return (
                <button
                  key={rally.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  title={`R${rally.n} · ${rally.scoreA}–${rally.scoreB} · ${rally.endReason}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectRally(rally.id);
                    onScopeChange({ level: "rally", rallyId: rally.id });
                  }}
                  className={cn(
                    "absolute top-1.5 bottom-1.5 rounded-[1px]",
                    active && "z-10 ring-1 ring-[var(--cyan-500)]",
                  )}
                  style={{
                    left: `${left}%`,
                    width: `${Math.max(width, 0.35)}%`,
                    background: tagColor(rally.tags, rally.intensity),
                  }}
                />
              );
            })
          : null}

        {scope.level === "rally" && scopedRally
          ? scopedRally.shots.map((s) => {
              const left = (s.t0 / scopedRally.duration) * 100;
              const width = ((s.t1 - s.t0) / scopedRally.duration) * 100;
              const local = matchT - scopedRally.matchT0;
              const active = local >= s.t0 && local <= s.t1 + 0.05;
              const smash = s.type === "Smash";
              return (
                <button
                  key={s.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  title={`${s.index}. ${s.type} · ${s.speedKmh} km/h`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectShot?.(scopedRally.id, s);
                  }}
                  className={cn(
                    "absolute top-1.5 bottom-1.5 rounded-[1px]",
                    active && "z-10 ring-1 ring-[var(--cyan-500)]",
                  )}
                  style={{
                    left: `${left}%`,
                    width: `${Math.max(width, 0.8)}%`,
                    background: smash
                      ? "rgba(244, 81, 92, 0.75)"
                      : "rgba(80, 222, 255, 0.45)",
                  }}
                />
              );
            })
          : null}

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
