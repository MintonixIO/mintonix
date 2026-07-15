import Link from "next/link";
import {
  GitCompare,
  Layers,
  Play,
  Trophy,
  Unlock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/marketing/reveal";

export const metadata = { title: "BWF library" };

const VALUE_PROPS = [
  {
    icon: Unlock,
    title: "Nothing to upload",
    body: "The library is analyzed and waiting — sign in and start studying immediately.",
  },
  {
    icon: Layers,
    title: "Same depth as your matches",
    body: "Rallies, shot data, heatmaps and speeds — the full Mintonix breakdown on every match.",
  },
  {
    icon: GitCompare,
    title: "Built for comparison",
    body: "Line a pro up against your own footage to see exactly where the gap is.",
  },
];

const MATCHES = [
  {
    tag: "Final",
    score: "21–18, 21–16",
    title: "Axelsen vs Momota",
    event: "All England 2026",
    insight: "Won at the net",
    g1: "#1c2a4a",
    g2: "#0d1730",
  },
  {
    tag: "Semi",
    score: "21–19, 19–21, 21–17",
    title: "Shi vs Antonsen",
    event: "World Tour Finals",
    insight: "3-game decider",
    g1: "#2a1f3f",
    g2: "#0d1024",
  },
  {
    tag: "Final",
    score: "21–14, 21–12",
    title: "An vs Yamaguchi",
    event: "Indonesia Open",
    insight: "Dominant defence",
    g1: "#3a2418",
    g2: "#190f0a",
  },
  {
    tag: "QF",
    score: "24–22, 21–19",
    title: "Ginting vs Chou",
    event: "Malaysia Masters",
    insight: "Two tight games",
    g1: "#14302a",
    g2: "#0a1a16",
  },
  {
    tag: "Final",
    score: "21–17, 21–18",
    title: "Lee vs Naraoka",
    event: "Japan Open",
    insight: "Pace off the smash",
    g1: "#1c2a4a",
    g2: "#0d1730",
  },
  {
    tag: "Semi",
    score: "21–15, 21–13",
    title: "Prannoy vs Lakshya",
    event: "India Open",
    insight: "Court coverage clinic",
    g1: "#3a1f24",
    g2: "#190a0d",
  },
];

const PLAYERS = [
  {
    in: "VA",
    name: "Viktor Axelsen",
    meta: "DEN · 14 matches",
    bg: "linear-gradient(135deg,#3693ff,#1f5fb0)",
  },
  {
    in: "KM",
    name: "Kento Momota",
    meta: "JPN · 11 matches",
    bg: "linear-gradient(135deg,#f4515c,#a82b34)",
  },
  {
    in: "SY",
    name: "Shi Yu Qi",
    meta: "CHN · 9 matches",
    bg: "linear-gradient(135deg,#2dd4a7,#157e63)",
  },
  {
    in: "AY",
    name: "Akane Yamaguchi",
    meta: "JPN · 12 matches",
    bg: "linear-gradient(135deg,#f5b43c,#c98a06)",
  },
];

const COVERAGE = [
  {
    big: "480+",
    label: "BWF singles matches analyzed and growing every week.",
  },
  {
    big: "60k",
    label: "rallies broken down shot by shot across the library.",
  },
  { big: "2014", label: "earliest broadcast match in the archive." },
  { big: "$0", label: "to explore — included with every free account." },
];

export default function FeatureBwfPage() {
  return (
    <div className="overflow-x-clip">
      <section className="relative">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(110% 60% at 50% -10%, rgba(245,180,60,0.12), transparent 56%)",
          }}
        />
        <div className="relative mx-auto max-w-[1320px] px-8 pt-[92px]">
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[rgba(245,180,60,0.16)] px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[#f5b43c]">
                <Trophy className="h-3.5 w-3.5" />
                BWF match library
              </div>
              <h1 className="mt-[22px] max-w-[15ch] font-display text-[clamp(36px,5vw,60px)] font-semibold leading-[1.04] tracking-[-0.03em] text-[var(--text-strong)] text-balance">
                No footage? Start with the pros.
              </h1>
              <p className="mt-5 max-w-[50ch] text-[clamp(15px,1.5vw,18px)] leading-[1.62] text-[var(--text-secondary)]">
                Every account opens with a full library of analyzed BWF singles
                matches — the same rallies, heatmaps, and shot data you&apos;d get
                from your own footage, ready the moment you sign in.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/bwf">
                  <Button size="lg">Explore the library</Button>
                </Link>
                <Link href="/dashboard/compare">
                  <Button variant="outline" size="lg">
                    Compare two players
                  </Button>
                </Link>
              </div>
            </div>

            <div className="relative overflow-hidden rounded-[18px] border border-[var(--border)] bg-[linear-gradient(150deg,#14182b,#0a1120)] shadow-[var(--shadow-xl)]">
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(45deg, rgba(245,180,60,0.04) 0 12px, transparent 12px 24px)",
                }}
              />
              <div className="relative p-[22px]">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-[#f5b43c]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#f5b43c]" />
                    Featured · final
                  </span>
                  <span className="font-mono text-[11px] text-[var(--text-muted)]">
                    All England 2026
                  </span>
                </div>
                <div className="mt-[22px] flex items-center gap-3.5">
                  <div className="flex-1 text-center">
                    <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-[linear-gradient(135deg,#3693ff,#1f5fb0)] font-display text-lg font-semibold text-white">
                      VA
                    </div>
                    <div className="mt-2.5 font-display text-[15px] font-semibold text-[var(--text-strong)]">
                      Axelsen
                    </div>
                    <div className="font-mono text-[11px] text-[var(--text-muted)]">
                      DEN · #1
                    </div>
                  </div>
                  <div className="text-center font-display text-[22px] font-semibold tabular-nums tracking-wide text-[#f5b43c]">
                    21–18
                    <span className="mt-0.5 block text-center text-[13px] text-[var(--text-muted)]">
                      21–16
                    </span>
                  </div>
                  <div className="flex-1 text-center">
                    <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-[linear-gradient(135deg,#f4515c,#a82b34)] font-display text-lg font-semibold text-white">
                      KM
                    </div>
                    <div className="mt-2.5 font-display text-[15px] font-semibold text-[var(--text-strong)]">
                      Momota
                    </div>
                    <div className="font-mono text-[11px] text-[var(--text-muted)]">
                      JPN · #4
                    </div>
                  </div>
                </div>
                <div className="mt-[22px] grid grid-cols-3 gap-2">
                  {[
                    { v: "148", k: "Rallies" },
                    { v: "334", k: "Smash max" },
                    { v: "9.4", k: "Avg length" },
                  ].map((f) => (
                    <div
                      key={f.k}
                      className="rounded-[10px] border border-[var(--border-subtle)] bg-[rgba(10,16,32,0.5)] p-[11px]"
                    >
                      <div className="font-display text-lg font-semibold tabular-nums text-[var(--text-strong)]">
                        {f.v}
                      </div>
                      <div className="mt-0.5 text-[10.5px] text-[var(--text-muted)]">
                        {f.k}
                      </div>
                    </div>
                  ))}
                </div>
                <Link
                  href="/bwf"
                  className="mt-[18px] flex h-10 items-center justify-center gap-2 rounded-[10px] bg-[#f5b43c] text-[13.5px] font-semibold text-[#2a1c00]"
                >
                  <Play className="h-[15px] w-[15px]" />
                  Open the breakdown
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1180px] px-8 pt-24">
        <div className="grid gap-4 md:grid-cols-3">
          {VALUE_PROPS.map((v) => (
            <Reveal
              key={v.title}
              className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-[22px]"
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-[11px] border border-[var(--border)] bg-[rgba(245,180,60,0.16)] text-[#f5b43c]">
                <v.icon className="h-[19px] w-[19px]" strokeWidth={1.75} />
              </span>
              <h3 className="mt-4 font-display text-base font-semibold text-[var(--text-strong)]">
                {v.title}
              </h3>
              <p className="mt-1.5 text-[13.5px] leading-[1.55] text-[var(--text-secondary)]">
                {v.body}
              </p>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1180px] px-8 pt-[116px]">
        <Reveal className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-[640px]">
            <div className="mb-3.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[#f5b43c]">
              Marquee matches
            </div>
            <h2 className="font-display text-[clamp(28px,3.4vw,42px)] font-semibold leading-[1.1] tracking-[-0.025em] text-[var(--text-strong)] text-balance">
              Marquee matches, already broken down.
            </h2>
          </div>
          <Link
            href="/bwf"
            className="text-[13.5px] font-medium text-[#f5b43c] no-underline hover:underline"
          >
            Browse all →
          </Link>
        </Reveal>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MATCHES.map((m) => (
            <Reveal
              key={m.title}
              className="group overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] transition-transform hover:-translate-y-0.5"
            >
              <div
                className="relative h-[120px] border-b border-[var(--border-subtle)] p-4"
                style={{
                  background: `linear-gradient(145deg, ${m.g1}, ${m.g2})`,
                }}
              >
                <span className="inline-flex rounded-full border border-[rgba(245,180,60,0.35)] bg-[rgba(245,180,60,0.16)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[#f5b43c]">
                  {m.tag}
                </span>
                <div className="absolute bottom-3 left-4 font-display text-[18px] font-semibold tabular-nums text-[var(--text-strong)]">
                  {m.score}
                </div>
              </div>
              <div className="p-4">
                <h3 className="font-display text-[15px] font-semibold text-[var(--text-strong)]">
                  {m.title}
                </h3>
                <div className="mt-1 font-mono text-[11px] text-[var(--text-muted)]">
                  {m.event}
                </div>
                <div className="mt-3 text-[12.5px] text-[var(--text-secondary)]">
                  {m.insight}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1180px] px-8 pt-[116px]">
        <Reveal className="mb-8 max-w-[640px]">
          <div className="mb-3.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[#f5b43c]">
            Player profiles
          </div>
          <h2 className="font-display text-[clamp(26px,3.2vw,38px)] font-semibold leading-[1.1] tracking-[-0.025em] text-[var(--text-strong)] text-balance">
            Follow a player across every match.
          </h2>
        </Reveal>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PLAYERS.map((p) => (
            <Reveal
              key={p.name}
              className="flex items-center gap-3 rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-4 transition-transform hover:-translate-y-0.5"
            >
              <span
                className="inline-flex h-12 w-12 flex-none items-center justify-center rounded-full font-display text-[15px] font-semibold text-white"
                style={{ background: p.bg }}
              >
                {p.in}
              </span>
              <div className="min-w-0">
                <div className="truncate font-display text-[14px] font-semibold text-[var(--text-strong)]">
                  {p.name}
                </div>
                <div className="font-mono text-[11px] text-[var(--text-muted)]">
                  {p.meta}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1180px] px-8 pt-[116px]">
        <Reveal className="grid gap-9 rounded-[18px] border border-[var(--border)] bg-[var(--surface-1)] p-10 shadow-[var(--shadow-edge)] sm:grid-cols-2 lg:grid-cols-4">
          {COVERAGE.map((c) => (
            <div key={c.big}>
              <div className="font-display text-[clamp(32px,3.6vw,42px)] font-semibold leading-none tracking-[-0.03em] tabular-nums text-[var(--text-strong)]">
                {c.big}
              </div>
              <div className="mt-3 text-[14px] leading-[1.5] text-[var(--text-secondary)]">
                {c.label}
              </div>
            </div>
          ))}
        </Reveal>
      </section>

      <section className="mx-auto max-w-[1180px] px-8 pb-[140px] pt-[100px]">
        <Reveal
          className="relative rounded-[20px] border border-[var(--border)] px-8 py-[72px] text-center"
          style={{
            background:
              "radial-gradient(120% 140% at 50% -20%, rgba(245,180,60,0.14), transparent 60%), var(--surface-1)",
          }}
        >
          <h2 className="mx-auto max-w-[18ch] font-display text-[clamp(28px,3.6vw,44px)] font-semibold leading-[1.08] tracking-[-0.03em] text-[var(--text-strong)] text-balance">
            The whole tour, opened up.
          </h2>
          <p className="mx-auto mt-4 max-w-[46ch] text-[16px] leading-[1.6] text-[var(--text-secondary)]">
            Included with every free account. No footage required — start from a
            final tonight.
          </p>
          <div className="mt-[30px] flex flex-wrap items-center justify-center gap-3">
            <Link href="/bwf">
              <Button size="lg">Open the BWF library</Button>
            </Link>
            <Link href="/auth">
              <Button variant="outline" size="lg">
                Create free account
              </Button>
            </Link>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
