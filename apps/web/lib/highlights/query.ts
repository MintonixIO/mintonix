import type { Moment, ReasonKey } from "./moments";

export type Filter = {
  types: string[];
  speedMin?: number;
  rallyMin?: number;
  outcome?: string;
  kind?: string;
  ctx: string[];
  free: string[];
};

export type EmphWeights = {
  rec: number;
  ctx: number;
  qua: number;
  top: number;
};

export type EmphKey = "balanced" | "records" | "bigpoints" | "cinematic";

export const EMPH = [
  {
    v: "balanced" as const,
    label: "Balanced",
    w: { rec: 1, ctx: 1, qua: 1, top: 1 },
  },
  {
    v: "records" as const,
    label: "Records",
    w: { rec: 2.4, ctx: 0.7, qua: 0.7, top: 1 },
  },
  {
    v: "bigpoints" as const,
    label: "Big points",
    w: { rec: 0.7, ctx: 2.4, qua: 0.7, top: 1 },
  },
  {
    v: "cinematic" as const,
    label: "Cinematic",
    w: { rec: 0.7, ctx: 0.7, qua: 2.4, top: 1 },
  },
] as const satisfies ReadonlyArray<{
  v: EmphKey;
  label: string;
  w: EmphWeights;
}>;

function filter(partial: Partial<Filter> = {}): Filter {
  return {
    types: partial.types ?? [],
    speedMin: partial.speedMin,
    rallyMin: partial.rallyMin,
    outcome: partial.outcome,
    kind: partial.kind,
    ctx: partial.ctx ?? [],
    free: partial.free ?? [],
  };
}

export const QUICK: { id: string; label: string; f: Filter }[] = [
  { id: "c1", label: "Smash 300+", f: filter({ types: ["Smash"], speedMin: 300 }) },
  { id: "c2", label: "Match points", f: filter({ ctx: ["match point"] }) },
  { id: "c3", label: "Rally 12+", f: filter({ rallyMin: 12 }) },
  { id: "c4", label: "Net kills", f: filter({ types: ["Net"] }) },
  { id: "c5", label: "Comebacks", f: filter({ ctx: ["comeback"] }) },
];

const EMPH_PREFER: Partial<Record<EmphKey, ReasonKey>> = {
  records: "rec",
  bigpoints: "ctx",
  cinematic: "qua",
};

export function parseQuery(qraw: string): Filter {
  const f = filter({});
  let q = ` ${qraw.toLowerCase()} `;
  (
    [
      ["match point", "match point"],
      ["game point", "match point"],
      ["decider", "decider"],
      ["comeback", "comeback"],
    ] as const
  ).forEach(([k, tag]) => {
    if (q.includes(k)) {
      if (!f.ctx.includes(tag)) f.ctx.push(tag);
      q = q.split(k).join(" ");
    }
  });
  if (/long rall/.test(q)) {
    f.rallyMin = 12;
    q = q.replace(/long/g, " ");
  }
  const sp = q.match(/(\d{3})\s*(\+|km)?/);
  if (sp && +sp[1] >= 150 && +sp[1] <= 500) {
    f.speedMin = +sp[1];
    q = q.split(sp[0]).join(" ");
  }
  const rl = q.match(/(\d{1,2})\s*\+?\s*(shots?|\+)/);
  if (rl) {
    f.rallyMin = +rl[1];
    q = q.split(rl[0]).join(" ");
  }
  ["smash", "drop", "clear", "net", "drive", "lift"].forEach((t) => {
    if (new RegExp(`\\b${t}`).test(q)) {
      f.types.push(t.charAt(0).toUpperCase() + t.slice(1));
      q = q.replace(new RegExp(`${t}\\w*`, "g"), " ");
    }
  });
  if (/winner|\bwon\b|\bwin\b/.test(q)) {
    f.outcome = "winner";
    q = q.replace(/winners?|won|win/g, " ");
  }
  if (/\brall/.test(q)) {
    f.kind = "rally";
    q = q.replace(/rall\w*/g, " ");
  }
  const stop = new Set([
    "the",
    "a",
    "in",
    "by",
    "me",
    "my",
    "of",
    "over",
    "with",
    "at",
    "and",
    "to",
    "from",
    "vs",
    "shot",
    "shots",
    "that",
    "was",
    "when",
  ]);
  q.split(/[^a-zà-ÿ-]+/).forEach((w) => {
    if (w.length > 2 && !stop.has(w)) f.free.push(w);
  });
  return f;
}

export function passes(m: Moment, f: Filter): boolean {
  if (f.types.length && !f.types.includes(m.type)) return false;
  if (f.speedMin && !(m.speed && m.speed >= f.speedMin)) return false;
  if (f.rallyMin && m.rallyLen < f.rallyMin) return false;
  if (f.outcome && m.outcome !== f.outcome) return false;
  if (f.kind === "rally" && m.kind !== "rally") return false;
  if (f.ctx.length && !f.ctx.every((t) => m.ctx.includes(t))) return false;
  if (f.free.length) {
    const hay = `${m.title} ${m.match} ${m.round} ${m.type}`.toLowerCase();
    if (!f.free.every((w) => hay.includes(w))) return false;
  }
  return true;
}

export function scoreMoment(m: Moment, w: EmphWeights): number {
  return (
    m.s.rec * w.rec + m.s.ctx * w.ctx + m.s.qua * w.qua + m.s.top * w.top
  );
}

export function pickReason(
  m: Moment,
  emph: EmphKey,
): Moment["reasons"][number] {
  const prefer = EMPH_PREFER[emph];
  return (prefer && m.reasons.find((r) => r.k === prefer)) || m.reasons[0];
}

export function emphWeights(emph: EmphKey): EmphWeights {
  return EMPH.find((e) => e.v === emph)!.w;
}
