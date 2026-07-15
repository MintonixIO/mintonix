import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, Check, Film, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/marketing/reveal";
import { AnalysisDemo } from "@/components/marketing/analysis-demo";
import { DashboardDemo } from "@/components/marketing/dashboard-demo";
import { HighlightsDemo } from "@/components/marketing/highlights-demo";

export const metadata: Metadata = {
  title: "Mintonix — Badminton analysis engine",
  description:
    "Mintonix turns your footage into data for analysis and summary — rallies, heatmaps, and head-to-head metrics in one library.",
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
          {/* Hard line break matches design; avoid text-balance (fights the <br />). */}
          <h1 className="mx-auto max-w-[20ch] text-center font-display text-[clamp(38px,5.4vw,68px)] font-semibold leading-[1.05] tracking-[-0.03em] text-[var(--text-strong)]">
            See every rally.
            <br />
            Understand every match.
          </h1>
          <p className="mx-auto mt-5 max-w-[54ch] text-center text-[clamp(15px,1.6vw,18px)] leading-[1.6] text-[var(--text-secondary)]">
            Mintonix turns your footage into data for analysis and summary, all
            stored in one library, shareable with a link, and ready to replay
            frame by frame, rally by rally.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link href="/auth">
              <Button variant="primary" size="lg">
                Start analyzing
              </Button>
            </Link>
            <Link href="/bwf">
              <Button variant="outline" size="lg">
                Explore the BWF match library
              </Button>
            </Link>
          </div>

          <div id="analysis" className="relative mx-auto mt-24 max-w-[1256px] text-left">
            <div
              className="pointer-events-none absolute -inset-px rounded-2xl"
              style={{
                boxShadow:
                  "0 0 0 1px rgba(54,147,255,0.22), 0 30px 90px rgba(54,147,255,0.18)",
              }}
            />
            <Link
              href="/video-analysis"
              className="relative block transition-transform duration-200 hover:-translate-y-0.5"
            >
              <AnalysisDemo />
            </Link>
          </div>
        </div>
      </section>

      {/* Pillars */}
      <section className="relative mx-auto max-w-[1320px] px-8 pt-[120px]">
        <Reveal className="max-w-[640px]">
          <div className="mb-3.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--accent)]">
            What you get
          </div>
          <h2 className="font-display text-[clamp(28px,3.6vw,44px)] font-semibold leading-[1.1] tracking-[-0.025em] text-[var(--text-strong)] text-balance">
            One engine, from footage to insight.
          </h2>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 gap-[18px] md:grid-cols-3">
          {[
            {
              icon: BarChart3,
              title: "In-depth analysis",
              body: "Rally-by-rally breakdowns, shot distributions, heatmaps, and strategies. See the pattern behind the score.",
            },
            {
              icon: PlayCircle,
              title: "Replay & review",
              body: "Scrub any rally, jump to any point, and overlay the data on the footage. Watch the match the way it was played.",
            },
            {
              icon: Film,
              title: "Instant highlights",
              body: "Filter by shot, speed, or outcome and Mintonix assembles a shareable reel in seconds — no scrubbing, no editing.",
            },
          ].map((p) => (
            <Reveal
              key={p.title}
              as="article"
              className="mx-pillar flex flex-col rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-[26px] shadow-[var(--shadow-edge)]"
            >
              <span className="mx-pillar-icon inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[11px] border border-[var(--border)] bg-[var(--accent-soft)] text-[var(--accent)]">
                <p.icon className="h-5 w-5" strokeWidth={1.75} />
              </span>
              {/* gap (not h3 margin) so spacing survives heading resets */}
              <div className="mt-[18px] flex flex-col gap-[9px]">
                <h3 className="font-display text-[19px] font-semibold tracking-[-0.01em] text-[var(--text-strong)]">
                  {p.title}
                </h3>
                <p className="text-[14.5px] leading-[1.6] text-[var(--text-secondary)]">
                  {p.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Highlights showcase */}
      <section id="highlights" className="relative mx-auto max-w-[1320px] px-8 pt-[120px]">
        <Reveal className="mx-auto mb-11 max-w-[680px] text-center">
          <div className="mb-3.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--accent)]">
            Highlight reels
          </div>
          <h2 className="font-display text-[clamp(28px,3.6vw,44px)] font-semibold leading-[1.1] tracking-[-0.025em] text-[var(--text-strong)] text-balance">
            Find the moments. Build the reel.
          </h2>
          <p className="mx-auto mt-[18px] max-w-[54ch] text-base leading-[1.65] text-[var(--text-secondary)]">
            Set the criteria — a shot type, a speed threshold, an outcome — and
            every matching clip collapses into one reel. Trim it, preview it,
            and share it with a single link.
          </p>
        </Reveal>

        <Reveal className="relative mx-auto max-w-[1100px]">
          <div
            className="pointer-events-none absolute -inset-px rounded-2xl"
            style={{
              boxShadow:
                "0 0 0 1px rgba(54,147,255,0.18), 0 30px 90px rgba(54,147,255,0.14)",
            }}
          />
          <Link
            href="/dashboard/highlights"
            className="relative block transition-transform duration-200 hover:-translate-y-0.5"
          >
            <HighlightsDemo />
          </Link>
        </Reveal>
      </section>

      {/* Dashboard showcase */}
      <section id="library" className="relative mx-auto max-w-[1320px] px-8 pt-[120px]">
        <Reveal className="mx-auto mb-11 max-w-[680px] text-center">
          <div className="mb-3.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--accent)]">
            Your workspace
          </div>
          <h2 className="font-display text-[clamp(28px,3.6vw,44px)] font-semibold leading-[1.1] tracking-[-0.025em] text-[var(--text-strong)] text-balance">
            Every match in one dashboard.
          </h2>
          <p className="mx-auto mt-[18px] max-w-[52ch] text-base leading-[1.65] text-[var(--text-secondary)]">
            Upload footage and Mintonix files it as a fully analyzed match. Track
            what&apos;s processing, jump back into recent breakdowns, and share any
            match with a single link.
          </p>
        </Reveal>
        <Reveal className="relative mx-auto max-w-[1256px]">
          <div
            className="pointer-events-none absolute -inset-px rounded-2xl"
            style={{
              boxShadow:
                "0 0 0 1px rgba(54,147,255,0.18), 0 30px 90px rgba(54,147,255,0.14)",
            }}
          />
          <Link
            href="/dashboard"
            className="relative block transition-transform duration-200 hover:-translate-y-0.5"
          >
            <DashboardDemo />
          </Link>
        </Reveal>
      </section>

      {/* Closing CTA */}
      <section id="replay" className="mx-auto max-w-[1320px] px-8 pb-[140px] pt-[120px]">
        <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-2 lg:gap-16">
          <Reveal>
            <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--accent)]">
              Get started
            </div>
            <h2 className="max-w-[16ch] font-display text-[clamp(28px,3.8vw,46px)] font-semibold leading-[1.06] tracking-[-0.03em] text-[var(--text-strong)] text-balance">
              Upload a match. Get the breakdown.
            </h2>
            <p className="mt-[18px] max-w-[46ch] text-base leading-[1.6] text-[var(--text-secondary)]">
              Drop in your first piece of footage and watch Mintonix turn it into
              rallies, heatmaps, and head-to-head metrics in minutes — or start
              from a pro match in the BWF library.
            </p>
            <div className="mt-[30px] flex flex-wrap items-center gap-3">
              <Link href="/auth">
                <Button variant="primary" size="lg">
                  Analyze your first match
                </Button>
              </Link>
              <Link href="/bwf">
                <Button variant="ghost" size="lg">
                  Browse BWF matches
                </Button>
              </Link>
            </div>
            <div className="mt-[26px] flex flex-wrap items-center gap-[18px]">
              {["No credit card", "Share with one link"].map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1.5 text-[13px] text-[var(--text-muted)]"
                >
                  <Check
                    className="h-[15px] w-[15px] text-[var(--accent)]"
                    strokeWidth={2}
                  />
                  {t}
                </span>
              ))}
            </div>
          </Reveal>

          <Reveal className="rounded-2xl border border-[var(--border)] bg-[rgba(10,16,32,0.55)] p-[22px] shadow-[var(--shadow-edge)]">
            <div className="border-b border-[var(--border-subtle)] px-1 pb-3.5 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
              From upload to insight
            </div>
            {[
              {
                n: "1",
                t: "Upload footage",
                d: "Drag in a video file or a shot-data export.",
              },
              {
                n: "2",
                t: "Mintonix analyzes",
                d: "Rallies, movement, and metrics, built automatically.",
              },
              {
                n: "3",
                t: "Review & share",
                d: "Replay any rally and send a link to your team.",
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
    </div>
  );
}
