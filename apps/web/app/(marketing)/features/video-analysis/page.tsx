import {
  Gauge,
  Grid2x2,
  ScanLine,
  Scissors,
  Tags,
} from "lucide-react";
import { AnalysisDemo } from "@/components/marketing/analysis-demo";
import {
  FeatureCTA,
  FeatureHero,
  FeatureSection,
} from "@/components/marketing/feature-page";
import { Reveal } from "@/components/marketing/reveal";

export const metadata = {
  title: "Video analysis",
};

const READOUT = [
  { t: "12:04", shot: "Smash · forehand", speed: "312 km/h", color: "#f4515c" },
  { t: "12:06", shot: "Drop · backhand", speed: "64 km/h", color: "#3693ff" },
  { t: "12:07", shot: "Net kill", speed: "88 km/h", color: "#2dd4a7" },
  { t: "12:09", shot: "Drive · forehand", speed: "146 km/h", color: "#fbbf24" },
  { t: "12:11", shot: "Smash winner", speed: "334 km/h", color: "#f4515c" },
];

const RALLY_HEIGHTS = [
  40, 62, 28, 80, 52, 34, 70, 90, 46, 58, 24, 66, 38, 84, 50, 30, 72, 44, 60, 36,
  76, 54,
];

const SHOT_DIST = [
  { name: "Clears", pct: 28, color: "#3693ff" },
  { name: "Smashes", pct: 22, color: "#f4515c" },
  { name: "Drops", pct: 19, color: "#50deff" },
  { name: "Net", pct: 17, color: "#2dd4a7" },
  { name: "Drives", pct: 14, color: "#fbbf24" },
];

const HEAT_A = [
  0.1, 0.3, 0.2, 0.05, 0.4, 0.85, 0.6, 0.2, 0.3, 0.7, 0.95, 0.35, 0.15, 0.25,
  0.4, 0.1,
];
const HEAT_B = [
  0.05, 0.2, 0.35, 0.15, 0.25, 0.55, 0.8, 0.4, 0.2, 0.45, 0.6, 0.5, 0.1, 0.3,
  0.5, 0.2,
];

const SPEEDS = [
  { label: "Smashes", pct: 92, val: "290 avg" },
  { label: "Drives", pct: 52, val: "150 avg" },
  { label: "Drops", pct: 24, val: "68 avg" },
];

const STATS = [
  {
    big: "27",
    label:
      "data points captured on every single shot, from contact point to landing zone.",
  },
  {
    big: "6 min",
    label:
      "average time to a fully analyzed match from the moment footage finishes uploading.",
  },
  {
    big: "0",
    label:
      "manual tags required — no clipping, no scoring by hand, no spreadsheets.",
  },
];

function heat(v: number) {
  return `rgba(54,147,255,${(0.05 + v * 0.62).toFixed(2)})`;
}

export default function FeatureVideoAnalysisPage() {
  return (
    <div className="overflow-x-clip">
      <FeatureHero
        EyebrowIcon={ScanLine}
        eyebrow="Video analysis"
        title="Every shot, measured."
        body="Upload raw footage and Mintonix watches it the way a coach does — splitting the match into rallies, naming every shot, mapping where players move, and clocking the shuttle. No tagging, no spreadsheets."
        ctas={[
          { href: "/auth", label: "Analyze a match" },
          { href: "/video-analysis", label: "See it live", variant: "outline" },
        ]}
        glow="radial-gradient(110% 60% at 15% -10%, rgba(54,147,255,0.16), transparent 55%)"
      >
        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-xl),var(--shadow-edge)]">
          <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
            <span className="mx-pulse-dot h-2 w-2 rounded-full bg-[#f4515c]" />
            <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
              Analyzing · rally 14
            </span>
            <div className="flex-1" />
            <span className="font-mono text-[11px] text-[var(--accent)]">
              live
            </span>
          </div>
          <div className="px-1.5 py-2">
            {READOUT.map((r) => (
              <div
                key={r.t + r.shot}
                className="flex items-center gap-2.5 rounded-[10px] px-3 py-2.5"
              >
                <span className="min-w-[30px] font-mono text-xs tabular-nums text-[var(--text-faint)]">
                  {r.t}
                </span>
                <span
                  className="h-2 w-2 shrink-0 rounded-sm"
                  style={{ background: r.color }}
                />
                <span className="min-w-0 flex-1 text-[13.5px] text-[var(--text-strong)]">
                  {r.shot}
                </span>
                <span className="font-mono text-xs tabular-nums text-[var(--text-secondary)]">
                  {r.speed}
                </span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--surface-2)] px-4 py-3">
            <span className="text-[12.5px] text-[var(--text-muted)]">
              Shots detected this rally
            </span>
            <span className="font-mono text-[15px] font-semibold tabular-nums text-[var(--text-strong)]">
              27
            </span>
          </div>
        </div>
      </FeatureHero>

      <FeatureSection
        className="relative pt-20"
        maxWidthClassName="max-w-[1256px]"
      >
        <Reveal className="overflow-hidden rounded-[14px] shadow-[var(--shadow-xl)]">
          <AnalysisDemo className="min-h-[560px]" />
        </Reveal>
      </FeatureSection>

      <FeatureSection
        className="pt-[120px]"
        eyebrow="What the engine sees"
        title="Four passes over your footage. One complete picture."
        headerClassName="mb-16 max-w-[620px]"
      >
        <div className="flex flex-col gap-24">
          <Reveal className="grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14">
            <div>
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--accent-soft)] text-[var(--accent)]">
                <Scissors className="h-[21px] w-[21px]" strokeWidth={1.75} />
              </span>
              <h3 className="mt-5 font-display text-[25px] font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
                Rally segmentation
              </h3>
              <p className="mt-3 text-[15.5px] leading-[1.65] text-[var(--text-secondary)]">
                Mintonix finds where each rally starts and ends — serve to last
                shuttle — and lays the match out as a clean timeline. Jump to any
                rally instead of scrubbing through dead time.
              </p>
            </div>
            <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-[22px]">
              <div className="mb-4 flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-[var(--text-faint)]">
                  Match timeline
                </span>
                <span className="font-mono text-[12px] text-[var(--text-secondary)]">
                  38 rallies
                </span>
              </div>
              <div className="flex h-24 items-end gap-1">
                {RALLY_HEIGHTS.map((h, i) => (
                  <div
                    key={i}
                    className="min-w-0 flex-1 rounded-t-[3px]"
                    style={{
                      height: h,
                      background:
                        i % 7 === 0
                          ? "var(--accent)"
                          : "var(--surface-3, #1b2744)",
                    }}
                  />
                ))}
              </div>
              <div className="mt-2.5 flex justify-between font-mono text-[10.5px] text-[var(--text-faint)]">
                <span>0:00</span>
                <span>Game 1</span>
                <span>21:40</span>
              </div>
            </div>
          </Reveal>

          <Reveal className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14">
            <div className="order-2 rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-[22px] lg:order-1">
              <div className="mb-[18px] font-mono text-[11px] uppercase tracking-[0.06em] text-[var(--text-faint)]">
                Shot distribution
              </div>
              <div className="flex flex-col gap-[13px]">
                {SHOT_DIST.map((s) => (
                  <div key={s.name} className="flex items-center gap-3">
                    <span
                      className="h-[9px] w-[9px] flex-none rounded-sm"
                      style={{ background: s.color }}
                    />
                    <span className="min-w-16 text-[13px] text-[var(--text-strong)]">
                      {s.name}
                    </span>
                    <div className="h-[7px] flex-1 overflow-hidden rounded-full bg-[var(--surface-3,#1b2744)]">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${s.pct}%`, background: s.color }}
                      />
                    </div>
                    <span className="min-w-[34px] text-right font-mono text-[12px] tabular-nums text-[var(--text-secondary)]">
                      {s.pct}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="order-1 lg:order-2">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--accent-soft)] text-[var(--accent)]">
                <Tags className="h-[21px] w-[21px]" strokeWidth={1.75} />
              </span>
              <h3 className="mt-5 font-display text-[25px] font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
                Shot classification
              </h3>
              <p className="mt-3 text-[15.5px] leading-[1.65] text-[var(--text-secondary)]">
                Every contact is named — smash, drop, clear, net, drive, lift —
                and credited to a player. The distribution tells you, at a glance,
                what a match was actually made of.
              </p>
            </div>
          </Reveal>

          <Reveal className="grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14">
            <div>
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--accent-soft)] text-[var(--accent)]">
                <Grid2x2 className="h-[21px] w-[21px]" strokeWidth={1.75} />
              </span>
              <h3 className="mt-5 font-display text-[25px] font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
                Movement heatmaps
              </h3>
              <p className="mt-3 text-[15.5px] leading-[1.65] text-[var(--text-secondary)]">
                Player tracking turns into a court heatmap — where they covered,
                where they got pulled, and the corners they never had to defend.
                Spot the pattern a scoreline hides.
              </p>
            </div>
            <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-[22px]">
              <div className="flex items-center gap-[18px]">
                {[
                  { name: "Axelsen", cells: HEAT_A },
                  { name: "Momota", cells: HEAT_B },
                ].map((p) => (
                  <div
                    key={p.name}
                    className="flex-1 overflow-hidden rounded-[10px] border border-[var(--border-subtle)] bg-[#0a1428]"
                  >
                    <div className="border-b border-[var(--border-subtle)] px-[9px] py-[7px] font-mono text-[10px] text-[var(--text-faint)]">
                      {p.name}
                    </div>
                    <div className="grid grid-cols-4 gap-0.5 p-2">
                      {p.cells.map((v, i) => (
                        <div
                          key={i}
                          className="aspect-square rounded-[3px]"
                          style={{ background: heat(v) }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>

          <Reveal className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14">
            <div className="order-2 rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-[26px] lg:order-1">
              <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-[var(--text-faint)]">
                Fastest smash
              </div>
              <div className="mt-1.5 font-display text-[46px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-[var(--text-strong)]">
                334
                <span className="ml-1.5 text-[18px] text-[var(--text-muted)]">
                  km/h
                </span>
              </div>
              <div className="mt-[22px] flex flex-col gap-3">
                {SPEEDS.map((sp) => (
                  <div key={sp.label} className="flex items-center gap-3">
                    <span className="min-w-[58px] text-[12.5px] text-[var(--text-secondary)]">
                      {sp.label}
                    </span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-3,#1b2744)]">
                      <div
                        className="h-full rounded-full bg-[linear-gradient(90deg,var(--accent),#50deff)]"
                        style={{ width: `${sp.pct}%` }}
                      />
                    </div>
                    <span className="min-w-14 text-right font-mono text-[12px] tabular-nums text-[var(--text-secondary)]">
                      {sp.val}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="order-1 lg:order-2">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--accent-soft)] text-[var(--accent)]">
                <Gauge className="h-[21px] w-[21px]" strokeWidth={1.75} />
              </span>
              <h3 className="mt-5 font-display text-[25px] font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
                Shuttle speed & trajectory
              </h3>
              <p className="mt-3 text-[15.5px] leading-[1.65] text-[var(--text-secondary)]">
                The shuttle is tracked frame by frame, so every shot carries a
                speed and an arc. Sort a match by the hardest hits, or watch how a
                player&apos;s pace holds up across three games.
              </p>
            </div>
          </Reveal>
        </div>
      </FeatureSection>

      <FeatureSection className="pt-[110px]">
        <Reveal className="grid gap-9 rounded-[18px] border border-[var(--border)] bg-[var(--surface-1)] p-10 shadow-[var(--shadow-edge)] sm:grid-cols-3">
          {STATS.map((st) => (
            <div key={st.big}>
              <div className="font-display text-[clamp(34px,4vw,46px)] font-semibold leading-none tracking-[-0.03em] tabular-nums text-[var(--text-strong)]">
                {st.big}
              </div>
              <div className="mt-3 text-[14.5px] leading-[1.5] text-[var(--text-secondary)]">
                {st.label}
              </div>
            </div>
          ))}
        </Reveal>
      </FeatureSection>

      <FeatureCTA
        title="Point a camera. Get the numbers."
        body="Your first match is free to analyze — no card, no setup. Or open a pro match from the BWF library and explore the analysis right now."
        ctas={[
          { href: "/auth", label: "Analyze your first match" },
          {
            href: "/bwf",
            label: "Browse BWF matches",
            variant: "ghost",
          },
        ]}
      />
    </div>
  );
}
