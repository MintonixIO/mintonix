import type {
  Frame,
  MatchData,
  PlayerId,
  Rally,
  RallyTag,
  Shot,
  ShotType,
  Vec3,
} from "./types";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FPS = 16; // leaner frame density for long matches
const COURT_HALF_L = 6.7;
const COURT_HALF_W = 2.59;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function shuttleArc(from: Vec3, to: Vec3, t: number, peakBoost = 1): Vec3 {
  const p = easeInOut(clamp(t, 0, 1));
  const base = lerp3(from, to, p);
  const peak =
    Math.max(from.z, to.z) +
    peakBoost * (0.6 + Math.hypot(to.x - from.x, to.y - from.y) * 0.12);
  const z = base.z + Math.sin(p * Math.PI) * (peak - base.z);
  return { x: base.x, y: base.y, z: Math.max(0.05, z) };
}

type RallySpec = {
  shots: number;
  end: string;
  winner: PlayerId;
  tags: RallyTag[];
  smashSpeeds?: number[];
  style: "baseline" | "net" | "mixed" | "power";
};

const SEED_SPECS: RallySpec[] = [
  { shots: 4, end: "Net error", winner: "B", tags: ["short", "unforced", "net-play"], style: "net" },
  { shots: 7, end: "Smash winner", winner: "A", tags: ["fast-smash", "winner"], style: "power", smashSpeeds: [304] },
  { shots: 14, end: "Drop winner", winner: "A", tags: ["long-rally", "net-play", "winner", "high-intensity"], style: "mixed" },
  { shots: 9, end: "Drive winner", winner: "B", tags: ["winner", "high-intensity"], style: "mixed", smashSpeeds: [311] },
  {
    shots: 18,
    end: "Smash winner",
    winner: "A",
    tags: ["long-rally", "fast-smash", "winner", "high-intensity"],
    style: "power",
    smashSpeeds: [318, 322, 328],
  },
  { shots: 6, end: "Net kill", winner: "B", tags: ["net-play", "winner", "short"], style: "net" },
  {
    shots: 15,
    end: "Smash winner",
    winner: "A",
    tags: ["long-rally", "fast-smash", "winner"],
    style: "power",
    smashSpeeds: [308, 316],
  },
  { shots: 8, end: "Unforced error", winner: "B", tags: ["unforced"], style: "baseline", smashSpeeds: [301] },
  { shots: 5, end: "Smash winner", winner: "A", tags: ["fast-smash", "winner", "short"], style: "power", smashSpeeds: [324] },
  { shots: 11, end: "Forced error", winner: "B", tags: ["high-intensity", "winner"], style: "mixed", smashSpeeds: [299] },
  {
    shots: 22,
    end: "Smash winner",
    winner: "A",
    tags: ["long-rally", "fast-smash", "high-intensity", "winner"],
    style: "power",
    smashSpeeds: [312, 330, 336],
  },
  { shots: 3, end: "Service ace", winner: "B", tags: ["short", "winner"], style: "baseline" },
  { shots: 10, end: "Net error", winner: "A", tags: ["net-play", "unforced"], style: "net" },
  {
    shots: 16,
    end: "Drop winner",
    winner: "B",
    tags: ["long-rally", "net-play", "winner", "high-intensity"],
    style: "mixed",
    smashSpeeds: [295],
  },
  { shots: 12, end: "Clear winner", winner: "A", tags: ["winner"], style: "baseline" },
  { shots: 6, end: "Drive winner", winner: "B", tags: ["winner", "short"], style: "mixed" },
];

const SHOT_CYCLE: ShotType[] = [
  "Serve",
  "Clear",
  "Drop",
  "Lift",
  "Smash",
  "Block",
  "Drive",
  "Net",
  "Lift",
  "Clear",
  "Drop",
  "Smash",
];

function pickShotType(
  i: number,
  style: RallySpec["style"],
  isLast: boolean,
  end: string,
): ShotType {
  if (i === 0) return "Serve";
  if (isLast) {
    if (end.includes("Smash")) return "Smash";
    if (end.includes("Drop")) return "Drop";
    if (end.includes("Drive")) return "Drive";
    if (end.includes("Net kill")) return "Net kill";
    if (end.includes("Net")) return "Net";
    if (end.includes("Service")) return "Serve";
    if (end.includes("Clear")) return "Clear";
    return "Clear";
  }
  if (style === "net") {
    const netTypes: ShotType[] = ["Net", "Net", "Lift", "Drop", "Net kill", "Block"];
    return netTypes[i % netTypes.length]!;
  }
  if (style === "power") return SHOT_CYCLE[i % SHOT_CYCLE.length]!;
  if (style === "baseline") {
    const base: ShotType[] = ["Clear", "Clear", "Drop", "Lift", "Smash", "Block"];
    return base[i % base.length]!;
  }
  return SHOT_CYCLE[(i + 2) % SHOT_CYCLE.length]!;
}

function analysisFor(
  type: ShotType,
  speed: number,
  player: PlayerId,
  side: "FH" | "BH",
): string {
  const who = player === "A" ? "Axelsen" : "Momota";
  const hand = side === "FH" ? "forehand" : "backhand";
  if (type === "Smash") {
    return `${who} fires a ${hand} smash at ${speed} km/h — steep angle into the deep corner.`;
  }
  if (type === "Drop") {
    return `${who} softens the pace with a tight ${hand} drop, pulling the opponent forward.`;
  }
  if (type === "Clear") {
    return `${who} buys time with a high clear, resetting mid-court spacing.`;
  }
  if (type === "Drive") {
    return `Flat ${hand} drive keeps the rally compressed — low trajectory over the tape.`;
  }
  if (type === "Net" || type === "Net kill") {
    return `Tight net exchange. ${who} attacks the tape with a ${type === "Net kill" ? "kill" : "tumbling net shot"}.`;
  }
  if (type === "Lift") {
    return `${who} lifts deep, inviting the overhead. Recovery step starts immediately.`;
  }
  if (type === "Block") {
    return `Soft block absorbs the smash — shuttle dies just past the net.`;
  }
  if (type === "Serve") {
    return `${who} opens with a ${side === "FH" ? "flick" : "short"} serve.`;
  }
  return `${who} plays a ${String(type).toLowerCase()}.`;
}

function mutateSpec(base: RallySpec, rand: () => number): RallySpec {
  const winner: PlayerId = rand() > 0.48 ? "A" : "B";
  const shots = clamp(Math.round(base.shots + (rand() - 0.5) * 6), 3, 24);
  const styles = ["baseline", "net", "mixed", "power"] as const;
  const style = styles[Math.floor(rand() * styles.length)]!;
  const ends = [
    "Smash winner",
    "Drop winner",
    "Drive winner",
    "Net error",
    "Unforced error",
    "Forced error",
    "Net kill",
    "Clear winner",
  ];
  const end = ends[Math.floor(rand() * ends.length)]!;
  const tags: RallyTag[] = [];
  if (shots >= 14) tags.push("long-rally");
  if (shots <= 5) tags.push("short");
  if (end.includes("Smash") || style === "power") tags.push("fast-smash");
  if (style === "net" || end.includes("Net")) tags.push("net-play");
  if (end.includes("winner") || end.includes("kill") || end.includes("ace")) tags.push("winner");
  if (end.includes("Unforced") || end.includes("error")) tags.push("unforced");
  if (shots >= 12 || style === "power") tags.push("high-intensity");
  const smashSpeeds =
    tags.includes("fast-smash")
      ? Array.from({ length: Math.max(1, Math.floor(shots / 7)) }, () =>
          Math.round(285 + rand() * 50),
        )
      : undefined;
  return { shots, end, winner, tags, smashSpeeds, style };
}

function buildRally(
  n: number,
  set: number,
  spec: RallySpec,
  matchT0: number,
  videoT0: number,
  scoreA: number,
  scoreB: number,
  rand: () => number,
): Rally {
  const playerStart: Record<PlayerId, Vec3> = {
    A: { x: 0.2, y: 4.2, z: 0 },
    B: { x: -0.15, y: -4.0, z: 0 },
  };

  let posA = { ...playerStart.A };
  let posB = { ...playerStart.B };
  let shuttle: Vec3 = { x: posA.x, y: posA.y + 0.3, z: 1.1 };

  const shots: Shot[] = [];
  let t = 0;
  let smashIdx = 0;

  type Plan = {
    type: ShotType;
    player: PlayerId;
    side: "FH" | "BH";
    duration: number;
    speed: number;
    from: Vec3;
    to: Vec3;
    contactZ: number;
  };
  const shotPlan: Plan[] = [];

  for (let i = 0; i < spec.shots; i++) {
    const player: PlayerId = i % 2 === 0 ? "A" : "B";
    const isLast = i === spec.shots - 1;
    const type = pickShotType(i, spec.style, isLast, spec.end);
    const side: "FH" | "BH" = rand() > 0.45 ? "FH" : "BH";

    let speed = 80 + rand() * 40;
    if (type === "Smash") {
      const assigned = spec.smashSpeeds?.[smashIdx];
      smashIdx += 1;
      speed = assigned ?? 280 + rand() * 40;
    } else if (type === "Drive") speed = 160 + rand() * 50;
    else if (type === "Clear" || type === "Lift") speed = 120 + rand() * 40;
    else if (type === "Drop" || type === "Net" || type === "Block") speed = 40 + rand() * 35;
    else if (type === "Serve") speed = 70 + rand() * 80;

    const hitter = player === "A" ? posA : posB;

    let tx = (rand() - 0.5) * COURT_HALF_W * 1.7;
    let ty: number;
    if (type === "Net" || type === "Net kill" || type === "Block" || type === "Drop") {
      ty = player === "A" ? -0.6 - rand() * 1.2 : 0.6 + rand() * 1.2;
      tx = clamp(tx, -COURT_HALF_W * 0.9, COURT_HALF_W * 0.9);
    } else if (type === "Smash") {
      ty = player === "A" ? -3.5 - rand() * 2.2 : 3.5 + rand() * 2.2;
      tx = (rand() > 0.5 ? 1 : -1) * (1.2 + rand() * 1.1);
    } else if (type === "Clear" || type === "Lift") {
      ty = player === "A" ? -5.2 - rand() * 1.0 : 5.2 + rand() * 1.0;
    } else {
      ty = player === "A" ? -2.5 - rand() * 2.5 : 2.5 + rand() * 2.5;
    }
    ty = clamp(ty, -COURT_HALF_L + 0.3, COURT_HALF_L - 0.3);
    tx = clamp(tx, -COURT_HALF_W + 0.15, COURT_HALF_W - 0.15);

    const contactZ =
      type === "Smash"
        ? 2.4 + rand() * 0.4
        : type === "Serve"
          ? 1.0 + rand() * 0.3
          : type === "Net" || type === "Net kill"
            ? 1.15 + rand() * 0.2
            : 1.5 + rand() * 0.6;

    const from: Vec3 = {
      x: hitter.x + (rand() - 0.5) * 0.2,
      y: hitter.y + (player === "A" ? -0.15 : 0.15),
      z: contactZ,
    };
    const to: Vec3 = { x: tx, y: ty, z: type === "Smash" ? 0.08 : 0.12 };

    if (player === "A") {
      posA = { x: from.x, y: from.y + 0.2, z: 0 };
      posB = { x: lerp(posB.x, tx, 0.55), y: lerp(posB.y, ty, 0.55), z: 0 };
    } else {
      posB = { x: from.x, y: from.y - 0.2, z: 0 };
      posA = { x: lerp(posA.x, tx, 0.55), y: lerp(posA.y, ty, 0.55), z: 0 };
    }

    const baseDur =
      type === "Smash"
        ? 0.55 + rand() * 0.15
        : type === "Drive" || type === "Net" || type === "Block"
          ? 0.45 + rand() * 0.2
          : type === "Clear" || type === "Lift"
            ? 1.1 + rand() * 0.35
            : 0.7 + rand() * 0.25;

    shotPlan.push({ type, player, side, duration: baseDur, speed, from, to, contactZ });
  }

  const frames: Frame[] = [];
  posA = { ...playerStart.A };
  posB = { ...playerStart.B };

  for (let i = 0; i < shotPlan.length; i++) {
    const sp = shotPlan[i]!;
    const t0 = t;
    const t1 = t + sp.duration;

    shots.push({
      id: `r${n}-s${i + 1}`,
      index: i + 1,
      type: sp.type,
      player: sp.player,
      side: sp.side,
      t0,
      t1,
      speedKmh: Math.round(sp.speed),
      contactHeight: +sp.contactZ.toFixed(2),
      target: { x: +sp.to.x.toFixed(2), y: +sp.to.y.toFixed(2) },
      analysis: analysisFor(sp.type, Math.round(sp.speed), sp.player, sp.side),
    });

    const a0 = { ...posA };
    const b0 = { ...posB };
    const a1 =
      sp.player === "A"
        ? { x: sp.from.x, y: sp.from.y + 0.25, z: 0 }
        : { x: lerp(posA.x, sp.to.x, 0.65), y: lerp(posA.y, sp.to.y, 0.65), z: 0 };
    const b1 =
      sp.player === "B"
        ? { x: sp.from.x, y: sp.from.y - 0.25, z: 0 }
        : { x: lerp(posB.x, sp.to.x, 0.65), y: lerp(posB.y, sp.to.y, 0.65), z: 0 };

    const steps = Math.max(2, Math.round(sp.duration * FPS));
    const peakBoost =
      sp.type === "Clear" || sp.type === "Lift" ? 1.8 : sp.type === "Smash" ? 0.35 : 1.0;

    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      const ft = t0 + u * sp.duration;
      if (i > 0 && s === 0) continue;

      frames.push({
        t: +ft.toFixed(3),
        a: lerp3(a0, a1, easeInOut(u)),
        b: lerp3(b0, b1, easeInOut(u)),
        shuttle: shuttleArc(sp.from, sp.to, u, peakBoost),
        shotIndex: i + 1,
      });
    }

    posA = a1;
    posB = b1;
    shuttle = sp.to;
    t = t1;
  }

  if (frames.length === 0) {
    frames.push({ t: 0, a: posA, b: posB, shuttle, shotIndex: 1 });
  }

  const maxSmashKmh = shots
    .filter((s) => s.type === "Smash")
    .reduce((m, s) => Math.max(m, s.speedKmh), 0);
  const intensity = clamp(
    (spec.shots / 22) * 0.5 +
      (maxSmashKmh > 0 ? (maxSmashKmh - 280) / 80 : 0) * 0.35 +
      (spec.tags.includes("high-intensity") ? 0.2 : 0),
    0.12,
    1,
  );

  return {
    id: `rally-${n}`,
    n,
    set,
    scoreA,
    scoreB,
    matchT0,
    videoT0,
    duration: +t.toFixed(2),
    winner: spec.winner,
    endReason: spec.end,
    tags: spec.tags,
    shots,
    frames,
    maxSmashKmh,
    intensity,
  };
}

/**
 * Full 3-game match ~2h wall-clock. Dense 3D only on rallies;
 * between-point / between-game gaps live on the match clock so a long
 * broadcast scrubs cleanly without empty frames.
 */
export type GenerateMatchOptions = {
  id?: string;
  title?: string;
  event?: string;
  playerA?: { name: string; country?: string };
  playerB?: { name: string; country?: string };
  youtubeId?: string;
  broadcastLabel?: string;
};

export function generateMatch(opts: GenerateMatchOptions = {}): MatchData {
  const rand = mulberry32(20260812);
  const rallies: Rally[] = [];
  const setBounds: MatchData["setBounds"] = [];

  let n = 0;
  // Pre-match walk-on + warm-up on the broadcast clock
  let matchT = 180;
  let videoT = 180;

  for (let set = 1; set <= 3; set++) {
    let scoreA = 0;
    let scoreB = 0;
    const setT0 = matchT;
    // All three games to 21 — full-length final
    const target = 21;

    while (
      (scoreA < target && scoreB < target) ||
      (scoreA >= target && scoreB >= target && Math.abs(scoreA - scoreB) < 2)
    ) {
      if (scoreA >= 30 || scoreB >= 30) break;

      // Between points: recovery, towel, score announcement (~25–70s)
      // Occasional longer reviews / medical (~90–140s)
      const longBreak = rand() < 0.08;
      const gap = longBreak ? 90 + rand() * 50 : 28 + rand() * 42;
      matchT += gap;
      videoT += gap;

      const base = SEED_SPECS[n % SEED_SPECS.length]!;
      const spec = n < SEED_SPECS.length ? base : mutateSpec(base, rand);
      n += 1;
      const rally = buildRally(n, set, spec, matchT, videoT, scoreA, scoreB, rand);
      rallies.push(rally);
      matchT += rally.duration + 2.5;
      videoT += rally.duration + 2.5;

      if (spec.winner === "A") scoreA += 1;
      else scoreB += 1;

      if (n > 250) break;
    }

    setBounds.push({
      set,
      t0: setT0,
      t1: matchT,
      score: `${scoreA}–${scoreB}`,
    });

    // Interval / change ends (~4–7 min on TV)
    if (set < 3) {
      matchT += 240 + rand() * 180;
      videoT += 240 + rand() * 180;
    }
  }

  // Medal ceremony / post-match
  matchT += 120;
  videoT += 120;

  const finalScore = setBounds.map((s) => s.score).join(" · ");

  return {
    meta: {
      id: opts.id ?? "demo-axelsen-momota-full",
      title: opts.title ?? "Axelsen vs Momota",
      event: opts.event ?? "All England Open · Final · Full match",
      playerA: {
        name: opts.playerA?.name ?? "Viktor Axelsen",
        country: opts.playerA?.country ?? "DEN",
      },
      playerB: {
        name: opts.playerB?.name ?? "Kento Momota",
        country: opts.playerB?.country ?? "JPN",
      },
      finalScore,
      sets: 3,
      fps: FPS,
      youtubeId: opts.youtubeId ?? "6NJU8Kwv0Xg",
      broadcastLabel: opts.broadcastLabel ?? "BWF TV · demo analysis",
    },
    rallies,
    totalDuration: matchT,
    setBounds,
  };
}

export function frameAt(rally: Rally, t: number): Frame {
  const frames = rally.frames;
  if (frames.length === 0) {
    return {
      t: 0,
      a: { x: 0, y: 4, z: 0 },
      b: { x: 0, y: -4, z: 0 },
      shuttle: { x: 0, y: 0, z: 1 },
      shotIndex: 1,
    };
  }
  const clamped = clamp(t, 0, frames[frames.length - 1]!.t);
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid]!.t < clamped) lo = mid + 1;
    else hi = mid;
  }
  const i = lo;
  const cur = frames[i]!;
  const prev = frames[Math.max(0, i - 1)]!;
  if (i === 0 || Math.abs(cur.t - clamped) <= Math.abs(prev.t - clamped)) return cur;
  return prev;
}

export function courtToPct(v: Vec3): { left: number; top: number; z: number } {
  const left = ((v.x + COURT_HALF_W) / (COURT_HALF_W * 2)) * 100;
  const top = ((v.y + COURT_HALF_L) / (COURT_HALF_L * 2)) * 100;
  return { left: clamp(left, 2, 98), top: clamp(top, 2, 98), z: v.z };
}

export const COURT = { halfL: COURT_HALF_L, halfW: COURT_HALF_W, fps: FPS };
