import Link from "next/link";
import {
  GitCompare,
  Layers,
  Play,
  Trophy,
  Unlock,
} from "lucide-react";
import {
  FeatureCTA,
  FeatureHero,
  FeatureSection,
  FeatureValueGrid,
} from "@/components/marketing/feature-page";
import { Reveal } from "@/components/marketing/reveal";

export const metadata = { title: "BWF library" };

const VALUE_PROPS = [
  {
    icon: Unlock,
    title: "Nothing to upload",
    body: "Finished BWF results are already in the catalog — browse free, no account.",
  },
  {
    icon: Layers,
    title: "Structured match data",
    body: "Scores, disciplines, rounds, rosters, and YouTube links when a source is allowlisted.",
  },
  {
    icon: GitCompare,
    title: "Built for comparison",
    body: "Open head-to-head to see every shared meeting between two players in the catalog.",
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
    bg: "linear-gradient(135deg,var(--brand),#1e7bf0)",
  },
];

const COVERAGE = [
  {
    big: "Live",
    label: "Catalog counts load from the public BWF match table.",
  },
  {
    big: "H2H",
    label: "Meetings computed from real match rows, not fantasy rankings.",
  },
  { big: "YT", label: "Video embeds only when the source is allowlisted YouTube." },
  { big: "$0", label: "to explore — free, no account required." },
];

export default function FeatureBwfPage() {
  return (
    <div className="overflow-x-clip">
      <div className="border-b border-[rgba(54,147,255,0.28)] bg-[rgba(54,147,255,0.08)] px-4 py-2.5 text-center text-[12.5px] text-[var(--text-secondary)]">
        <strong className="font-medium text-[var(--text-strong)]">Live product.</strong>{" "}
        The BWF catalog is available now — no account required.
      </div>
      <FeatureHero
        EyebrowIcon={Trophy}
        eyebrow="BWF match library"
        eyebrowClassName="bg-[var(--accent-soft)] text-[var(--accent)]"
        titleClassName="max-w-[15ch]"
        title="BWF analysis, ready to browse."
        body="Browse a full catalog of BWF tournament matches — real scores, players, head-to-head records, and match video when a source is available. Free to explore, no account required."
        ctas={[
          { href: "/bwf", label: "Explore the library" },
          {
            href: "/bwf/h2h",
            label: "Compare two players",
            variant: "outline",
          },
        ]}
        glow="radial-gradient(110% 60% at 50% -10%, rgba(54,147,255,0.10), transparent 56%)"
        gridClassName="grid items-center gap-10 lg:grid-cols-2 lg:gap-14"
      >
        <div className="relative overflow-hidden rounded-[18px] border border-[var(--border)] bg-[linear-gradient(150deg,#14182b,#0a1120)] shadow-[var(--shadow-xl)]">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "repeating-linear-gradient(45deg, rgba(54,147,255,0.04) 0 12px, transparent 12px 24px)",
            }}
          />
          <div className="relative p-[22px]">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--accent)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                Featured · final
              </span>
              <span className="font-mono text-[11px] text-[var(--text-muted)]">
                All England 2026
              </span>
            </div>
            <div className="mt-[22px] flex items-center gap-3.5">
              <div className="flex-1 text-center">
                <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-[linear-gradient(135deg,#3693ff,#1f5fb0)] font-display text-lg font-semibold text-[var(--text-on-blue)]">
                  VA
                </div>
                <div className="mt-2.5 font-display text-[15px] font-semibold text-[var(--text-strong)]">
                  Axelsen
                </div>
                <div className="font-mono text-[11px] text-[var(--text-muted)]">
                  DEN · #1
                </div>
              </div>
              <div className="text-center font-display text-[22px] font-semibold tabular-nums tracking-wide text-[var(--accent)]">
                21–18
                <span className="mt-0.5 block text-center text-[13px] text-[var(--text-muted)]">
                  21–16
                </span>
              </div>
              <div className="flex-1 text-center">
                <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-[linear-gradient(135deg,#f4515c,#a82b34)] font-display text-lg font-semibold text-[var(--text-on-blue)]">
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
                { v: "MS", k: "Discipline" },
                { v: "F", k: "Round" },
                { v: "YT", k: "Video when linked" },
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
              className="mt-[18px] flex min-h-11 items-center justify-center gap-2 rounded-[10px] bg-[var(--brand)] text-[13.5px] font-semibold text-[var(--text-on-blue)]"
            >
              <Play className="h-[15px] w-[15px]" />
              Open in catalog
            </Link>
          </div>
        </div>
      </FeatureHero>

      <FeatureSection className="pt-24">
        <FeatureValueGrid
          iconWrapClassName="bg-[rgba(54,147,255,0.16)] text-[var(--accent)]"
          cardClassName="transition-none hover:translate-y-0"
          items={VALUE_PROPS}
        />
      </FeatureSection>

      <FeatureSection
        className="pt-[116px]"
        eyebrow="Marquee matches"
        eyebrowClassName="text-[var(--accent)]"
        title="Sample match layouts — open the live catalog for real rows."
        headerAside={
          <Link
            href="/bwf"
            className="text-[13.5px] font-medium text-[var(--accent)] no-underline hover:underline"
          >
            Browse all →
          </Link>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MATCHES.map((m) => (
            <Reveal
              key={m.title}
              className="group overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] transition-transform hover:-translate-y-0.5"
            >
              {/* Illustration cards — not live match IDs */}
              <div
                className="relative h-[120px] border-b border-[var(--border-subtle)] p-4"
                style={{
                  background: `linear-gradient(145deg, ${m.g1}, ${m.g2})`,
                }}
              >
                <span className="inline-flex rounded-full border border-[rgba(54,147,255,0.35)] bg-[rgba(54,147,255,0.16)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--accent)]">
                  Sample · {m.tag}
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
      </FeatureSection>

      <FeatureSection
        className="pt-[116px]"
        eyebrow="Player profiles"
        eyebrowClassName="text-[var(--accent)]"
        title="Follow a player across every match."
        headerClassName="mb-8 max-w-[640px]"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PLAYERS.map((p) => (
            <Reveal
              key={p.name}
              className="flex items-center gap-3 rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-4 transition-transform hover:-translate-y-0.5"
            >
              <span
                className="inline-flex h-12 w-12 flex-none items-center justify-center rounded-full font-display text-[15px] font-semibold text-[var(--text-on-blue)]"
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
      </FeatureSection>

      <FeatureSection className="pt-[116px]">
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
      </FeatureSection>

      <FeatureCTA
        className="pt-[100px]"
        title="The whole tour, opened up."
        body="Open any match in the catalog. No upload and no sign-in required."
        ctas={[
          { href: "/bwf", label: "Open the BWF library" },
          {
            href: "/bwf/players",
            label: "Player directory",
            variant: "outline",
          },
        ]}
        glow="radial-gradient(120% 140% at 50% -20%, rgba(54,147,255,0.12), transparent 60%), var(--surface-1)"
      />
    </div>
  );
}
