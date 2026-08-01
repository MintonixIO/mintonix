import type { Metadata } from "next";
import Link from "next/link";
import { Swords, Trophy, Users } from "lucide-react";
import { Reveal } from "@/components/marketing/reveal";
import { BwfHeroTeaser } from "@/components/marketing/bwf-hero-teaser";
import { getCatalogStats } from "@/lib/bwf/catalog";
import type { HomeStats } from "@/lib/bwf/types";

export const metadata: Metadata = {
  title: "Mintonix — BWF match analysis",
  description:
    "Browse BWF tournament matches, players, and head-to-head — free, no account.",
};

export const revalidate = 300;

export default async function HomePage() {
  let stats: HomeStats | null = null;
  try {
    const full = await getCatalogStats();
    stats = {
      matches: full.matches,
      players: full.players,
      tournaments: full.tournaments,
      withVideo: full.withVideo,
      byDisc: full.byDisc,
    };
  } catch {
    stats = null;
  }

  return (
    <div className="overflow-x-clip">
      <section className="relative">
        <div className="relative mx-auto max-w-[1320px] px-5 pb-0 pt-20 text-center sm:px-8 sm:pt-[104px]">
          <div className="mb-5 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--accent)]">
            BWF catalog · live data
          </div>
          <h1 className="mx-auto max-w-[22ch] text-balance text-center font-display text-[clamp(36px,5.4vw,68px)] font-semibold leading-[1.05] tracking-[-0.03em] text-[var(--text-strong)]">
            Analyze BWF matches.
            <br />
            Not guesswork.
          </h1>
          <p className="mx-auto mt-5 max-w-[40ch] text-pretty text-center text-[clamp(15px,1.6vw,18px)] leading-[1.55] text-[var(--text-secondary)]">
            Real tournament results, player records, and match video when
            available — free to explore.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/bwf"
              className="inline-flex min-h-12 items-center justify-center rounded-[10px] bg-[var(--brand)] px-6 text-[15px] font-medium text-[var(--text-on-blue)] transition-colors hover:bg-[var(--brand-hover)]"
            >
              Open the BWF catalog
            </Link>
            <Link
              href="/bwf/matches"
              className="inline-flex min-h-12 items-center justify-center rounded-[10px] border border-[var(--border)] bg-transparent px-6 text-[15px] font-medium text-[var(--text-strong)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]"
            >
              Browse matches
            </Link>
          </div>

          <div id="analysis" className="relative mx-auto mt-14 max-w-[1100px] text-left sm:mt-16">
            <BwfHeroTeaser stats={stats} />
          </div>
        </div>
      </section>

      <section className="relative mx-auto max-w-[1320px] px-5 pt-20 sm:px-8 sm:pt-[100px]">
        <Reveal className="max-w-[640px]">
          <div className="mb-3.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--accent)]">
            What you can do
          </div>
          <h2 className="text-balance font-display text-[clamp(28px,3.6vw,44px)] font-semibold leading-[1.1] tracking-[-0.025em] text-[var(--text-strong)]">
            The BWF archive, structured for analysis.
          </h2>
        </Reveal>

        <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-[18px]">
          {[
            {
              icon: Trophy,
              title: "Tournament matches",
              body: "Filter by event, discipline, round, and year. Open any match for scorelines, rosters, and linked video when available.",
              href: "/bwf/matches",
            },
            {
              icon: Users,
              title: "Player directory",
              body: "Career rollups from catalog results — win rates, form, and rivalries derived from real match rows.",
              href: "/bwf/players",
            },
            {
              icon: Swords,
              title: "Head-to-head",
              body: "Pick any two players and see every meeting in the loaded catalog with scorelines and event context.",
              href: "/bwf/h2h",
            },
          ].map((p) => (
            <Reveal
              key={p.title}
              as="article"
              className="mx-pillar flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-6 shadow-[var(--shadow-ring-card)]"
            >
              <Link href={p.href} className="flex flex-1 flex-col text-left">
                <span className="mx-pillar-icon inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] border border-[var(--border)] bg-[var(--accent-soft)] text-[var(--accent)]">
                  <p.icon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <div className="mt-4 flex flex-col gap-2">
                  <h3 className="font-display text-lg font-semibold tracking-[-0.01em] text-[var(--text-strong)]">
                    {p.title}
                  </h3>
                  <p className="text-pretty text-sm leading-[1.6] text-[var(--text-secondary)]">
                    {p.body}
                  </p>
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[720px] px-5 pb-24 pt-20 text-center sm:px-8 sm:pb-28 sm:pt-24">
        <h2 className="text-balance font-display text-[clamp(26px,3.4vw,36px)] font-semibold leading-[1.12] tracking-[-0.025em] text-[var(--text-strong)]">
          Ready to dig into a match?
        </h2>
        <p className="mx-auto mt-3 max-w-[36ch] text-pretty text-[15px] leading-[1.55] text-[var(--text-secondary)]">
          Jump into the catalog — no account required.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/bwf"
            className="inline-flex min-h-12 items-center justify-center rounded-[10px] bg-[var(--brand)] px-6 text-[15px] font-medium text-[var(--text-on-blue)] hover:bg-[var(--brand-hover)]"
          >
            Explore BWF home
          </Link>
          <Link
            href="/bwf/h2h"
            className="inline-flex min-h-12 items-center justify-center rounded-[10px] border border-[var(--border)] px-6 text-[15px] font-medium text-[var(--text-strong)] hover:bg-[var(--surface-2)]"
          >
            Try head-to-head
          </Link>
        </div>
      </section>
    </div>
  );
}
