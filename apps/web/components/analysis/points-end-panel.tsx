import { StatBar } from "@/components/charts/stat-bar";

const WON_ROWS = [
  { l: "Your winners", n: "342", p: "28%", c: "var(--success-500)" },
  { l: "Errors you forced", n: "218", p: "18%", c: "rgba(45,212,167,0.6)" },
  { l: "Opponent unforced errors", n: "156", p: "12%", c: "rgba(45,212,167,0.3)" },
];

const LOST_ROWS = [
  { l: "Your unforced errors", n: "198", p: "16%", c: "var(--danger-500)" },
  { l: "Your forced errors", n: "174", p: "14%", c: "rgba(244,81,92,0.6)" },
  { l: "Opponent winners", n: "160", p: "12%", c: "rgba(244,81,92,0.3)" },
];

function OutcomeRow({
  l,
  n,
  p,
  c,
}: {
  l: string;
  n: string;
  p: string;
  c: string;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--surface-hover)]"
    >
      <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: c }} />
      <span className="min-w-0 flex-1 text-[12.5px] text-[var(--text-secondary)]">
        {l}
      </span>
      <span className="font-mono text-[11.5px] tabular-nums text-[var(--text-strong)]">
        {n}
      </span>
      <span className="w-[30px] text-right font-mono text-[10.5px] tabular-nums text-[var(--text-faint)]">
        {p}
      </span>
    </button>
  );
}

export function PointsEndPanel() {
  return (
    <section className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-[18px] shadow-[var(--shadow-edge)]">
      <div className="mb-1 flex items-baseline gap-3">
        <div className="font-display text-[15px] font-semibold text-[var(--text-strong)]">
          How your points end
        </div>
        <div className="flex-1" />
        <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
          n=1,248
        </span>
      </div>
      <div className="mb-3.5 text-[12.5px] text-[var(--text-secondary)]">
        Every point in scope, by how it finished. Click a row to watch those
        rallies.
      </div>
      <StatBar
        size="md"
        segments={[
          { pct: 28, tone: "success", title: "Winners" },
          { pct: 18, tone: "success-soft", title: "Forced" },
          { pct: 12, tone: "success-faint", title: "Opp UE" },
          { pct: 16, tone: "danger", title: "Your UE" },
          { pct: 14, tone: "danger-soft", title: "Forced against" },
          { pct: 12, tone: "danger-faint", title: "Opp winners" },
        ]}
      />
      <div className="mt-3.5 grid grid-cols-2 gap-5">
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--success-500)]">
            Points won · 58%
          </div>
          {WON_ROWS.map((r) => (
            <OutcomeRow key={r.l} {...r} />
          ))}
        </div>
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--danger-400)]">
            Points lost · 42%
          </div>
          {LOST_ROWS.map((r) => (
            <OutcomeRow key={r.l} {...r} />
          ))}
        </div>
      </div>
      <div className="my-3.5 h-px bg-[var(--border-subtle)]" />
      <div className="grid grid-cols-2 gap-5">
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
            Shots that win you points
          </div>
          <div className="space-y-1.5">
            <StatBar label="Smash" labelWidth="88px" tone="success" pct={42} value="142" />
            <StatBar label="Net" labelWidth="88px" tone="success" pct={28} value="96" />
            <StatBar label="Drop" labelWidth="88px" tone="success" pct={18} value="61" />
            <StatBar label="Drive" labelWidth="88px" tone="success" pct={12} value="43" />
          </div>
        </div>
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
            Your shots that donate points
          </div>
          <div className="space-y-1.5">
            <StatBar label="Lift error" labelWidth="108px" tone="danger" pct={36} value="71" />
            <StatBar label="Net miss" labelWidth="108px" tone="danger" pct={28} value="55" />
            <StatBar label="Clear long" labelWidth="108px" tone="danger" pct={20} value="39" />
            <StatBar label="Smash wide" labelWidth="108px" tone="danger" pct={16} value="33" />
          </div>
        </div>
      </div>
    </section>
  );
}
