import Link from "next/link";
import { Play } from "lucide-react";
import { StatBar } from "@/components/charts/stat-bar";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

const PATTERNS = [
  {
    name: "Clear → Drop → Net miss",
    stat: "n=24 · you win 29%",
    pct: 29,
    base: 54,
    cost: "−25pp",
    neg: true,
  },
  {
    name: "Serve short · body → Lift long",
    stat: "n=18 · you win 33%",
    pct: 33,
    base: 54,
    cost: "−21pp",
    neg: true,
  },
  {
    name: "Drive rally · mid-court squeeze",
    stat: "n=31 · you win 68%",
    pct: 68,
    base: 54,
    cost: "+14pp",
    neg: false,
  },
];

type PatternsPanelProps = {
  patTab: "cost" | "earn";
  onPatTabChange: (v: "cost" | "earn") => void;
};

export function PatternsPanel({ patTab, onPatTabChange }: PatternsPanelProps) {
  return (
    <section className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-[18px] shadow-[var(--shadow-edge)]">
      <div className="mb-1 flex flex-wrap items-center gap-2.5">
        <div className="font-display text-[15px] font-semibold text-[var(--text-strong)]">
          Recurring patterns
        </div>
        <div className="flex-1" />
        <Segmented
          size="sm"
          className="rounded-lg bg-[var(--surface-2)]"
          value={patTab}
          onChange={onPatTabChange}
          options={[
            { id: "cost", label: "Costing" },
            { id: "earn", label: "Earning" },
          ]}
        />
      </div>
      <div className="mb-3.5 text-[12.5px] text-[var(--text-secondary)]">
        Shot sequences the engine keeps seeing · sample floor n≥8
      </div>
      <div className="flex flex-col gap-2">
        {PATTERNS.map((p) => (
          <div
            key={p.name}
            className="flex items-center gap-3.5 rounded-[11px] border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3.5 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] text-[var(--text-strong)]">
                {p.name}
              </div>
              <div className="mt-0.5 font-mono text-[10.5px] tabular-nums text-[var(--text-muted)]">
                {p.stat}
              </div>
            </div>
            <div className="w-[120px] shrink-0">
              <StatBar tone="auto" pct={p.pct} baseline={p.base} />
            </div>
            <span
              className={cn(
                "w-[52px] shrink-0 text-right font-mono text-xs tabular-nums",
                p.neg ? "text-[var(--danger-400)]" : "text-[var(--success-500)]",
              )}
            >
              {p.cost}
            </span>
            <Link
              href="/replay"
              className="inline-flex shrink-0 items-center gap-1 rounded-[7px] border border-[var(--border-strong)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-strong)]"
            >
              <Play className="h-[11px] w-[11px]" />
              Watch
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}
