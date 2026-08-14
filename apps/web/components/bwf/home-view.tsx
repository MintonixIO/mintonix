import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { MatchCard } from "@/components/bwf/match-card";
import type { CatalogMatch, Disc, HomeStats } from "@/lib/bwf/types";

export function HomeView({
  stats,
  thisWeek,
  featuredMatches,
}: {
  stats: HomeStats;
  thisWeek: CatalogMatch[];
  featuredMatches: CatalogMatch[];
}) {
  const chips = [
    {
      label: "Tournaments",
      value: stats.tournaments.toLocaleString(),
      unit: "BWF events",
    },
    {
      label: "Players",
      value: stats.players.toLocaleString(),
      unit: "in catalog",
    },
    {
      label: "Matches",
      value: stats.matches.toLocaleString(),
      unit: "finished",
    },
    {
      label: "With video",
      value: stats.withVideo.toLocaleString(),
      unit: "YouTube links",
    },
  ];

  return (
    <section>
      <div className="mb-5">
        <h1 className="font-display text-[28px] font-semibold tracking-[-0.025em] text-[var(--text-strong)]">
          BWF match catalog
        </h1>
        <p className="mt-[7px] max-w-[62ch] text-[14.5px] leading-[1.55] text-[var(--text-secondary)]">
          Finished BWF matches — scores, dates, and video when we have
          coverage. Players with the same name stay separate by association
          (and Wikipedia birth year when the title keeps it).
        </p>
      </div>

      <div className="mb-[22px] grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--border-subtle)] sm:grid-cols-4">
        {chips.map((ls) => (
          <div key={ls.label} className="bg-[var(--surface-1)] px-[18px] py-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.13em] text-[var(--text-faint)]">
              {ls.label}
            </div>
            <div className="mt-[9px] flex items-baseline gap-1.5">
              <span className="font-display text-[26px] font-semibold tracking-[-0.02em] tabular-nums text-[var(--text-strong)]">
                {ls.value}
              </span>
              <span className="font-mono text-[11.5px] text-[var(--text-muted)]">
                {ls.unit}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {(Object.entries(stats.byDisc) as [Disc, number][])
          .filter(([, n]) => n > 0)
          .map(([d, n]) => (
            <Link
              key={d}
              href={`/bwf/matches?disc=${d}`}
              className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[12.5px] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]"
            >
              <span className="font-mono text-[10.5px] text-[var(--accent)]">
                {d}
              </span>
              <span>{n.toLocaleString()}</span>
            </Link>
          ))}
      </div>

      <div className="mb-7">
        <div className="mb-3.5 flex items-baseline gap-2.5">
          <h2 className="font-display text-lg font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
            This week
          </h2>
          <span className="font-mono text-[11px] text-[var(--text-muted)]">
            last 7 days · newest first
          </span>
          <div className="flex-1" />
          <Link
            href="/bwf/matches"
            className="inline-flex min-h-10 items-center gap-1.5 text-[13px] text-[var(--text-link)] hover:text-[var(--accent)]"
          >
            All matches
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {thisWeek.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-[var(--border)] px-6 py-12 text-center">
            <p className="text-[13px] text-[var(--text-muted)]">
              No matches dated in the last week. Showing late-round features
              below.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 pb-2 md:grid-cols-2 xl:grid-cols-3">
            {thisWeek.map((m) => (
              <MatchCard key={m.id} m={m} />
            ))}
          </div>
        )}
      </div>

      <div className="mb-3.5 flex items-baseline gap-2.5">
        <h2 className="font-display text-lg font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
          Featured matches
        </h2>
        <span className="font-mono text-[11px] text-[var(--text-muted)]">
          late rounds first
        </span>
        <div className="flex-1" />
        <Link
          href="/bwf/players"
          className="inline-flex min-h-10 items-center gap-1.5 text-[13px] text-[var(--text-link)] hover:text-[var(--accent)]"
        >
          Player directory
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      {featuredMatches.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-[var(--border)] px-6 py-12 text-center">
          <p className="text-[13px] text-[var(--text-muted)]">
            No matches loaded yet.
          </p>
          <Link
            href="/bwf/matches"
            className="mt-4 inline-flex min-h-10 items-center justify-center rounded-[10px] border border-[var(--border)] px-4 text-[13px] font-medium text-[var(--text-strong)] hover:bg-[var(--surface-2)]"
          >
            Browse match library
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 pb-2 md:grid-cols-2 xl:grid-cols-3">
          {featuredMatches.map((m) => (
            <MatchCard key={m.id} m={m} />
          ))}
        </div>
      )}
    </section>
  );
}
