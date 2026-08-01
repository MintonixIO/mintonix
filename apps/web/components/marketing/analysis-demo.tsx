import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Filter,
  ListTree,
} from "lucide-react";
import { cn } from "@/lib/utils";

const RALLIES = [
  { n: "01", shots: 4, dur: "6s", end: "Net error", tone: "danger" as const },
  { n: "02", shots: 7, dur: "11s", end: "Smash", tone: "success" as const },
  { n: "03", shots: 12, dur: "18s", end: "Drop winner", tone: "success" as const },
  { n: "04", shots: 9, dur: "14s", end: "Forced error", tone: "warn" as const },
  { n: "05", shots: 5, dur: "8s", end: "Smash", tone: "success" as const, active: true },
  { n: "06", shots: 15, dur: "22s", end: "Clear long", tone: "danger" as const },
  { n: "07", shots: 6, dur: "9s", end: "Net kill", tone: "success" as const },
  { n: "08", shots: 11, dur: "16s", end: "Drive", tone: "success" as const },
  { n: "09", shots: 8, dur: "12s", end: "Unforced", tone: "danger" as const },
];

/** Marketing hero demo — matches the design's embedded video-analysis frame. */
export function AnalysisDemo({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-full min-h-[520px] flex-col overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-primary)] shadow-[var(--shadow-xl),var(--shadow-edge)]",
        className,
      )}
    >
      {/* Top bar */}
      <header className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-[var(--border-subtle)] bg-[rgba(10,16,32,0.92)] px-3.5">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-muted)]">
          <ArrowLeft className="h-4 w-4" />
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/logomark.png" alt="" className="h-[18px] w-auto" />
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-[var(--text-muted)]">
          <span>Library</span>
          <ChevronRight className="h-3 w-3" />
          <span className="text-[var(--text-secondary)]">Axelsen vs Momota</span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2.5 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-2.5 py-1">
          <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-strong)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--player-a)]" />
            Axelsen
          </span>
          <span className="font-mono text-[13px] tabular-nums text-[var(--text-strong)]">
            21 – 18
          </span>
          <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-strong)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--player-b)]" />
            Momota
          </span>
        </div>
        <span className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-2.5 py-1.5 text-[12px] text-[var(--text-secondary)]">
          Export rallies
        </span>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[1.55fr_minmax(280px,0.9fr)]">
        {/* Video pane */}
        <div className="relative min-h-0 border-r border-[var(--border-subtle)] bg-[#070b16]">
          {/* Empty media slot — drop /public/media/clip-frame.jpg later to restore still. */}
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center"
            aria-hidden
          >
            <div
              className="absolute inset-0 opacity-40"
              style={{
                backgroundImage:
                  "radial-gradient(ellipse 70% 50% at 50% 40%, rgba(54,147,255,0.2), transparent 70%), linear-gradient(rgba(54,147,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(54,147,255,0.04) 1px, transparent 1px)",
                backgroundSize: "auto, 40px 40px, 40px 40px",
              }}
            />
            <span className="relative font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
              Match video
            </span>
            <span className="relative max-w-[28ch] text-[13px] leading-snug text-[var(--text-muted)]">
              Preview still coming soon — open a live BWF match for YouTube playback.
            </span>
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-[rgba(7,11,22,0.75)] via-transparent to-transparent" />

          {/* Scorebug */}
          <div className="absolute left-3 top-3 overflow-hidden rounded-md border border-white/10 bg-[rgba(8,12,22,0.88)] text-[11px] shadow-lg backdrop-blur-sm">
            <div className="flex items-center gap-2 border-b border-white/5 px-2.5 py-1.5">
              <span className="h-3.5 w-5 rounded-[2px] bg-[#de2910]" />
              <span className="w-16 font-medium text-white">SHI Y.Q.</span>
              <span className="font-mono tabular-nums text-white/90">21</span>
              <span className="font-mono tabular-nums text-white/90">20</span>
              <span className="rounded bg-white/10 px-1 font-mono tabular-nums text-white">
                17
              </span>
            </div>
            <div className="flex items-center gap-2 px-2.5 py-1.5">
              <span className="h-3.5 w-5 rounded-[2px] bg-[#002868]" />
              <span className="w-16 font-medium text-white">LI S.F.</span>
              <span className="font-mono tabular-nums text-white/90">9</span>
              <span className="font-mono tabular-nums text-white/90">22</span>
              <span className="rounded bg-white/10 px-1 font-mono tabular-nums text-white">
                17
              </span>
            </div>
          </div>

          {/* Transport */}
          <div className="absolute inset-x-0 bottom-0 border-t border-[var(--border-subtle)] bg-[rgba(10,16,32,0.88)] px-3 py-2.5 backdrop-blur">
            <div className="relative mb-2 h-1.5 rounded-full bg-[var(--surface-3)]">
              <div className="absolute inset-y-0 left-0 w-[42%] rounded-full bg-[var(--accent)]" />
              <div className="absolute left-[12%] top-1/2 h-1 w-[7%] -translate-y-1/2 rounded-full bg-[rgba(54,147,255,0.45)]" />
              <div className="absolute left-[28%] top-1/2 h-1 w-[10%] -translate-y-1/2 rounded-full bg-[rgba(54,147,255,0.45)]" />
              <div className="absolute left-[42%] top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_3px_rgba(54,147,255,0.35)]" />
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[var(--accent)] text-white">
                ▶
              </span>
              <span className="font-mono text-[11px] tabular-nums text-[var(--text-strong)]">
                28:14 <span className="text-[var(--text-faint)]">/ 1:12:04</span>
              </span>
              <div className="flex-1" />
              <span className="rounded border border-[var(--border)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">
                1×
              </span>
            </div>
          </div>
        </div>

        {/* Rally control */}
        <div className="flex min-h-0 flex-col bg-[var(--surface-1)]">
          <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2.5">
            <ListTree className="h-4 w-4 text-[var(--accent)]" />
            <div className="min-w-0">
              <div className="font-display text-[13px] font-semibold text-[var(--text-strong)]">
                Rally control
              </div>
              <div className="font-mono text-[10px] text-[var(--text-muted)]">
                9 rallies · expand for shots
              </div>
            </div>
            <div className="flex-1" />
            <span className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">
              <Filter className="h-3 w-3" />
              Filter
            </span>
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-hidden p-2">
            {RALLIES.map((r) => (
              <div
                key={r.n}
                className={cn(
                  "flex items-center gap-2 rounded-[10px] border px-2.5 py-2",
                  r.active
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                    : "border-[var(--border-subtle)] bg-[var(--surface-2)]",
                )}
              >
                <span className="font-mono text-[12px] font-semibold tabular-nums text-[var(--text-secondary)]">
                  {r.n}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[12px] tabular-nums text-[var(--text-strong)]">
                      {r.shots} shots
                    </span>
                    <span className="text-[var(--text-faint)]">·</span>
                    <span className="font-mono text-[11px] text-[var(--text-muted)]">
                      {r.dur}
                    </span>
                  </div>
                  <div
                    className={cn(
                      "mt-0.5 text-[11px]",
                      r.tone === "success" && "text-[var(--success-400)]",
                      r.tone === "danger" && "text-[var(--danger-400)]",
                      r.tone === "warn" && "text-[var(--warning-400)]",
                    )}
                  >
                    Ended · {r.end}
                  </div>
                </div>
                <ChevronDown className="h-3.5 w-3.5 text-[var(--text-faint)]" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
