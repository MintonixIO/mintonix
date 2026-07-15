/* Court geometry in 1600×900 overlay space */

export const C_DEFAULT: [number, number][] = [
  [384, 459],
  [1216, 459],
  [1392, 819],
  [208, 819],
];

export const POLE: [number, number][] = [
  [288, 477],
  [1312, 477],
];

export const PBOX = {
  a: { x: 720, y: 540, w: 224, h: 234 },
  b: { x: 624, y: 405, w: 144, h: 171 },
} as const;

export type Landmark = {
  id: string;
  label: string;
  short: string;
  uv?: [number, number];
  img?: [number, number];
  zone: "corner" | "net" | "singles" | "service";
};

export const LANDMARKS: Landmark[] = [
  { id: "c-fl", label: "Far baseline · left", short: "1", uv: [0, 0], zone: "corner" },
  { id: "c-fr", label: "Far baseline · right", short: "2", uv: [1, 0], zone: "corner" },
  { id: "c-nr", label: "Near baseline · right", short: "3", uv: [1, 1], zone: "corner" },
  { id: "c-nl", label: "Near baseline · left", short: "4", uv: [0, 1], zone: "corner" },
  { id: "net-l", label: "Net pole top · left", short: "L", img: [288, 477], zone: "net" },
  { id: "net-r", label: "Net pole top · right", short: "R", img: [1312, 477], zone: "net" },
  { id: "s-fl", label: "Far singles · left", short: "a", uv: [0.08, 0], zone: "singles" },
  { id: "s-fr", label: "Far singles · right", short: "b", uv: [0.92, 0], zone: "singles" },
  { id: "s-nr", label: "Near singles · right", short: "c", uv: [0.92, 1], zone: "singles" },
  { id: "s-nl", label: "Near singles · left", short: "d", uv: [0.08, 1], zone: "singles" },
  { id: "t-f", label: "Far service T", short: "T", uv: [0.5, 0.36], zone: "service" },
  { id: "t-n", label: "Near service T", short: "T", uv: [0.5, 0.64], zone: "service" },
  { id: "sv-fl", label: "Far service · left", short: "·", uv: [0.08, 0.36], zone: "service" },
  { id: "sv-fr", label: "Far service · right", short: "·", uv: [0.92, 0.36], zone: "service" },
  { id: "sv-nl", label: "Near service · left", short: "·", uv: [0.08, 0.64], zone: "service" },
  { id: "sv-nr", label: "Near service · right", short: "·", uv: [0.92, 0.64], zone: "service" },
];

export const AUTO_IDS = ["c-fl", "c-fr", "c-nr", "c-nl", "t-f", "t-n", "net-l", "net-r"];

export type StepKey = "points" | "players" | "review";
export type PlayerState = "idle" | "detecting" | "detected";
export type Marks = Record<string, [number, number]>;

export function lmById(id: string) {
  return LANDMARKS.find((l) => l.id === id)!;
}

export function bilinear(
  corners: [number, number][],
  u: number,
  v: number,
): [number, number] {
  const [c0, c1, c2, c3] = corners;
  const tx = c0[0] + (c1[0] - c0[0]) * u;
  const ty = c0[1] + (c1[1] - c0[1]) * u;
  const bx = c3[0] + (c2[0] - c3[0]) * u;
  const by = c3[1] + (c2[1] - c3[1]) * u;
  return [tx + (bx - tx) * v, ty + (by - ty) * v];
}

export function truthOf(lm: Landmark, corners: [number, number][]): [number, number] {
  if (lm.uv) return bilinear(corners, lm.uv[0], lm.uv[1]);
  return lm.img!.slice() as [number, number];
}

export function computeQuality(marks: Marks) {
  const ids = Object.keys(marks);
  const n = ids.length;
  const quads = new Set<string>();
  ids.forEach((id) => {
    const lm = lmById(id);
    if (!lm?.uv) return;
    quads.add((lm.uv[0] < 0.5 ? "L" : "R") + (lm.uv[1] < 0.5 ? "F" : "N"));
  });
  const quad = quads.size;
  const netReady = !!(marks["net-l"] && marks["net-r"]);
  const ready = quad >= 4 && netReady;
  const extra = Math.max(0, n - quad - (netReady ? 2 : 0));
  const score = Math.min(100, quad * 16 + (netReady ? 22 : 0) + extra * 5);
  const zonesLeft = Math.max(0, 4 - quad);
  let level: "need" | "good" | "excellent";
  let color: string;
  let label: string;
  if (!ready) {
    level = "need";
    color = "var(--warning-500)";
    if (!netReady && zonesLeft) label = `Net poles + ${zonesLeft} zone${zonesLeft === 1 ? "" : "s"}`;
    else if (!netReady) label = "Mark net poles";
    else label = `${zonesLeft} zone${zonesLeft === 1 ? "" : "s"} left`;
  } else if (score < 92) {
    level = "good";
    color = "var(--success-500)";
    label = "Good";
  } else {
    level = "excellent";
    color = "var(--success-500)";
    label = "Excellent";
  }
  const err = Math.max(0.4, 2.0 - n * 0.17).toFixed(1);
  return { n, quad, zonesLeft, score, level, color, label, err, netReady, ready };
}

export function timecodeOf(f: number) {
  const total = 42 + f;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function nextUnplaced(marks: Marks, afterId?: string | null) {
  const start = afterId ? LANDMARKS.findIndex((l) => l.id === afterId) + 1 : 0;
  for (let i = start; i < LANDMARKS.length; i++) {
    if (!marks[LANDMARKS[i].id]) return LANDMARKS[i].id;
  }
  for (let i = 0; i < start; i++) {
    if (!marks[LANDMARKS[i].id]) return LANDMARKS[i].id;
  }
  return null;
}
