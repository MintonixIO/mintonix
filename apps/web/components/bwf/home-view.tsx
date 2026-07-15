import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { MatchCard } from "@/components/bwf/match-card";
import { MATCHES, parseDate, PLAYERS } from "@/lib/bwf/data";
import type { Disc } from "@/lib/bwf/types";

export function HomeView() {
  const recentMatches = [...MATCHES]
    .sort((a, b) => parseDate(b.date) - parseDate(a.date))
    .slice(0, 6);

  const topGroups = (["MS", "WS"] as Disc[]).map((code) => ({
    title: code === "MS" ? "Men's singles" : "Women's singles",
    players: PLAYERS.filter((p) => p.disc === code).sort(
      (a, b) => a.rank - b.rank,
    ),
  }));

  return (
    <section>
      <div className="mb-5">
        <h1 className="font-display text-[28px] font-semibold tracking-[-0.025em] text-[var(--text-strong)]">
          Every singles match, analyzed.
        </h1>
        <p className="mt-[7px] max-w-[62ch] text-[14.5px] leading-[1.55] text-[var(--text-secondary)]">
          Every broadcast BWF singles match, run through the Mintonix engine.
          Browse the insight first — rallies, shot mix, and pace — then open any
          match to replay it stroke by stroke.
        </p>
      </div>

      <div className="mb-[22px] grid grid-cols-2 gap-px overflow-hidden rounded-[13px] border border-[var(--border-subtle)] bg-[var(--border-subtle)] sm:grid-cols-4">
        {[
          { label: "Tournaments", value: "186", unit: "BWF events" },
          { label: "Players profiled", value: "412", unit: "MS + WS" },
          {
            label: "Matches covered",
            value: "2,140",
            unit: "broadcast feeds",
          },
          { label: "Frames analyzed", value: "184M", unit: "frames" },
        ].map((ls) => (
          <div
            key={ls.label}
            className="bg-[var(--surface-1)] px-[18px] py-4"
          >
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

      <div className="mb-7">
        <div className="mb-3.5 flex items-baseline gap-2.5">
          <h2 className="font-display text-lg font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
            Top players
          </h2>
          <span className="font-mono text-[11px] text-[var(--text-muted)]">
            by world ranking
          </span>
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
                {g.players.map((p) => (
                  <Link
                    key={p.id}
                    href={`/bwf/players/${p.id}`}
                    className="flex w-full items-center gap-3 border-t border-[var(--border-subtle)] px-4 py-[11px] text-left hover:bg-[var(--surface-2)]"
                  >
                    <span className="w-5 text-right font-mono text-xs tabular-nums text-[var(--text-faint)]">
                      {p.rank}
                    </span>
                    <Avatar name={p.name} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-display text-sm font-semibold text-[var(--text-strong)]">
                        {p.name}
                      </span>
                      <span className="mt-0.5 block font-mono text-[10.5px] text-[var(--text-muted)]">
                        {p.countryName}
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
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-3.5 flex items-baseline gap-2.5">
        <h2 className="font-display text-lg font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
          Recent matches
        </h2>
        <span className="font-mono text-[11px] text-[var(--text-muted)]">
          newest first
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
      <div className="grid grid-cols-1 gap-4 pb-2 md:grid-cols-2 xl:grid-cols-3">
        {recentMatches.map((m) => (
          <MatchCard key={m.id} m={m} />
        ))}
      </div>
    </section>
  );
}
