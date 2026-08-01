import type { Metadata } from "next";
import Link from "next/link";
import {
  BarChart3,
  Check,
  Swords,
  Trophy,
  Users,
} from "lucide-react";
import { Reveal } from "@/components/marketing/reveal";
import { AnalysisDemo } from "@/components/marketing/analysis-demo";

export const metadata: Metadata = {
  title: "Mintonix — BWF match analysis",
  description:
    "Browse and analyze BWF tournament matches — real scores, players, head-to-head records, and match video from the official catalog.",
};

export default function HomePage() {
  return (
    <div className="overflow-x-clip">
      {/* Hero */}
      <section className="relative">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 70% at 50% -8%, rgba(54,147,255,0.18), transparent 58%)",
          }}
        />
        <div
          id="mx-herogrid"
          className="pointer-events-none absolute inset-x-0 -top-[140px] bottom-0 opacity-50"
          style={{
            backgroundImage:
              "linear-gradient(rgba(54,147,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(54,147,255,0.05) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
            maskImage:
              "radial-gradient(90% 60% at 50% 0%, #000 30%, transparent 75%)",
            WebkitMaskImage:
              "radial-gradient(90% 60% at 50% 0%, #000 30%, transparent 75%)",
          }}
        />

        <div className="relative mx-auto max-w-[1320px] px-8 pb-0 pt-[104px] text-center">
          <div className="mb-5 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--accent)]">
            BWF catalog · live data
          </div>
          <h1 className="mx-auto max-w-[22ch] text-center font-display text-[clamp(38px,5.4vw,68px)] font-semibold leading-[1.05] tracking-[-0.03em] text-[var(--text-strong)]">
            Analyze BWF matches.
            <br />
            Not guesswork.
          </h1>
          <p className="mx-auto mt-5 max-w-[54ch] text-center text-[clamp(15px,1.6vw,18px)] leading-[1.6] text-[var(--text-secondary)]">
            Mintonix is a BWF match analysis site — real tournament results,
            player careers, head-to-head records, and YouTube match video wired
            to the catalog. Free to explore. No account required.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/bwf"
              className="inline-flex h-12 items-center justify-center rounded-[10px] bg-[var(--brand)] px-6 text-[15px] font-medium text-[var(--text-on-blue,#fff)] transition-colors hover:bg-[var(--brand-hover)]"
            >
              Open the BWF catalog
            </Link>
            <Link
              href="/bwf/matches"
              className="inline-flex h-12 items-center justify-center rounded-[10px] border border-[var(--border)] bg-transparent px-6 text-[15px] font-medium text-[var(--text-strong)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]"
            >
              Browse matches
            </Link>
          </div>

          <div
            id="analysis"
            className="relative mx-auto mt-24 max-w-[1256px] text-left"
          >
            <div
              className="pointer-events-none absolute -inset-px rounded-2xl"
              style={{
                boxShadow:
                  "0 0 0 1px rgba(54,147,255,0.22), 0 30px 90px rgba(54,147,255,0.18)",
              }}
            />
            <Link
              href="/bwf"
              className="relative block transition-transform duration-200 hover:-translate-y-0.5"
            >
              <AnalysisDemo />
            </Link>
            <p className="mt-3 text-center font-mono text-[11px] text-[var(--text-muted)]">
              Product preview · full match video and stats live in the BWF
              catalog
            </p>
          </div>
        </div>
      </section>

      {/* Pillars */}
      <section className="relative mx-auto max-w-[1320px] px-8 pt-[120px]">
        <Reveal className="max-w-[640px]">
          <div className="mb-3.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--accent)]">
            What you can do
          </div>
          <h2 className="font-display text-[clamp(28px,3.6vw,44px)] font-semibold leading-[1.1] tracking-[-0.025em] text-[var(--text-strong)] text-balance">
            The BWF archive, structured for analysis.
          </h2>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 gap-[18px] md:grid-cols-3">
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
              body: "Career rollups from catalog results — win rates, form, and rivalries derived from real match rows, not fantasy rankings.",
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
              className="mx-pillar flex flex-col rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-[26px] shadow-[var(--shadow-edge)]"
            >
              <Link href={p.href} className="flex flex-1 flex-col text-left">
                <span className="mx-pillar-icon inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[11px] border border-[var(--border)] bg-[var(--accent-soft)] text-[var(--accent)]">
                  <p.icon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <div className="mt-[18px] flex flex-col gap-[9px]">
                  <h3 className="font-display text-[19px] font-semibold tracking-[-0.01em] text-[var(--text-strong)]">
                    {p.title}
                  </h3>
                  <p className="text-[14.5px] leading-[1.6] text-[var(--text-secondary)]">
                    {p.body}
                  </p>
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="relative mx-auto max-w-[1320px] px-8 pt-[120px]">
        <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-2 lg:gap-16">
          <Reveal>
            <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--accent)]">
              How it works
            </div>
            <h2 className="max-w-[18ch] font-display text-[clamp(28px,3.8vw,46px)] font-semibold leading-[1.06] tracking-[-0.03em] text-[var(--text-strong)] text-balance">
              From BWF results to something you can actually use.
            </h2>
            <p className="mt-[18px] max-w-[46ch] text-base leading-[1.6] text-[var(--text-secondary)]">
              We load public BWF match rows, normalize scores and rosters, and
              surface them as boards, profiles, and match pages — with YouTube
              embeds when a source URL is available.
            </p>
            <div className="mt-[30px]">
              <Link
                href="/features/bwf"
                className="inline-flex h-11 items-center justify-center rounded-[10px] border border-[var(--border)] px-5 text-[14px] font-medium text-[var(--text-strong)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]"
              >
                Read how the BWF library works
              </Link>
            </div>
            <div className="mt-[26px] flex flex-wrap items-center gap-[18px]">
              {["No account required", "Real tournament data"].map((label) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1.5 text-[13px] text-[var(--text-muted)]"
                >
                  <Check
                    className="h-[15px] w-[15px] text-[var(--accent)]"
                    strokeWidth={2}
                  />
                  {label}
                </span>
              ))}
            </div>
          </Reveal>

          <Reveal className="rounded-2xl border border-[var(--border)] bg-[rgba(10,16,32,0.55)] p-[22px] shadow-[var(--shadow-edge)]">
            <div className="border-b border-[var(--border-subtle)] px-1 pb-3.5 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
              Catalog path
            </div>
            {[
              {
                n: "1",
                t: "Ingest BWF matches",
                d: "Tournament results and metadata land in the shared catalog.",
              },
              {
                n: "2",
                t: "Structure for analysis",
                d: "Disciplines, rounds, winners, and player IDs for search and H2H.",
              },
              {
                n: "3",
                t: "Watch & compare",
                d: "Open a match page for video, then jump to players and rivalries.",
              },
            ].map((s, i, arr) => (
              <div
                key={s.n}
                className={`flex items-start gap-3.5 px-1 py-4 ${i < arr.length - 1 ? "border-b border-[var(--border-subtle)]" : "pb-1"}`}
              >
                <span className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] border border-[var(--border)] bg-[var(--accent-soft)] font-mono text-[13px] font-semibold text-[var(--accent)]">
                  {s.n}
                </span>
                <div>
                  <div className="font-display text-[15px] font-semibold text-[var(--text-strong)]">
                    {s.t}
                  </div>
                  <div className="mt-0.5 text-[13.5px] leading-[1.5] text-[var(--text-secondary)]">
                    {s.d}
                  </div>
                </div>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      {/* Closing */}
      <section className="mx-auto max-w-[1320px] px-8 pb-[140px] pt-[120px]">
        <Reveal className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] px-8 py-14 text-center shadow-[var(--shadow-edge)]">
          <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--accent)]">
            Start here
          </div>
          <h2 className="mx-auto max-w-[20ch] font-display text-[clamp(28px,3.6vw,40px)] font-semibold leading-[1.1] tracking-[-0.025em] text-[var(--text-strong)]">
            Open a BWF match and dig in.
          </h2>
          <p className="mx-auto mt-4 max-w-[48ch] text-base leading-[1.6] text-[var(--text-secondary)]">
            Leaderboards, full match lists, player profiles, and head-to-head —
            all computed from the catalog.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/bwf"
              className="inline-flex h-12 items-center justify-center rounded-[10px] bg-[var(--brand)] px-6 text-[15px] font-medium text-white hover:bg-[var(--brand-hover)]"
            >
              Explore BWF home
            </Link>
            <Link
              href="/bwf/h2h"
              className="inline-flex h-12 items-center justify-center rounded-[10px] border border-[var(--border)] px-6 text-[15px] font-medium text-[var(--text-strong)] hover:bg-[var(--surface-2)]"
            >
              Try head-to-head
            </Link>
          </div>
          <div className="mt-6 inline-flex items-center gap-2 text-[13px] text-[var(--text-muted)]">
            <BarChart3 className="h-4 w-4 text-[var(--accent)]" />
            Analysis tools for private uploads are not part of this public
            experience.
          </div>
        </Reveal>
      </section>
    </div>
  );
}
