import { Rss } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Changelog" };

type ChangeType = "New" | "Improved" | "Fixed";

const TYPE_STYLES: Record<ChangeType, { fg: string; bg: string; bd: string }> =
  {
    New: {
      fg: "#7fd7ff",
      bg: "rgba(80,222,255,0.12)",
      bd: "rgba(80,222,255,0.30)",
    },
    Improved: {
      fg: "#5ba8ff",
      bg: "rgba(54,147,255,0.12)",
      bd: "rgba(54,147,255,0.30)",
    },
    Fixed: {
      fg: "#7ee0bf",
      bg: "rgba(45,212,167,0.12)",
      bd: "rgba(45,212,167,0.30)",
    },
  };

const RELEASES: {
  version: string;
  date: string;
  latest?: boolean;
  title: string;
  summary: string;
  changes: { type: ChangeType; text: string }[];
}[] = [
  {
    version: "v0.9",
    date: "Aug 1, 2026",
    latest: true,
    title: "Public BWF catalog",
    summary:
      "The live site is a free BWF match analysis catalog — scores, players, H2H, and YouTube links. Private workspace tools remain preview/roadmap.",
    changes: [
      {
        type: "New",
        text: "BWF home, matches, players, and head-to-head powered by the Supabase catalog.",
      },
      {
        type: "Improved",
        text: "Marketing repositioned around BWF analysis (no account CTA funnel).",
      },
      {
        type: "Improved",
        text: "Player directory server pagination and rate-limited search APIs.",
      },
      {
        type: "Fixed",
        text: "Mobile marketing navigation via hamburger menu.",
      },
    ],
  },
  {
    version: "v3.4",
    date: "Jun 18, 2026",
    title: "Smarter highlight presets and faster reels (roadmap notes)",
    summary:
      "Historical product notes for private analysis tools — not part of the public BWF experience yet.",
    changes: [
      {
        type: "New",
        text: "Saveable highlight presets (planned private product).",
      },
      {
        type: "Improved",
        text: "Reel assembly performance notes for future private matches.",
      },
    ],
  },
  {
    version: "v3.3",
    date: "May 30, 2026",
    title: "Head-to-head heatmaps",
    summary:
      "Compare two players across a match with side-by-side court coverage and shot-distribution heatmaps.",
    changes: [
      {
        type: "New",
        text: "Head-to-head heatmap view in the analysis workspace, with synced rally scrubbing.",
      },
      {
        type: "New",
        text: "Export any heatmap as a PNG for slides and reports.",
      },
      {
        type: "Fixed",
        text: "Player labels no longer overlap on doubles court diagrams.",
      },
    ],
  },
  {
    version: "v3.2",
    date: "May 9, 2026",
    title: "Calibration overhaul",
    summary:
      "A rebuilt court-calibration flow improves tracking accuracy on angled and elevated camera positions.",
    changes: [
      {
        type: "Improved",
        text: "New four-point calibration is more forgiving of off-axis camera angles.",
      },
      {
        type: "Improved",
        text: "Tracking confidence is now shown per rally, so you know which segments to trust.",
      },
      {
        type: "Fixed",
        text: "Fixed a drift in shuttle tracking during very fast flat exchanges.",
      },
      {
        type: "Fixed",
        text: "Calibration now persists correctly when re-analyzing an existing match.",
      },
    ],
  },
  {
    version: "v3.1",
    date: "Apr 14, 2026",
    title: "Shared team libraries",
    summary:
      "Pro and Enterprise teams can now collect matches into a shared library with per-member roles.",
    changes: [
      {
        type: "New",
        text: "Shared team library with viewer, analyst, and admin roles.",
      },
      {
        type: "New",
        text: "Coach annotations on any rally, visible to the whole team.",
      },
      {
        type: "Improved",
        text: "Share links now respect library permissions automatically.",
      },
    ],
  },
];

// Public changelog prioritizes the live BWF catalog.
export default function ChangelogPage() {
  return (
    <div>
      <section className="relative">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(110% 55% at 50% -10%, rgba(54,147,255,0.16), transparent 56%)",
          }}
        />
        <div className="relative mx-auto max-w-[880px] px-8 pt-[84px]">
          <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--accent)]">
            Changelog
          </div>
          <h1 className="font-display text-[clamp(34px,5vw,52px)] font-semibold leading-[1.06] tracking-[-0.03em] text-[var(--text-strong)] text-balance">
            What&apos;s new in Mintonix.
          </h1>
          <p className="mt-[18px] max-w-[54ch] text-[17px] leading-[1.6] text-[var(--text-secondary)]">
            Every release, fix, and improvement to the analysis engine. Follow
            along — or subscribe and we&apos;ll send the notable ones.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button variant="outline" size="md">
              Subscribe to updates
            </Button>
            <span className="inline-flex items-center gap-1.5 text-[13px] text-[var(--text-muted)]">
              <Rss className="h-[15px] w-[15px] text-[var(--accent)]" />
              RSS available
            </span>
          </div>
        </div>
      </section>

      <section className="relative mx-auto max-w-[880px] px-8 pb-[120px] pt-16">
        {RELEASES.map((r) => (
          <div
            key={r.version}
            className="grid gap-7 pb-12 max-md:grid-cols-1 md:grid-cols-[168px_1fr]"
          >
            <div className="md:sticky md:top-24 md:self-start">
              <div className="mb-2.5 inline-flex items-center gap-2">
                <span className="h-[9px] w-[9px] rounded-full bg-[var(--accent)] shadow-[0_0_0_4px_rgba(54,147,255,0.16)]" />
                <span className="font-mono text-[15px] font-semibold tracking-[-0.01em] text-[var(--text-strong)]">
                  {r.version}
                </span>
              </div>
              <div className="font-mono text-[12px] text-[var(--text-muted)]">
                {r.date}
              </div>
              {r.latest ? (
                <span className="mt-3 inline-flex h-[19px] items-center rounded-full bg-[var(--brand)] px-[9px] font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--text-on-blue,#fff)]">
                  Latest
                </span>
              ) : null}
            </div>

            <article className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-[clamp(20px,3vw,28px)] shadow-[var(--shadow-edge)]">
              <h2 className="font-display text-[clamp(20px,2.6vw,26px)] font-semibold leading-[1.15] tracking-[-0.02em] text-[var(--text-strong)] text-balance">
                {r.title}
              </h2>
              <p className="mt-2.5 text-[14.5px] leading-[1.6] text-[var(--text-secondary)]">
                {r.summary}
              </p>
              <div className="mt-5 flex flex-col gap-3">
                {r.changes.map((c) => {
                  const s = TYPE_STYLES[c.type];
                  return (
                    <div key={c.text} className="flex items-start gap-3">
                      <span
                        className="mt-px inline-flex h-5 min-w-[64px] flex-none items-center justify-center rounded-full border px-2 font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em]"
                        style={{
                          color: s.fg,
                          background: s.bg,
                          borderColor: s.bd,
                        }}
                      >
                        {c.type}
                      </span>
                      <span className="text-[14px] leading-[1.55] text-[var(--text-secondary)]">
                        {c.text}
                      </span>
                    </div>
                  );
                })}
              </div>
            </article>
          </div>
        ))}

        <div className="flex items-center gap-3 pt-2 md:pl-[196px]">
          <span className="h-[7px] w-[7px] rounded-full bg-[var(--border-strong)]" />
          <span className="text-[13px] text-[var(--text-muted)]">
            That&apos;s where the history begins — Mintonix launched in 2024.
          </span>
        </div>
      </section>
    </div>
  );
}
