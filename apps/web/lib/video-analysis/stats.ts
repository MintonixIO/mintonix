import type { Rally } from "./rallies";

export type AnalysisScope = "match" | "rally" | "shot";

export function shotTypeMix(rallies: Rally[]) {
  const allShots = rallies.flatMap((r) => r.sequence);
  const counts: Record<string, number> = {};
  allShots.forEach((s) => {
    const base = s.type.split(" ")[0];
    counts[base] = (counts[base] || 0) + 1;
  });
  const total = allShots.length || 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([type, n]) => ({ type, pct: Math.round((n / total) * 100), n }));
}

export function rallyLengthBuckets(rallies: Rally[]) {
  const buckets = [0, 0, 0, 0, 0]; // 1-4, 5-8, 9-12, 13-16, 17+
  rallies.forEach((r) => {
    if (r.shots <= 4) buckets[0]++;
    else if (r.shots <= 8) buckets[1]++;
    else if (r.shots <= 12) buckets[2]++;
    else if (r.shots <= 16) buckets[3]++;
    else buckets[4]++;
  });
  const max = Math.max(...buckets, 1);
  return [
    { label: "1–4", n: buckets[0], h: (buckets[0] / max) * 100 },
    { label: "5–8", n: buckets[1], h: (buckets[1] / max) * 100 },
    { label: "9–12", n: buckets[2], h: (buckets[2] / max) * 100 },
    { label: "13–16", n: buckets[3], h: (buckets[3] / max) * 100 },
    { label: "17+", n: buckets[4], h: (buckets[4] / max) * 100 },
  ];
}

export function playbackRate(speed: string): number {
  if (speed === "0.5×") return 0.5;
  if (speed === "1.5×") return 1.5;
  if (speed === "2×") return 2;
  return 1;
}
