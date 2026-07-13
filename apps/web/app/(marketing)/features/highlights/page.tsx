import Link from "next/link";
import {
  Crown,
  Film,
  Flame,
  Play,
  Repeat,
  Share2,
  Sparkles,
  Target,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/marketing/reveal";
import { HighlightsDemo } from "@/components/marketing/highlights-demo";

export const metadata = { title: "Highlights" };

const STRIP = [
  { l: "Smash", m: "334 km/h", c: "#f4515c" },
  { l: "Net kill", m: "0:06", c: "#2dd4a7" },
  { l: "Rally · 41 shots", m: "0:38", c: "#3693ff" },
  { l: "Drive", m: "188 km/h", c: "#fbbf24" },
  { l: "Smash", m: "312 km/h", c: "#f4515c" },
  { l: "Deception", m: "0:09", c: "#50deff" },
  { l: "Drop winner", m: "G2 · 14–12", c: "#2dd4a7" },
  { l: "Forced err", m: "mid court", c: "#b07bff" },
];

const PRESETS: {
  icon: LucideIcon;
  title: string;
  body: string;
  count: string;
}[] = [
  {
    icon: Zap,
    title: "Smashes 300+",
    body: "Every smash clocked over 300 km/h, hardest first.",
    count: "8 clips",
  },
  {
    icon: Repeat,
    title: "Long rallies won",
    body: "Rallies past 20 shots that ended in your favour.",
    count: "5 clips",
  },
  {
    icon: Target,
    title: "Net winners",
    body: "Kills and tumbles finished at the net.",
    count: "11 clips",
  },
  {
    icon: Flame,
    title: "Comebacks",
    body: "Points won from three or more down in a row.",
    count: "4 clips",
  },
  {
    icon: Sparkles,
    title: "Deceptions",
    body: "Hold-and-flick and slice disguises that fooled the read.",
    count: "7 clips",
  },
  {
    icon: Crown,
    title: "Match points",
    body: "Game and match-deciding rallies, end to end.",
    count: "3 clips",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Set the criteria",
    body: "Pick a shot type, drag a speed threshold, choose an outcome. Stack as many filters as you like.",
  },
  {
    n: "02",
    title: "Mintonix assembles",
    body: "Every matching rally collapses into one reel, in match order, trimmed to the action.",
  },
  {
    n: "03",
    title: "Preview & share",
    body: "Watch it through, reorder or drop clips, then send a single link to anyone.",
  },
];

const REEL = [
  { n: "02", name: "Smash · forehand", speed: "312 km/h" },
  { n: "05", name: "Smash winner", speed: "334 km/h" },
  { n: "07", name: "Smash · forehand", speed: "318 km/h" },
  { n: "12", name: "Smash · forehand", speed: "305 km/h", dim: true },
];

export default function FeatureHighlightsPage() {
  return (
    <div className="overflow-x-clip">
      <section className="relative">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(110% 60% at 50% -10%, rgba(45,212,167,0.14), transparent 56%)",
          }}
        />
        <div className="relative mx-auto max-w-[900px] px-8 pt-24 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[rgba(45,212,167,0.16)] px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[#2dd4a7]">
            <Film className="h-3.5 w-3.5" />
            Highlights
          </div>
          <h1 className="mx-auto mt-[22px] max-w-[16ch] font-display text-[clamp(36px,5.4vw,64px)] font-semibold leading-[1.03] tracking-[-0.03em] text-[var(--text-strong)] text-balance">
            The best of the match, without the editing.
          </h1>
          <p className="mx-auto mt-5 max-w-[52ch] text-[clamp(15px,1.5vw,18px)] leading-[1.62] text-[var(--text-secondary)]">
            Set what counts as a highlight — a shot type, a speed, an outcome —
            and Mintonix pulls every matching rally into one reel. Trim, preview,
            and share it with a link.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/auth">
              <Button size="lg">Build a reel</Button>
            </Link>
            <Link href="/highlights">
              <Button variant="outline" size="lg">
                See the reel library
              </Button>
            </Link>
          </div>
        </div>

        <div className="mt-16 overflow-hidden px-4 [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
          <div className="flex gap-3">
            {STRIP.map((clip) => (
              <div
                key={clip.l + clip.m}
                className="relative h-[138px] w-[232px] shrink-0 overflow-hidden rounded-xl border border-[var(--border)] bg-[linear-gradient(135deg,#0e1830,#0a1428)]"
              >
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(45deg, rgba(255,255,255,0.018) 0 9px, transparent 9px 18px)",
                  }}
                />
                <div className="absolute left-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-[7px] border border-[var(--border-subtle)] bg-[rgba(10,16,32,0.7)] px-2 py-1">
                  <span
                    className="h-1.5 w-1.5 rounded-sm"
                    style={{ background: clip.c }}
                  />
                  <span className="text-[11px] text-[var(--text-strong)]">
                    {clip.l}
                  </span>
                </div>
                <div className="absolute bottom-2.5 left-2.5 rounded-md bg-[rgba(10,16,32,0.7)] px-1.5 py-0.5 font-mono text-[11px] text-[#2dd4a7]">
                  {clip.m}
                </div>
                <span className="absolute left-1/2 top-1/2 inline-flex h-[38px] w-[38px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-[rgba(10,16,32,0.55)]">
                  <Play className="h-4 w-4 text-white" />
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1180px] px-8 pt-[100px]">
        <Reveal className="mb-10 max-w-[640px]">
          <div className="mb-3.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[#2dd4a7]">
            One tap to a reel
          </div>
          <h2 className="font-display text-[clamp(28px,3.4vw,42px)] font-semibold leading-[1.1] tracking-[-0.025em] text-[var(--text-strong)] text-balance">
            Start from a preset. Or invent your own.
          </h2>
        </Reveal>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PRESETS.map((p) => (
            <Reveal
              key={p.title}
              className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-[22px] transition-transform hover:-translate-y-0.5"
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-[11px] border border-[var(--border)] bg-[rgba(45,212,167,0.16)] text-[#2dd4a7]">
                <p.icon className="h-[19px] w-[19px]" />
              </span>
              <div className="mt-4 font-display text-base font-semibold text-[var(--text-strong)]">
                {p.title}
              </div>
              <p className="mt-1.5 text-[13.5px] leading-[1.55] text-[var(--text-secondary)]">
                {p.body}
              </p>
              <div className="mt-3.5 inline-flex items-center gap-1.5 font-mono text-[11px] text-[var(--text-muted)]">
                <Film className="h-[13px] w-[13px]" />
                {p.count}
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1180px] px-8 pt-[116px]">
        <Reveal className="mx-auto mb-[52px] max-w-[620px] text-center">
          <div className="mb-3.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[#2dd4a7]">
            How it works
          </div>
          <h2 className="font-display text-[clamp(28px,3.4vw,42px)] font-semibold leading-[1.1] tracking-[-0.025em] text-[var(--text-strong)] text-balance">
            Filter. Assemble. Share.
          </h2>
        </Reveal>
        <div className="grid gap-[18px] md:grid-cols-3">
          {STEPS.map((s) => (
            <Reveal
              key={s.n}
              className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-[26px]"
            >
              <span className="rounded-lg border border-[var(--border)] bg-[rgba(45,212,167,0.16)] px-[9px] py-1 font-mono text-[12px] text-[#2dd4a7]">
                {s.n}
              </span>
              <div className="mt-[18px] font-display text-[18px] font-semibold text-[var(--text-strong)]">
                {s.title}
              </div>
              <p className="mt-2 text-[14px] leading-[1.6] text-[var(--text-secondary)]">
                {s.body}
              </p>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1100px] px-8 pt-[100px]">
        <Reveal className="relative">
          <div
            className="pointer-events-none absolute -inset-px rounded-2xl"
            style={{
              boxShadow:
                "0 0 0 1px rgba(45,212,167,0.18), 0 30px 90px rgba(45,212,167,0.12)",
            }}
          />
          <div className="overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-lg)]">
            <div className="flex items-center gap-[11px] border-b border-[var(--border-subtle)] px-4 py-[13px]">
              <Film className="h-4 w-4 text-[#2dd4a7]" />
              <span className="font-display text-[14px] font-semibold text-[var(--text-strong)]">
                Highlight builder
              </span>
              <span className="font-mono text-[11px] text-[var(--text-muted)]">
                Axelsen vs Momota
              </span>
            </div>
            <div className="grid gap-4 p-[18px] md:grid-cols-2">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
                <div className="mb-4 font-display text-[13.5px] font-semibold text-[var(--text-strong)]">
                  Highlight filters
                </div>
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-[9px]">
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
                      Shot type
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(45,212,167,0.16)] px-[9px] py-1 text-[12px] text-[var(--text-strong)]">
                        <span className="h-[7px] w-[7px] rounded-sm bg-[#f4515c]" />
                        Smash
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-[9px] py-1 text-[12px] text-[var(--text-secondary)]">
                        <span className="h-[7px] w-[7px] rounded-sm bg-[#2dd4a7]" />
                        Net
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-[9px] py-1 text-[12px] text-[var(--text-secondary)]">
                        <span className="h-[7px] w-[7px] rounded-sm bg-[#fbbf24]" />
                        Drive
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-[var(--text-secondary)]">
                        Speed ≥
                      </span>
                      <span className="font-mono text-[12px] tabular-nums text-[#2dd4a7]">
                        300 km/h
                      </span>
                    </div>
                    <div className="relative h-1 rounded-full bg-[var(--surface-3,#1b2744)]">
                      <div className="absolute inset-y-0 left-0 w-[83%] rounded-full bg-[#2dd4a7]" />
                      <div className="absolute left-[83%] top-1/2 h-[13px] w-[13px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#2dd4a7] shadow-[0_0_0_3px_rgba(45,212,167,0.25)]" />
                    </div>
                  </div>
                  <div className="flex flex-col gap-[9px]">
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
                      Outcome
                    </span>
                    <div className="flex gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-[3px]">
                      <span className="flex-1 rounded-md px-2 py-1 text-center text-[12px] text-[var(--text-muted)]">
                        Any
                      </span>
                      <span className="flex-1 rounded-md bg-[#2dd4a7] px-2 py-1 text-center text-[12px] font-semibold text-[#06281f]">
                        Winners
                      </span>
                      <span className="flex-1 rounded-md px-2 py-1 text-center text-[12px] text-[var(--text-muted)]">
                        Errors
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
                <div className="mb-3.5 flex items-baseline gap-2">
                  <span className="font-display text-[22px] font-semibold tracking-[-0.02em] tabular-nums text-[var(--text-strong)]">
                    6 clips
                  </span>
                  <span className="font-mono text-[12px] text-[var(--text-muted)]">
                    · 1:40 in reel
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {REEL.map((c) => (
                    <div
                      key={c.n}
                      className="flex items-center gap-2.5 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-1)] px-[11px] py-[9px]"
                      style={{ opacity: c.dim ? 0.5 : 1 }}
                    >
                      <span className="min-w-5 font-mono text-[13px] font-semibold tabular-nums text-[var(--text-secondary)]">
                        {c.n}
                      </span>
                      <span className="h-[7px] w-[7px] flex-none rounded-full bg-[#f4515c]" />
                      <span className="min-w-0 flex-1 text-[12.5px] text-[var(--text-strong)]">
                        {c.name}
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-[#2dd4a7]">
                        {c.speed}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-auto flex items-center gap-2.5 pt-4">
                  <span className="inline-flex h-[34px] items-center gap-1.5 rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[12.5px] text-[var(--text-secondary)]">
                    <Play className="h-3.5 w-3.5 text-[#2dd4a7]" />
                    Preview reel
                  </span>
                  <div className="flex-1" />
                  <span className="inline-flex h-[34px] items-center gap-1.5 rounded-[9px] bg-[#2dd4a7] px-[13px] text-[12.5px] font-semibold text-[#06281f]">
                    <Share2 className="h-3.5 w-3.5" />
                    Share
                  </span>
                </div>
              </div>
            </div>
          </div>
        </Reveal>

        <div className="mt-10">
          <Reveal>
            <HighlightsDemo />
          </Reveal>
        </div>
      </section>

      <section className="mx-auto max-w-[1180px] px-8 pb-[140px] pt-[110px]">
        <Reveal
          className="grid items-center gap-10 rounded-[20px] border border-[var(--border)] p-[52px] md:grid-cols-2"
          style={{
            background:
              "radial-gradient(120% 140% at 0% 0%, rgba(45,212,167,0.14), transparent 55%), var(--surface-1)",
          }}
        >
          <div>
            <h2 className="max-w-[16ch] font-display text-[clamp(26px,3.2vw,38px)] font-semibold leading-[1.08] tracking-[-0.025em] text-[var(--text-strong)] text-balance">
              A reel your whole squad can watch.
            </h2>
            <p className="mt-4 max-w-[46ch] text-[15.5px] leading-[1.6] text-[var(--text-secondary)]">
              Share generates a link that respects your library permissions —
              players, coaches, anyone, no account needed. Revoke it any time.
            </p>
            <div className="mt-[26px]">
              <Link href="/auth">
                <Button size="lg">Build your first reel</Button>
              </Link>
            </div>
          </div>
          <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-2)] p-[18px]">
            <div className="flex items-center gap-2.5 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-1)] px-[13px] py-[11px]">
              <Share2 className="h-4 w-4 text-[#2dd4a7]" />
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-[var(--text-secondary)]">
                mintonix.com/r/smashes-300
              </span>
              <span className="rounded-md bg-[#2dd4a7] px-2 py-1 text-[11px] font-semibold text-[#06281f]">
                Copy
              </span>
            </div>
            <p className="mt-3 text-[13px] leading-[1.55] text-[var(--text-muted)]">
              Anyone with the link can play the reel. No sign-in required.
            </p>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
