"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { AnalysisPanel } from "./analysis-panel";
import { BroadcastView } from "./broadcast-view";
import { CourtViewport } from "./court-viewport";
import { RallyBrowser } from "./rally-browser";
import { MatchTimeline } from "./timeline";
import { Transport, type TransportMarker } from "./transport";
import { generateMatch, type GenerateMatchOptions } from "@/lib/match-viewer/generate";
import {
  advanceMatchT,
  broadcastTime,
  frameForPlayhead,
  locatePlayhead,
  scopeWindow,
  shotAt,
  shotMatchT,
} from "@/lib/match-viewer/playhead";
import type {
  MatchData,
  MomentFilter,
  PlayerPov,
  Shot,
  TimelineScope,
  ViewMode,
} from "@/lib/match-viewer/types";
import { VIEW_MODES } from "@/lib/match-viewer/types";
import { cn } from "@/lib/utils";

/** Default corner: low angle from near-side corner */
const CORNER = { az: -48, el: 16, zoom: 1.1 };

/** UI playhead publish rate while playing (3D still feels smooth enough). */
const UI_HZ = 20;
const UI_DT = 1 / UI_HZ;

export type MatchViewerProps = {
  /** Catalog / demo match id */
  matchId?: string;
  /**
   * `undefined` → generator demo default video.
   * `null` → no broadcast (catalog without source).
   * string → that video id.
   */
  youtubeId?: string | null;
  title?: string;
  event?: string;
  playerAName?: string;
  playerBName?: string;
  backHref?: string;
  backLabel?: string;
  /** When true, show demo analysis labeling — synthetic rallies / 3D. */
  demoAnalysis?: boolean;
};

function surname(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] || name;
}

export function MatchViewer({
  matchId,
  youtubeId,
  title,
  event,
  playerAName,
  playerBName,
  backHref = "/bwf/matches",
  backLabel = "Back",
  demoAnalysis = true,
}: MatchViewerProps) {
  const [MATCH] = useState<MatchData>(() => {
    const opts: GenerateMatchOptions = {
      id: matchId,
      title,
      event,
      // Pass through null explicitly so catalog never invents a video
      youtubeId,
      playerA: playerAName ? { name: playerAName } : undefined,
      playerB: playerBName ? { name: playerBName } : undefined,
      broadcastLabel: demoAnalysis
        ? "Demo analysis · synthetic trajectory"
        : "BWF broadcast",
    };
    return generateMatch(opts);
  });

  const nameA = MATCH.meta.playerA.name;
  const nameB = MATCH.meta.playerB.name;
  const shortA = surname(nameA);
  const shortB = surname(nameB);

  const defaultMatchT = useMemo(() => {
    const preferred =
      MATCH.rallies.find((r) => r.tags.includes("fast-smash") && r.set === 2) ??
      MATCH.rallies[Math.floor(MATCH.rallies.length / 2)] ??
      MATCH.rallies[0];
    return preferred?.matchT0 ?? 0;
  }, [MATCH]);

  const [matchT, setMatchT] = useState(defaultMatchT);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [momentFilter, setMomentFilter] = useState<MomentFilter>("all");
  const [gameFilter, setGameFilter] = useState<number | "all">("all");
  const [mobileTab, setMobileTab] = useState<"browse" | "analysis">("browse");
  const [scope, setScope] = useState<TimelineScope>({ level: "match" });

  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    MATCH.meta.youtubeId ? "broadcast" : "corner",
  );
  const [playerPov, setPlayerPov] = useState<PlayerPov>("A");
  const [az, setAz] = useState(CORNER.az);
  const [el, setEl] = useState(CORNER.el);
  const [zoom, setZoom] = useState(CORNER.zoom);

  const matchTRef = useRef(matchT);
  matchTRef.current = matchT;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const loc = useMemo(() => locatePlayhead(MATCH, matchT), [MATCH, matchT]);
  const rally = loc.rally ?? MATCH.rallies[0]!;
  const localT = loc.localT;
  const frame = useMemo(() => frameForPlayhead(loc), [loc]);
  const shot = useMemo(
    () => (loc.inGap || !loc.rally ? null : shotAt(loc.rally, localT)),
    [loc, localT],
  );

  const filtered = useMemo(() => {
    let list = MATCH.rallies;
    if (gameFilter !== "all") list = list.filter((r) => r.set === gameFilter);
    if (momentFilter !== "all") list = list.filter((r) => r.tags.includes(momentFilter));
    return list;
  }, [MATCH.rallies, momentFilter, gameFilter]);

  const trail = useMemo(() => {
    if (!loc.rally || loc.inGap) return [];
    const frames = loc.rally.frames;
    if (frames.length === 0) return [];
    let idx = 0;
    for (let i = 0; i < frames.length; i++) {
      if (frames[i]!.t <= localT) idx = i;
    }
    return frames.slice(Math.max(0, idx - 11), idx).map((f) => f.shuttle);
  }, [loc, localT]);

  const win = useMemo(() => scopeWindow(MATCH, scope), [MATCH, scope]);
  const scopeDuration = Math.max(0.001, win.t1 - win.t0);
  const scopeT = Math.max(0, Math.min(scopeDuration, matchT - win.t0));
  const scopeLabel = win.label;

  const transportMarkers = useMemo((): TransportMarker[] => {
    if (scope.level === "rally") {
      const r = MATCH.rallies.find((x) => x.id === scope.rallyId) ?? rally;
      return r.shots.map((s) => ({
        id: s.id,
        t: s.t0,
        kind: s.type === "Smash" ? "smash" : "shot",
        label: s.type,
      }));
    }
    if (scope.level === "set") {
      return MATCH.rallies
        .filter((r) => r.set === scope.set)
        .map((r) => ({
          id: r.id,
          t: r.matchT0 - win.t0,
          kind: r.tags.includes("fast-smash") ? "smash" : "rally",
          label: `R${r.n}`,
        }));
    }
    return MATCH.setBounds.map((s) => ({
      id: `set-${s.set}`,
      t: s.t0,
      kind: "rally" as const,
      label: `G${s.set}`,
    }));
  }, [scope, rally, win.t0, MATCH]);

  // Absolute match-clock playback — gaps advance naturally
  useEffect(() => {
    if (!playing) return;

    let raf = 0;
    let lastNow: number | null = null;
    let acc = 0;

    const tick = (now: number) => {
      if (lastNow == null) lastNow = now;
      const wallDt = (now - lastNow) / 1000;
      lastNow = now;
      acc += wallDt * speedRef.current;

      if (acc >= UI_DT) {
        const sc = scopeRef.current;
        const window = scopeWindow(MATCH, sc);
        const step = advanceMatchT(MATCH, matchTRef.current, acc, window.t1);
        acc = 0;
        matchTRef.current = step.matchT;
        setMatchT(step.matchT);
        if (step.stop) {
          setPlaying(false);
          return;
        }
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, MATCH]);

  const seekMatchT = useCallback(
    (mt: number, pause = true) => {
      const next = Math.max(0, Math.min(MATCH.totalDuration, mt));
      matchTRef.current = next;
      setMatchT(next);
      if (pause) setPlaying(false);
    },
    [MATCH.totalDuration],
  );

  const selectRally = useCallback(
    (id: string) => {
      const r = MATCH.rallies.find((x) => x.id === id);
      if (!r) return;
      seekMatchT(r.matchT0);
    },
    [MATCH.rallies, seekMatchT],
  );

  const selectShot = useCallback(
    (rId: string, s: Shot) => {
      const r = MATCH.rallies.find((x) => x.id === rId);
      if (!r) return;
      seekMatchT(shotMatchT(r, s));
      setScope({ level: "rally", rallyId: rId });
      setMobileTab("analysis");
    },
    [MATCH.rallies, seekMatchT],
  );

  const seekScope = useCallback(
    (localScopeT: number) => {
      seekMatchT(win.t0 + localScopeT);
    },
    [seekMatchT, win.t0],
  );

  const handleScopeChange = useCallback(
    (next: TimelineScope) => {
      setScope(next);
      if (next.level === "set") {
        const bound = MATCH.setBounds.find((s) => s.set === next.set);
        if (bound && (matchTRef.current < bound.t0 || matchTRef.current >= bound.t1)) {
          const first = MATCH.rallies.find((r) => r.set === next.set);
          if (first) seekMatchT(first.matchT0);
        }
      }
      if (next.level === "rally") {
        const r = MATCH.rallies.find((x) => x.id === next.rallyId);
        if (r) {
          const cur = locatePlayhead(MATCH, matchTRef.current);
          if (cur.rally?.id !== r.id) seekMatchT(r.matchT0);
        }
      }
    },
    [MATCH, seekMatchT],
  );

  const resetCorner = useCallback(() => {
    setAz(CORNER.az);
    setEl(CORNER.el);
    setZoom(CORNER.zoom);
  }, []);

  const switchView = (mode: ViewMode) => {
    setViewMode(mode);
    if (mode === "corner") resetCorner();
  };

  const currentShotLabel = shot
    ? `${shot.player === "A" ? shortA : shortB} · ${shot.type}${shot.speedKmh >= 200 ? ` · ${shot.speedKmh} km/h` : ""}`
    : undefined;

  const rallyIndex = MATCH.rallies.findIndex((r) => r.id === rally.id);

  const goPrevShot = () => {
    if (!loc.rally) return;
    const shots = loc.rally.shots;
    if (shot) {
      const idx = shots.findIndex((s) => s.id === shot.id);
      if (idx > 0) {
        seekMatchT(shotMatchT(loc.rally, shots[idx - 1]!));
        return;
      }
    }
    if (rallyIndex > 0 && scope.level !== "rally") {
      const prev = MATCH.rallies[rallyIndex - 1]!;
      if (scope.level === "set" && prev.set !== scope.set) {
        setPlaying(false);
        return;
      }
      const last = prev.shots[prev.shots.length - 1];
      if (last) seekMatchT(shotMatchT(prev, last));
    } else {
      setPlaying(false);
    }
  };

  const goNextShot = () => {
    if (!loc.rally) return;
    const shots = loc.rally.shots;
    if (!shot) {
      const s = shots[0];
      if (s) seekMatchT(shotMatchT(loc.rally, s));
      return;
    }
    const idx = shots.findIndex((s) => s.id === shot.id);
    if (idx < shots.length - 1) {
      seekMatchT(shotMatchT(loc.rally, shots[idx + 1]!));
      return;
    }
    if (rallyIndex < MATCH.rallies.length - 1 && scope.level !== "rally") {
      const next = MATCH.rallies[rallyIndex + 1]!;
      if (scope.level === "set" && next.set !== scope.set) {
        setPlaying(false);
        return;
      }
      seekMatchT(next.matchT0);
    } else {
      setPlaying(false);
    }
  };

  const goPrevRally = () => {
    if (rallyIndex <= 0) return;
    const prev = MATCH.rallies[rallyIndex - 1]!;
    if (scope.level === "set" && prev.set !== scope.set) return;
    seekMatchT(prev.matchT0);
    if (scope.level === "rally") setScope({ level: "rally", rallyId: prev.id });
  };

  const goNextRally = () => {
    if (rallyIndex >= MATCH.rallies.length - 1) return;
    const next = MATCH.rallies[rallyIndex + 1]!;
    if (scope.level === "set" && next.set !== scope.set) return;
    seekMatchT(next.matchT0);
    if (scope.level === "rally") setScope({ level: "rally", rallyId: next.id });
  };

  useEffect(() => {
    if (momentFilter === "all" && gameFilter === "all") return;
    if (!filtered.some((r) => r.id === rally.id) && filtered[0]) {
      selectRally(filtered[0].id);
    }
  }, [momentFilter, gameFilter, filtered, rally.id, selectRally]);

  const matchHours = MATCH.totalDuration / 3600;
  const videoTime = broadcastTime(MATCH, matchT);
  const hasBroadcast = Boolean(MATCH.meta.youtubeId);

  const timelineProps = {
    rallies: MATCH.rallies,
    setBounds: MATCH.setBounds,
    scope,
    activeRallyId: rally.id,
    matchT,
    totalDuration: MATCH.totalDuration,
    onScopeChange: handleScopeChange,
    onSelectRally: (id: string) => {
      selectRally(id);
    },
    onSelectShot: selectShot,
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--bg-base)] text-[var(--text-primary)]">
      <header className="z-20 flex min-h-[44px] shrink-0 items-center gap-1.5 border-b border-[var(--border-subtle)] bg-[rgba(10,16,32,0.96)] px-2 py-1 backdrop-blur-md sm:min-h-[48px] sm:gap-3 sm:px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={backHref}
            aria-label={backLabel}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:text-[var(--text-strong)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </Link>
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--brand-subtle)] font-display text-[12px] font-bold text-[var(--brand)]">
            Mx
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="truncate font-display text-[13px] font-semibold text-[var(--text-strong)] sm:text-[14px]">
                {MATCH.meta.title}
              </div>
              {demoAnalysis ? (
                <span className="hidden shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide text-[var(--text-muted)] sm:inline">
                  Demo 3D
                </span>
              ) : null}
            </div>
            <div className="hidden truncate font-mono text-[10px] text-[var(--text-muted)] sm:block">
              {MATCH.meta.broadcastLabel} · {MATCH.rallies.length} rallies ·{" "}
              {matchHours.toFixed(1)}h
            </div>
          </div>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-0.5 rounded-full border border-[var(--border)] bg-[var(--surface-1)] p-0.5">
          {VIEW_MODES.map((m) => {
            const disabled = m.id === "broadcast" && !hasBroadcast;
            return (
              <button
                key={m.id}
                type="button"
                title={disabled ? "No broadcast linked for this match" : m.hint}
                disabled={disabled}
                onClick={() => !disabled && switchView(m.id)}
                className={cn(
                  "rounded-full px-1.5 py-1 text-[10.5px] font-medium sm:px-2.5 sm:py-1.5 sm:text-[12px]",
                  disabled && "cursor-not-allowed opacity-40",
                  viewMode === m.id
                    ? "bg-[var(--cyan-500)] text-[#04141b] shadow-[0_0_12px_rgba(80,222,255,0.3)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-strong)]",
                )}
              >
                {m.label}
              </button>
            );
          })}
        </div>

        {viewMode === "player" ? (
          <div className="hidden items-center gap-0.5 rounded-full border border-[var(--border)] bg-[var(--surface-1)] p-0.5 sm:flex">
            {(["A", "B"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPlayerPov(p)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11.5px]",
                  playerPov === p
                    ? "bg-[var(--surface-3)] text-[var(--text-strong)]"
                    : "text-[var(--text-muted)]",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    p === "A" ? "bg-[var(--player-a)]" : "bg-[var(--player-b)]",
                  )}
                />
                {p === "A" ? shortA : shortB}
              </button>
            ))}
          </div>
        ) : null}

        <div
          className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 sm:gap-2 sm:px-2.5"
          title="Demo scoreline — not official catalog score"
        >
          <span className="hidden font-mono text-[9px] uppercase tracking-wide text-[var(--text-faint)] sm:inline">
            Demo
          </span>
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--player-a)]" />
          <span className="font-mono text-[12px] tabular-nums text-[var(--text-strong)]">
            {rally.scoreA}–{rally.scoreB}
          </span>
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--player-b)]" />
          <span className="font-mono text-[10px] text-[var(--text-faint)]">G{rally.set}</span>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_min(38dvh,280px)] lg:grid-cols-[minmax(0,1fr)_280px] lg:grid-rows-1 lg:gap-2.5 lg:p-2.5">
        <div className="flex min-h-0 min-w-0 flex-col lg:gap-2">
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[linear-gradient(160deg,#0c1426,#070d1a)] lg:rounded-xl lg:border lg:border-[var(--border)] lg:shadow-[var(--shadow-lg),0_0_0_1px_rgba(80,222,255,0.06)]">
            <div className="relative min-h-0 flex-1">
              {/* Keep YT mounted under 3D to avoid destroy/recreate races */}
              {hasBroadcast || viewMode === "broadcast" ? (
                <div
                  className={cn(
                    "absolute inset-0",
                    viewMode === "broadcast" ? "z-[1]" : "z-0",
                  )}
                >
                  <BroadcastView
                    youtubeId={MATCH.meta.youtubeId}
                    videoTime={videoTime}
                    playing={playing}
                    speed={speed}
                    active={viewMode === "broadcast"}
                  />
                </div>
              ) : null}

              {viewMode !== "broadcast" ? (
                <div className="absolute inset-0 z-[2]">
                  <CourtViewport
                    frame={frame}
                    trail={trail}
                    mode={viewMode}
                    playerPov={playerPov}
                    az={az}
                    el={el}
                    zoom={zoom}
                    currentShotLabel={currentShotLabel}
                    playerAName={nameA}
                    playerBName={nameB}
                    overlayBadge="Demo"
                    onOrbit={(nextAz, nextEl) => {
                      setAz(nextAz);
                      setEl(nextEl);
                    }}
                    onZoom={(deltaY) =>
                      setZoom((z) => Math.max(0.55, Math.min(1.9, z - deltaY * 0.001)))
                    }
                    onResetOrbit={resetCorner}
                  />
                </div>
              ) : null}
            </div>
            <Transport
              scope={scope}
              scopeLabel={scopeLabel}
              scopeDuration={scopeDuration}
              scopeT={scopeT}
              shot={shot}
              playing={playing}
              speed={speed}
              markers={transportMarkers}
              onToggle={() => setPlaying((v) => !v)}
              onSeek={seekScope}
              onPrevShot={goPrevShot}
              onNextShot={goNextShot}
              onPrevRally={goPrevRally}
              onNextRally={goNextRally}
              onSpeed={setSpeed}
            />
          </section>

          {/* One timeline instance (compact on small screens via CSS height only in component) */}
          <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--surface-1)] px-2 py-1.5 lg:rounded-xl lg:border lg:border-[var(--border)] lg:px-2.5 lg:py-2 lg:shadow-[var(--shadow-edge)]">
            <MatchTimeline {...timelineProps} />
          </div>
        </div>

        <aside className="flex min-h-0 flex-col overflow-hidden border-t border-[var(--border)] bg-[var(--bg-base)] lg:border-0 lg:bg-transparent">
          {viewMode === "player" ? (
            <div className="flex shrink-0 gap-1 border-b border-[var(--border-subtle)] p-1 sm:hidden">
              {(["A", "B"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPlayerPov(p)}
                  className={cn(
                    "flex-1 rounded-md py-1 text-[11.5px]",
                    playerPov === p
                      ? "bg-[var(--brand-subtle)] text-[var(--cyan-500)]"
                      : "text-[var(--text-muted)]",
                  )}
                >
                  {p === "A" ? shortA : shortB}
                </button>
              ))}
            </div>
          ) : null}

          <div className="flex shrink-0 gap-1 border-b border-[var(--border-subtle)] p-1 lg:hidden">
            {(
              [
                ["browse", "Moments"],
                ["analysis", "Analysis"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setMobileTab(id)}
                className={cn(
                  "flex-1 rounded-md py-1.5 text-[12px] font-medium",
                  mobileTab === id
                    ? "bg-[var(--surface-2)] text-[var(--text-strong)]"
                    : "text-[var(--text-muted)]",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            <div
              className={cn(
                "h-full",
                mobileTab === "browse" ? "block" : "hidden lg:block",
              )}
            >
              <RallyBrowser
                rallies={MATCH.rallies}
                filtered={filtered}
                activeRallyId={rally.id}
                activeShotId={shot?.id ?? null}
                filter={momentFilter}
                setFilter={gameFilter}
                onFilter={setMomentFilter}
                onSetFilter={setGameFilter}
                onSelectRally={(id) => {
                  selectRally(id);
                  setScope({ level: "rally", rallyId: id });
                }}
                onSelectShot={selectShot}
                sets={MATCH.meta.sets}
              />
            </div>
            <div
              className={cn(
                "h-full",
                mobileTab === "analysis" ? "block" : "hidden lg:block",
              )}
            >
              <AnalysisPanel
                rally={rally}
                shot={shot}
                frame={frame}
                playerA={nameA}
                playerB={nameB}
              />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
