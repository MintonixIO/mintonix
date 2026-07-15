import {
  ListTree,
  Play,
  Share2,
  SlidersHorizontal,
} from "lucide-react";

/** Marketing highlight-builder demo — matches home design showcase. */
export function HighlightsDemo() {
  return (
    <div className="overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-lg),var(--shadow-edge)]">
      <div className="flex items-center gap-[11px] border-b border-[var(--border-subtle)] px-4 py-3">
        <ListTree className="h-4 w-4 text-[var(--accent)]" strokeWidth={1.75} />
        <span className="font-display text-sm font-semibold text-[var(--text-strong)]">
          Highlight builder
        </span>
        <span className="font-mono text-[11px] text-[var(--text-muted)]">
          Axelsen vs Momota
        </span>
        <div className="flex-1" />
        <span className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[var(--accent)] bg-[rgba(54,147,255,0.16)] px-2.5 text-[12.5px] text-[var(--text-strong)]">
          <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.75} />
          Filter
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent)] px-1 font-mono text-[11px] text-white">
            2
          </span>
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 p-[18px] md:grid-cols-2">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
          <div className="mb-4 flex items-center justify-between">
            <span className="font-display text-[13.5px] font-semibold text-[var(--text-strong)]">
              Highlight filters
            </span>
            <span className="text-xs text-[var(--text-muted)]">Reset</span>
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
                Presets
              </span>
              <div className="flex flex-wrap gap-1.5">
                <span className="rounded-full bg-[rgba(54,147,255,0.16)] px-2.5 py-1 text-xs text-[var(--text-strong)]">
                  Smashes 300+
                </span>
                {["Long rallies", "Net winners"].map((t) => (
                  <span
                    key={t}
                    className="rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-2.5 py-1 text-xs text-[var(--text-secondary)]"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
                Shot type
              </span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { c: "#f4515c", l: "Smash", on: true },
                  { c: "#3693ff", l: "Drop" },
                  { c: "#2dd4a7", l: "Net" },
                  { c: "#fbbf24", l: "Drive" },
                ].map((s) => (
                  <span
                    key={s.l}
                    className={
                      s.on
                        ? "inline-flex items-center gap-1.5 rounded-full bg-[rgba(54,147,255,0.16)] px-2.5 py-1 text-xs text-[var(--text-strong)]"
                        : "inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-2.5 py-1 text-xs text-[var(--text-secondary)]"
                    }
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-sm"
                      style={{ background: s.c }}
                    />
                    {s.l}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-secondary)]">Speed ≥</span>
                <span className="font-mono text-xs tabular-nums text-[var(--accent)]">
                  300 km/h
                </span>
              </div>
              <div className="relative h-1 rounded-full bg-[var(--surface-3)]">
                <div className="absolute inset-y-0 left-0 w-[83%] rounded-full bg-[var(--accent)]" />
                <div className="absolute left-[83%] top-1/2 h-[13px] w-[13px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent)] shadow-[0_0_0_3px_rgba(54,147,255,0.25)]" />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
                Outcome
              </span>
              <div className="flex gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-0.5">
                {["Any", "Winners", "Errors"].map((o, i) => (
                  <span
                    key={o}
                    className={
                      i === 1
                        ? "flex-1 rounded-md bg-[var(--accent)] px-2 py-1.5 text-center text-xs text-white"
                        : "flex-1 rounded-md px-2 py-1.5 text-center text-xs text-[var(--text-muted)]"
                    }
                  >
                    {o}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
          <div className="mb-3.5 flex items-baseline gap-2">
            <span className="font-display text-[22px] font-semibold tracking-[-0.02em] tabular-nums text-[var(--text-strong)]">
              6 clips
            </span>
            <span className="font-mono text-xs text-[var(--text-muted)]">
              · 1:40 in reel
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            {[
              { n: "02", label: "Smash", hand: "FH", speed: "312 km/h", on: true },
              { n: "05", label: "Smash winner", hand: "BH", speed: "334 km/h", on: true },
              { n: "07", label: "Smash", hand: "FH", speed: "318 km/h", on: true },
              { n: "12", label: "Smash", hand: "FH", speed: "305 km/h", on: false },
              { n: "19", label: "Smash winner", hand: "FH", speed: "326 km/h", on: true },
              { n: "24", label: "Smash", hand: "BH", speed: "301 km/h", on: true },
            ].map((c) => (
              <div
                key={c.n}
                className="flex items-center gap-2.5 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-1)] px-2.5 py-2"
                style={{ opacity: c.on ? 1 : 0.5 }}
              >
                <span className="min-w-5 font-mono text-[13px] font-semibold tabular-nums text-[var(--text-secondary)]">
                  {c.n}
                </span>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#f4515c]" />
                <span className="min-w-0 flex-1 text-[12.5px] text-[var(--text-strong)]">
                  {c.label}
                </span>
                <span className="rounded border border-[var(--border)] px-1 py-px font-mono text-[10px] text-[var(--text-muted)]">
                  {c.hand}
                </span>
                <span
                  className={`font-mono text-[11px] tabular-nums ${c.on ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}`}
                >
                  {c.speed}
                </span>
                <span
                  className={
                    c.on
                      ? "inline-flex h-[19px] w-[19px] items-center justify-center rounded-md bg-[var(--accent)] text-xs text-white"
                      : "inline-flex h-[19px] w-[19px] items-center justify-center rounded-md border border-[var(--border-strong)] text-xs text-transparent"
                  }
                >
                  ✓
                </span>
              </div>
            ))}
          </div>
          <div className="mt-auto flex items-center gap-2.5 pt-4">
            <span className="inline-flex h-[34px] items-center gap-1.5 rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[12.5px] text-[var(--text-secondary)]">
              <Play className="h-3.5 w-3.5 text-[var(--accent)]" strokeWidth={1.75} />
              Preview reel
            </span>
            <div className="flex-1" />
            <span className="inline-flex h-[34px] items-center gap-1.5 rounded-[9px] bg-[var(--accent)] px-3 text-[12.5px] font-medium text-white">
              <Share2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              Share highlights
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
