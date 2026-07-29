import { StatBar } from "@/components/charts/stat-bar";
import { cn } from "@/lib/utils";

export type MatchChip = {
  name: string;
  res: string;
  pw: number;
  w: string;
  win: boolean;
  active?: boolean;
};

export const MATCH_CHIPS: MatchChip[] = [
  { name: "Vitidsarn", res: "L", pw: 42, w: "0–2", win: false },
  { name: "Antonsen", res: "W", pw: 58, w: "2–1", win: true },
  { name: "Kim/Seo", res: "W", pw: 61, w: "2–0", win: true },
  { name: "Prannoy", res: "W", pw: 55, w: "2–1", win: true },
  { name: "Lee ZJ", res: "L", pw: 46, w: "1–2", win: false },
  { name: "Popov", res: "W", pw: 63, w: "2–0", win: true },
  { name: "Doubles", res: "W", pw: 57, w: "2–1", win: true },
  { name: "Ginting", res: "W", pw: 52, w: "2–1", win: true },
  { name: "Momota", res: "W", pw: 54, w: "2–1", win: true, active: true },
  { name: "Axelsen", res: "L", pw: 48, w: "1–2", win: false },
];

export function MatchChipStrip({ chips = MATCH_CHIPS }: { chips?: MatchChip[] }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {chips.map((m) => (
        <button
          key={m.name}
          type="button"
          className={cn(
            "w-[118px] shrink-0 rounded-[10px] border px-2.5 py-2 text-left",
            m.active
              ? "border-[var(--accent)] bg-[var(--accent-soft)]"
              : "border-[var(--border)] bg-[var(--surface-1)] hover:border-[var(--border-strong)]",
          )}
        >
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-[5px] font-mono text-[10px] font-semibold",
                m.win
                  ? "bg-[var(--success-bg)] text-[var(--success-500)]"
                  : "bg-[var(--danger-bg)] text-[var(--danger-400)]",
              )}
            >
              {m.res}
            </span>
            <span className="min-w-0 truncate text-xs text-[var(--text-strong)]">
              {m.name}
            </span>
          </span>
          <span className="mt-1.5 flex items-center gap-1.5">
            <span className="min-w-0 flex-1">
              <StatBar pct={m.pw} size="xs" tone="accent" />
            </span>
            <span className="font-mono text-[10px] tabular-nums text-[var(--text-muted)]">
              {m.w}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
