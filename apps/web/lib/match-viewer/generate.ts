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

/** Stable seed from match id so each catalog id gets a distinct but fixed demo. */
export function seedFromId(id: string): number {
  let h = 0x20260812;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 0x5bd1e995);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

const FPS = 16;
const COURT_HALF_L = 6.7;
const COURT_HALF_W = 2.59;

const TIMING = {
  preMatch: 180,
  gapMin: 28,
  gapSpan: 42,
  longGapChance: 0.08,
  longGapMin: 90,
  longGapSpan: 50,
  afterRally: 2.5,
  setIntervalMin: 240,
  setIntervalSpan: 180,
  postMatch: 120,
} as const;

/** Demo-only sample broadcast when the standalone demo route omits a video id. */
export const DEMO_YOUTUBE_ID = "6NJU8Kwv0Xg";

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

function surname(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] || name;
}

type EndKind =
  | { kind: "winner"; shot: ShotType; label: string }
  | { kind: "error"; forced: boolean; shot: ShotType; label: string }
  | { kind: "ace"; label: string };

type RallySpec = {
  shots: number;
  end: EndKind;
  winner: PlayerId;
  tags: RallyTag[];
  smashSpeeds?: number[];
  style: "baseline" | "net" | "mixed" | "power";
};

const SEED_SPECS: RallySpec[] = [
  {
    shots: 4,
    end: { kind: "error", forced: false, shot: "Net", label: "Net error" },
    winner: "B",
    tags: ["short", "unforced", "net-play"],
    style: "net",
  },
  {
    shots: 7,
    end: { kind: "winner", shot: "Smash", label: "Smash winner" },
    winner: "A",
    tags: ["fast-smash", "winner"],
    style: "power",
    smashSpeeds: [304],
  },
  {
    shots: 14,
    end: { kind: "winner", shot: "Drop", label: "Drop winner" },
    winner: "A",
    tags: ["long-rally", "net-play", "winner", "high-intensity"],
    style: "mixed",
  },
  {
    shots: 9,
    end: { kind: "winner", shot: "Drive", label: "Drive winner" },
    winner: "B",
    tags: ["winner", "high-intensity"],
    style: "mixed",
    smashSpeeds: [311],
  },
  {
    shots: 18,
    end: { kind: "winner", shot: "Smash", label: "Smash winner" },
    winner: "A",
    tags: ["long-rally", "fast-smash", "winner", "high-intensity"],
    style: "power",
    smashSpeeds: [318, 322, 328],
  },
  {
    shots: 6,
    end: { kind: "winner", shot: "Net kill", label: "Net kill" },
    winner: "B",
    tags: ["net-play", "winner", "short"],
    style: "net",
  },
  {
    shots: 15,
    end: { kind: "winner", shot: "Smash", label: "Smash winner" },
    winner: "A",
    tags: ["long-rally", "fast-smash", "winner"],
    style: "power",
    smashSpeeds: [308, 316],
  },
  {
    shots: 8,
    end: { kind: "error", forced: false, shot: "Clear", label: "Unforced error" },
    winner: "B",
    tags: ["unforced"],
    style: "baseline",
    smashSpeeds: [301],
  },
  {
    shots: 5,
    end: { kind: "winner", shot: "Smash", label: "Smash winner" },
    winner: "A",
    tags: ["fast-smash", "winner", "short"],
    style: "power",
    smashSpeeds: [324],
  },
  {
    shots: 11,
    end: { kind: "error", forced: true, shot: "Lift", label: "Forced error" },
    winner: "B",
    tags: ["high-intensity", "winner"],
    style: "mixed",
    smashSpeeds: [299],
  },
  {
    shots: 22,
    end: { kind: "winner", shot: "Smash", label: "Smash winner" },
    winner: "A",
    tags: ["long-rally", "fast-smash", "high-intensity", "winner"],
    style: "power",
    smashSpeeds: [312, 330, 336],
  },
  {
    shots: 3,
    end: { kind: "ace", label: "Service ace" },
    winner: "B",
    tags: ["short", "winner"],
    style: "baseline",
  },
  {
    shots: 10,
    end: { kind: "error", forced: false, shot: "Net", label: "Net error" },
    winner: "A",
    tags: ["net-play", "unforced"],
    style: "net",
  },
  {
    shots: 16,
    end: { kind: "winner", shot: "Drop", label: "Drop winner" },
    winner: "B",
    tags: ["long-rally", "net-play", "winner", "high-intensity"],
    style: "mixed",
    smashSpeeds: [295],
  },
  {
    shots: 12,
    end: { kind: "winner", shot: "Clear", label: "Clear winner" },
    winner: "A",
    tags: ["winner"],
    style: "baseline",
  },
  {
    shots: 6,
    end: { kind: "winner", shot: "Drive", label: "Drive winner" },
    winner: "B",
    tags: ["winner", "short"],
    style: "mixed",
  },
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

const END_POOL: EndKind[] = [
  { kind: "winner", shot: "Smash", label: "Smash winner" },
  { kind: "winner", shot: "Drop", label: "Drop winner" },
  { kind: "winner", shot: "Drive", label: "Drive winner" },
  { kind: "error", forced: false, shot: "Net", label: "Net error" },
  { kind: "error", forced: false, shot: "Clear", label: "Unforced error" },
  { kind: "error", forced: true, shot: "Lift", label: "Forced error" },
  { kind: "winner", shot: "Net kill", label: "Net kill" },
  { kind: "winner", shot: "Clear", label: "Clear winner" },
  { kind: "ace", label: "Service ace" },
];

function tagsFor(spec: { shots: number; end: EndKind; style: RallySpec["style"] }): RallyTag[] {
  const tags: RallyTag[] = [];
  if (spec.shots >= 14) tags.push("long-rally");
  if (spec.shots <= 5) tags.push("short");
  if (spec.end.kind === "winner" && spec.end.shot === "Smash") tags.push("fast-smash");
  if (spec.style === "power") tags.push("fast-smash");
  if (spec.style === "net" || (spec.end.kind === "winner" && spec.end.shot === "Net kill")) {
    tags.push("net-play");
  }
  if (spec.end.kind === "error" && !spec.end.forced && spec.end.shot === "Net") {
    tags.push("net-play");
  }
  if (spec.end.kind === "winner" || spec.end.kind === "ace") tags.push("winner");
  if (spec.end.kind === "error" && spec.end.forced) tags.push("winner");
  if (spec.end.kind === "error" && !spec.end.forced) tags.push("unforced");
  if (spec.shots >= 12 || spec.style === "power") tags.push("high-intensity");
  return [...new Set(tags)];
}

function pickShotType(
  i: number,
  style: RallySpec["style"],
  isLast: boolean,
  end: EndKind,
): ShotType {
  if (i === 0) return "Serve";
  if (isLast) {
    if (end.kind === "ace") return "Serve";
    if (end.kind === "winner") return end.shot;
    return end.shot;
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
  nameA: string,
  nameB: string,
): string {
  const who = player === "A" ? surname(nameA) : surname(nameB);
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
  const end = END_POOL[Math.floor(rand() * END_POOL.length)]!;
  const tags = tagsFor({ shots, end, style });
  const smashSpeeds =
    tags.includes("fast-smash")
      ? Array.from({ length: Math.max(1, Math.floor(shots / 7)) }, () =>
          Math.round(285 + rand() * 50),
        )
      : undefined;
  return { shots, end, winner, tags, smashSpeeds, style };
}

/**
 * Ensure last hitter matches end semantics:
 * - winner / ace → last contact is winner
 * - error → last contact is loser (the one who erred)
 * Ace forces short rally ending on serve by winner.
 */
function alignSpec(spec: RallySpec): RallySpec {
  let shots = spec.shots;
  if (spec.end.kind === "ace") {
    shots = Math.max(1, Math.min(3, shots));
    // Odd shot count starting from server (index 0) means server hits last
    // We set server = winner later; force odd count so last = server = winner
    if (shots % 2 === 0) shots += 1;
  } else if (spec.end.kind === "winner") {
    // last player (0=A if server A) must equal winner — adjusted via server choice
  } else {
    // error: last player is the loser
  }
  return { ...spec, shots };
}

function buildRally(
  n: number,
  set: number,
  spec: RallySpec,
  matchT0: number,
  scoreA: number,
  scoreB: number,
  server: PlayerId,
  nameA: string,
  nameB: string,
  rand: () => number,
): Rally {
  const aligned = alignSpec(spec);
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

  const other = (p: PlayerId): PlayerId => (p === "A" ? "B" : "A");

  // Last hitter from end semantics; work backwards so shot 0 is always server
  const lastPlayer: PlayerId =
    aligned.end.kind === "error" ? other(aligned.winner) : aligned.winner;

  for (let i = 0; i < aligned.shots; i++) {
    const isLast = i === aligned.shots - 1;
    // Player for shot i: alternate from server; force last to lastPlayer
    let player: PlayerId =
      i % 2 === 0 ? server : other(server);
    if (isLast) {
      player = lastPlayer;
    } else if (aligned.shots > 1) {
      // Ensure path can reach lastPlayer: if parity wrong for penultimate, leave as alternate
      const expectedLast = (aligned.shots - 1) % 2 === 0 ? server : other(server);
      if (expectedLast !== lastPlayer && i === aligned.shots - 2) {
        // penultimate is opposite of last
        player = other(lastPlayer);
      }
    }

    const type = pickShotType(i, aligned.style, isLast, aligned.end);
    const side: "FH" | "BH" = rand() > 0.45 ? "FH" : "BH";

    let speed = 80 + rand() * 40;
    if (type === "Smash") {
      const assigned = aligned.smashSpeeds?.[smashIdx];
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

  // Fix last shot player if alternate loop still wrong
  if (shotPlan.length > 0) {
    shotPlan[shotPlan.length - 1]!.player = lastPlayer;
    if (aligned.end.kind === "ace" || (aligned.end.kind === "winner" && aligned.end.shot)) {
      if (aligned.end.kind === "ace") shotPlan[shotPlan.length - 1]!.type = "Serve";
      else shotPlan[shotPlan.length - 1]!.type = aligned.end.shot;
    } else if (aligned.end.kind === "error") {
      shotPlan[shotPlan.length - 1]!.type = aligned.end.shot;
    }
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
      analysis: analysisFor(sp.type, Math.round(sp.speed), sp.player, sp.side, nameA, nameB),
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
    (aligned.shots / 22) * 0.5 +
      (maxSmashKmh > 0 ? (maxSmashKmh - 280) / 80 : 0) * 0.35 +
      (aligned.tags.includes("high-intensity") ? 0.2 : 0),
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
    duration: +t.toFixed(2),
    winner: aligned.winner,
    endReason: aligned.end.label,
    tags: aligned.tags,
    shots,
    frames,
    maxSmashKmh,
    intensity,
  };
}

export type GenerateMatchOptions = {
  id?: string;
  title?: string;
  event?: string;
  playerA?: { name: string; country?: string };
  playerB?: { name: string; country?: string };
  /**
   * `undefined` → standalone demo default video.
   * `null` → no broadcast (catalog match without source).
   * string → that video id.
   */
  youtubeId?: string | null;
  broadcastLabel?: string;
  /** When set, stop after a player wins this many games (default 2 = best-of-3). */
  setsToWin?: number;
};

/**
 * Full best-of-3 match on a ~2h wall-clock with synthetic 3D only on rallies.
 * Between-point gaps live on the absolute match clock for honest scrubbing.
 */
export function generateMatch(opts: GenerateMatchOptions = {}): MatchData {
  const id = opts.id ?? "demo-axelsen-momota-full";
  const rand = mulberry32(seedFromId(id));
  const nameA = opts.playerA?.name ?? "Viktor Axelsen";
  const nameB = opts.playerB?.name ?? "Kento Momota";
  const setsToWin = opts.setsToWin ?? 2;

  const rallies: Rally[] = [];
  const setBounds: MatchData["setBounds"] = [];

  let n = 0;
  let matchT = TIMING.preMatch;
  let setsWonA = 0;
  let setsWonB = 0;
  let setNum = 0;
  // First rally of match: A serves
  let server: PlayerId = "A";

  while (setsWonA < setsToWin && setsWonB < setsToWin && setNum < 5) {
    setNum += 1;
    let scoreA = 0;
    let scoreB = 0;
    const setT0 = matchT;
    const target = 21;

    while (
      (scoreA < target && scoreB < target) ||
      (scoreA >= target && scoreB >= target && Math.abs(scoreA - scoreB) < 2)
    ) {
      if (scoreA >= 30 || scoreB >= 30) break;

      const longBreak = rand() < TIMING.longGapChance;
      const gap = longBreak
        ? TIMING.longGapMin + rand() * TIMING.longGapSpan
        : TIMING.gapMin + rand() * TIMING.gapSpan;
      matchT += gap;

      const base = SEED_SPECS[n % SEED_SPECS.length]!;
      const spec = n < SEED_SPECS.length ? { ...base } : mutateSpec(base, rand);
      n += 1;
      const rally = buildRally(
        n,
        setNum,
        spec,
        matchT,
        scoreA,
        scoreB,
        server,
        nameA,
        nameB,
        rand,
      );
      rallies.push(rally);
      matchT += rally.duration + TIMING.afterRally;

      if (spec.winner === "A") scoreA += 1;
      else scoreB += 1;

      // Side-out: winner of the point serves next
      server = spec.winner;

      if (n > 250) break;
    }

    setBounds.push({
      set: setNum,
      t0: setT0,
      t1: matchT,
      score: `${scoreA}–${scoreB}`,
    });

    if (scoreA > scoreB) setsWonA += 1;
    else setsWonB += 1;

    if (setsWonA < setsToWin && setsWonB < setsToWin) {
      const interval = TIMING.setIntervalMin + rand() * TIMING.setIntervalSpan;
      matchT += interval;
    }
  }

  matchT += TIMING.postMatch;

  const finalScore = setBounds.map((s) => s.score).join(" · ");

  // youtubeId: undefined → demo default; null → none; string → use
  const youtubeId =
    opts.youtubeId === undefined
      ? DEMO_YOUTUBE_ID
      : opts.youtubeId;

  return {
    meta: {
      id,
      title: opts.title ?? "Axelsen vs Momota",
      event: opts.event ?? "All England Open · Final · Demo match",
      playerA: {
        name: nameA,
        country: opts.playerA?.country ?? "DEN",
      },
      playerB: {
        name: nameB,
        country: opts.playerB?.country ?? "JPN",
      },
      finalScore,
      sets: setBounds.length,
      fps: FPS,
      youtubeId,
      broadcastLabel:
        opts.broadcastLabel ??
        (youtubeId ? "Demo analysis · synthetic trajectory" : "Demo 3D · no broadcast linked"),
      broadcastOffset: 0,
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
