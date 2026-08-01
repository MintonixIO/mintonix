import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, Filter, Search, Swords, Trophy, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "How the Mintonix BWF catalog works — matches, players, H2H, and video.",
};

const SECTIONS = [
  {
    icon: Trophy,
    title: "Browse the catalog",
    body: (
      <>
        Start at{" "}
        <Link href="/bwf" className="text-[var(--text-link)] hover:underline">
          /bwf
        </Link>{" "}
        for headline counts, top players (min 3 decided results), and featured
        matches. Use the shell search to jump to a player, match, or tournament.
      </>
    ),
  },
  {
    icon: Filter,
    title: "Match library filters",
    body: (
      <>
        On{" "}
        <Link
          href="/bwf/matches"
          className="text-[var(--text-link)] hover:underline"
        >
          /bwf/matches
        </Link>
        , filter by discipline, tournament (typeahead), round, year, and lenses
        such as “with video” or three-game matches. Pagination is server-side.
      </>
    ),
  },
  {
    icon: Users,
    title: "Players",
    body: (
      <>
        The directory is name-based: profiles roll up wins/losses from catalog
        rows. Homonyms may share a display name until a dedicated players table
        exists. Leaderboards use decided results only.
      </>
    ),
  },
  {
    icon: Swords,
    title: "Head-to-head",
    body: (
      <>
        Pick two players to list shared meetings (capped for huge pairings).
        Typeahead searches the full directory; a slim seed list loads first for
        speed.
      </>
    ),
  },
  {
    icon: Search,
    title: "Video",
    body: (
      <>
        Match detail embeds YouTube only when the source URL is an allowlisted
        YouTube link. Other sources are omitted rather than shown as broken
        embeds. Processed CDN analysis is not part of the public catalog yet.
      </>
    ),
  },
];

export default function DocsPage() {
  return (
    <div className="mx-auto max-w-[800px] px-5 py-16 sm:px-8 sm:py-20">
      <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--accent-soft)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--accent)]">
        <BookOpen className="h-3.5 w-3.5" />
        Docs
      </div>
      <h1 className="text-balance font-display text-[clamp(32px,4vw,44px)] font-semibold tracking-[-0.03em] text-[var(--text-strong)]">
        BWF catalog guide
      </h1>
      <p className="mt-4 max-w-[56ch] text-pretty text-[16px] leading-[1.65] text-[var(--text-secondary)]">
        The live product is a free public catalog of finished BWF matches. No
        account required. Private uploads and coaching workspaces are planned
        separately.
      </p>

      <div className="mt-10 space-y-4">
        {SECTIONS.map((s) => (
          <article
            key={s.title}
            className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-5 shadow-[var(--shadow-ring-card)] sm:p-6"
          >
            <div className="flex items-start gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border border-[var(--border)] bg-[var(--accent-soft)] text-[var(--accent)]">
                <s.icon className="h-5 w-5" />
              </span>
              <div>
                <h2 className="font-display text-lg font-semibold text-[var(--text-strong)]">
                  {s.title}
                </h2>
                <p className="mt-2 text-[14.5px] leading-[1.55] text-[var(--text-secondary)]">
                  {s.body}
                </p>
              </div>
            </div>
          </article>
        ))}

        <article className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface-1)]/60 p-5 sm:p-6">
          <h2 className="font-display text-lg font-semibold text-[var(--text-strong)]">
            Private tools (planned)
          </h2>
          <p className="mt-2 text-[14.5px] leading-[1.55] text-[var(--text-secondary)]">
            Court calibration, personal uploads, highlight reels, and team
            workspaces are not documented here yet.{" "}
            <Link
              href="/about#contact"
              className="text-[var(--text-link)] hover:underline"
            >
              Contact
            </Link>{" "}
            if you need early-access details.
          </p>
        </article>
      </div>

      <div className="mt-10">
        <Button href="/bwf" size="lg">
          Open the BWF catalog
        </Button>
      </div>
    </div>
  );
}
