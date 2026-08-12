import type { Frame, MatchData, Rally, Shot } from "./types";
import { frameAt } from "./generate";

export type PlayheadPhase = "pre" | "rally" | "gap" | "post";

export type PlayheadLocation = {
  matchT: number;
  phase: PlayheadPhase;
  rally: Rally | null;
  /** Local time within the rally when phase is rally; duration when gap after that rally */
  localT: number;
  inGap: boolean;
  set: number | null;
};

/**
 * Single absolute match clock → rally/gap placement.
 * Gaps between rallies are real idle time on the match clock.
 */
export function locatePlayhead(match: MatchData, matchT: number): PlayheadLocation {
  const rallies = match.rallies;
  const clamped = Math.max(0, Math.min(match.totalDuration, matchT));

  if (rallies.length === 0) {
    return {
      matchT: clamped,
      phase: "pre",
      rally: null,
      localT: 0,
      inGap: true,
      set: null,
    };
  }

  const first = rallies[0]!;
  if (clamped < first.matchT0) {
    return {
      matchT: clamped,
      phase: "pre",
      rally: first,
      localT: 0,
      inGap: true,
      set: first.set,
    };
  }

  // Last rally whose matchT0 <= clamped
  let lo = 0;
  let hi = rallies.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (rallies[mid]!.matchT0 <= clamped) lo = mid;
    else hi = mid - 1;
  }
  const rally = rallies[lo]!;
  const end = rally.matchT0 + rally.duration;

  if (clamped <= end) {
    return {
      matchT: clamped,
      phase: "rally",
      rally,
      localT: Math.max(0, Math.min(rally.duration, clamped - rally.matchT0)),
      inGap: false,
      set: rally.set,
    };
  }

  const next = rallies[lo + 1];
  if (!next) {
    return {
      matchT: clamped,
      phase: "post",
      rally,
      localT: rally.duration,
      inGap: true,
      set: rally.set,
    };
  }

  return {
    matchT: clamped,
    phase: "gap",
    rally,
    localT: rally.duration,
    inGap: true,
    set: rally.set,
  };
}

export function frameForPlayhead(loc: PlayheadLocation): Frame {
  if (!loc.rally) {
    return {
      t: 0,
      a: { x: 0, y: 4, z: 0 },
      b: { x: 0, y: -4, z: 0 },
      shuttle: { x: 0, y: 0, z: 1 },
      shotIndex: 1,
    };
  }
  return frameAt(loc.rally, loc.localT);
}

export function shotAt(rally: Rally, localT: number): Shot | null {
  return (
    rally.shots.find((s) => localT >= s.t0 && localT <= s.t1) ??
    rally.shots.find((s, i, arr) => {
      const next = arr[i + 1];
      return localT >= s.t0 && (!next || localT < next.t0);
    }) ??
    null
  );
}

/** Absolute match time for a shot inside a rally. */
export function shotMatchT(rally: Rally, shot: Shot): number {
  return rally.matchT0 + shot.t0;
}

/**
 * Scope window for transport/timeline: absolute [t0, t1) on the match clock.
 */
export function scopeWindow(
  match: MatchData,
  scope: { level: "match" } | { level: "set"; set: number } | { level: "rally"; rallyId: string },
): { t0: number; t1: number; label: string } {
  if (scope.level === "match") {
    return { t0: 0, t1: match.totalDuration, label: "Full match" };
  }
  if (scope.level === "set") {
    const bound = match.setBounds.find((s) => s.set === scope.set) ?? match.setBounds[0]!;
    return {
      t0: bound.t0,
      t1: bound.t1,
      label: `Game ${bound.set}`,
    };
  }
  const rally =
    match.rallies.find((r) => r.id === scope.rallyId) ?? match.rallies[0]!;
  return {
    t0: rally.matchT0,
    t1: rally.matchT0 + rally.duration,
    label: `Rally ${rally.n} · G${rally.set}`,
  };
}

export function clampMatchT(match: MatchData, matchT: number, scopeCap?: number): number {
  const cap = scopeCap ?? match.totalDuration;
  return Math.max(0, Math.min(cap, matchT));
}

/** Advance absolute clock; returns next matchT and whether play should stop. */
export function advanceMatchT(
  match: MatchData,
  matchT: number,
  dt: number,
  cap: number,
): { matchT: number; stop: boolean } {
  const next = matchT + dt;
  if (next >= cap) {
    return { matchT: Math.max(0, cap - 0.001), stop: true };
  }
  return { matchT: next, stop: false };
}

/** YouTube seek time from absolute match clock. */
export function broadcastTime(match: MatchData, matchT: number): number {
  return Math.max(0, matchT + (match.meta.broadcastOffset ?? 0));
}
