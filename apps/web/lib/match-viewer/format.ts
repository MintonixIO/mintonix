/** Match-clock friendly: H:MM:SS when ≥1h else M:SS (or tenths under 60s). */
export function formatMatchClock(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(Math.floor(r)).padStart(2, "0")}`;
  }
  if (s >= 60) {
    return `${m}:${String(Math.floor(r)).padStart(2, "0")}`;
  }
  return `${r.toFixed(1)}s`;
}

/** Compact duration for rally chips (e.g. 8.4s, 1:12). */
export function formatRallyDuration(seconds: number): string {
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return formatMatchClock(seconds);
}
