import { StatBar } from "@/components/charts/stat-bar";
import { cn } from "@/lib/utils";

export function SituationsPanel() {
  return (
    <section className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-[18px] shadow-[var(--shadow-edge)]">
      <div className="mb-1 flex items-baseline gap-3">
        <div className="font-display text-[15px] font-semibold text-[var(--text-strong)]">
          Situations
        </div>
        <div className="flex-1" />
        <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
          baseline 54%
        </span>
      </div>
      <div className="mb-3.5 text-[12.5px] text-[var(--text-secondary)]">
        Same rallies, cut by context — where your odds move.
      </div>
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
        Rally length
      </div>
      <div className="space-y-1.5">
        <StatBar label="1–4" labelWidth="74px" tone="auto" pct={61} baseline={54} value="61%" n="n=312" />
        <StatBar label="5–8" labelWidth="74px" tone="auto" pct={56} baseline={54} value="56%" n="n=401" />
        <StatBar label="9–12" labelWidth="74px" tone="auto" pct={49} baseline={54} value="49%" n="n=288" />
        <StatBar label="13+" labelWidth="74px" tone="auto" pct={44} baseline={54} value="44%" n="n=247" />
      </div>
      <div className="mb-2 mt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
        By game
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "G1", val: "57%", delta: "+3pp", pos: true },
          { label: "G2", val: "52%", delta: "−2pp", pos: false },
          { label: "G3", val: "54%", delta: "0", flat: true },
        ].map((c) => (
          <div
            key={c.label}
            className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2 py-2.5 text-center"
          >
            <span className="block font-mono text-[10px] text-[var(--text-muted)]">
              {c.label}
            </span>
            <span className="mt-1 block font-display text-[19px] font-semibold tabular-nums text-[var(--text-strong)]">
              {c.val}
            </span>
            <span
              className={cn(
                "mt-0.5 block font-mono text-[10px] tabular-nums",
                c.flat
                  ? "text-[var(--text-muted)]"
                  : c.pos
                    ? "text-[var(--success-500)]"
                    : "text-[var(--danger-400)]",
              )}
            >
              {c.delta}
            </span>
          </div>
        ))}
      </div>
      <div className="mb-2 mt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
        Score pressure
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: "≤17", val: "56%", delta: "+2pp", pos: true },
          { label: "≥18", val: "49%", delta: "−5pp", pos: false },
        ].map((c) => (
          <div
            key={c.label}
            className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2 py-2.5 text-center"
          >
            <span className="block font-mono text-[10px] text-[var(--text-muted)]">
              {c.label}
            </span>
            <span className="mt-1 block font-display text-[19px] font-semibold tabular-nums text-[var(--text-strong)]">
              {c.val}
            </span>
            <span
              className={cn(
                "mt-0.5 block font-mono text-[10px] tabular-nums",
                c.pos ? "text-[var(--success-500)]" : "text-[var(--danger-400)]",
              )}
            >
              {c.delta}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
