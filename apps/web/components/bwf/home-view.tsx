import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { MatchCard } from "@/components/bwf/match-card";
import type {
  CatalogMatch,
  DirectoryPlayer,
  Disc,
  HomeStats,
} from "@/lib/bwf/types";
import { DISC_LABEL } from "@/lib/bwf/types";

export function HomeView({
  stats,
  featuredMatches,
  topMs,
  topWs,
}: {
  stats: HomeStats;
  featuredMatches: CatalogMatch[];
  topMs: DirectoryPlayer[];
  topWs: DirectoryPlayer[];
}) {
  const topGroups: {
    title: string;
    disc: Disc;
    players: DirectoryPlayer[];
  }[] = [
    { title: DISC_LABEL.MS, disc: "MS", players: topMs },
    { title: DISC_LABEL.WS, disc: "WS", players: topWs },
  ];

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
          Browse finished BWF matches loaded into Mintonix — scores, disciplines,
          and video links where we have coverage. Open a match for full detail or
          jump into player records and head-to-head.
        </p>
      </div>

      <div className="mb-[22px] grid grid-cols-2 gap-px overflow-hidden rounded-[13px] border border-[var(--border-subtle)] bg-[var(--border-subtle)] sm:grid-cols-4">
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
              className="inline-flex h-8 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[12.5px] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]"
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
            Top players
          </h2>
          <span className="font-mono text-[11px] text-[var(--text-muted)]">
            by win rate · min 3 matches
          </span>
          <div className="flex-1" />
          <Link
            href="/bwf/players"
            className="inline-flex items-center gap-1.5 text-[13px] text-[var(--text-link)] hover:text-[var(--accent)]"
          >
            All players
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="grid gap-3.5 lg:grid-cols-2">
          {topGroups.map((g) => (
            <div
              key={g.title}
              className="overflow-hidden rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-edge)]"
            >
              <div className="px-4 py-3 font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--accent)]">
                {g.title}
              </div>
              <div className="max-h-[284px] overflow-y-auto">
                {g.players.length === 0 ? (
                  <div className="border-t border-[var(--border-subtle)] px-4 py-6 text-[13px] text-[var(--text-muted)]">
                    No players yet for this discipline.
                  </div>
                ) : (
                  g.players.map((p, i) => (
                    <Link
                      key={p.id}
                      href={`/bwf/players/${p.id}`}
                      className="flex w-full items-center gap-3 border-t border-[var(--border-subtle)] px-4 py-[11px] text-left hover:bg-[var(--surface-2)]"
                    >
                      <span className="w-5 text-right font-mono text-xs tabular-nums text-[var(--text-faint)]">
                        {i + 1}
                      </span>
                      <Avatar
                        name={p.name}
                        src={p.imageUrl ?? undefined}
                        size={34}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-display text-sm font-semibold text-[var(--text-strong)]">
                          {p.name}
                        </span>
                        <span className="mt-0.5 block font-mono text-[10.5px] text-[var(--text-muted)]">
                          {p.wins}–{p.losses} · {p.matches} matches
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end">
                        <span className="font-mono text-[13px] tabular-nums text-[var(--success-500)]">
                          {p.winRate}%
                        </span>
                        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
                          win rate
                        </span>
                      </span>
                    </Link>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
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
          href="/bwf/matches"
          className="inline-flex items-center gap-1.5 text-[13px] text-[var(--text-link)] hover:text-[var(--accent)]"
        >
          Browse all matches
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      {featuredMatches.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-[var(--border)] px-6 py-12 text-center text-[13px] text-[var(--text-muted)]">
          No matches loaded yet.
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
