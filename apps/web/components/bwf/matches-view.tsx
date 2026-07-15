"use client";

import {
  Clock,
  Flame,
  LayoutGrid,
  Repeat,
  Swords,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { MatchCard } from "@/components/bwf/match-card";
import { Tabs } from "@/components/ui/tabs";
import { LENS, MATCHES, parseDate } from "@/lib/bwf/data";
import type { Disc, Match } from "@/lib/bwf/types";
import { cn } from "@/lib/utils";

const LENS_ICONS: Record<string, LucideIcon> = {
  all: LayoutGrid,
  long: Repeat,
  fast: Zap,
  marathon: Clock,
  attacking: Swords,
  comeback: Flame,
  close: Flame,
};

export function MatchesView() {
  const [disc, setDisc] = useState<"all" | Disc>("all");
  const [lens, setLens] = useState<string>("all");

  const filteredMatches = useMemo(() => {
    let list = MATCHES.filter((m) => disc === "all" || m.disc === disc);
    if (lens === "comeback") list = list.filter((m) => m.comeback);
    if (lens === "close") list = list.filter((m) => m.threeGames);
    const sortFns: Record<string, (a: Match, b: Match) => number> = {
      all: (a, b) => parseDate(b.date) - parseDate(a.date),
      long: (a, b) => b.longest - a.longest,
      fast: (a, b) => b.fastestSmash - a.fastestSmash,
      marathon: (a, b) => b.dur - a.dur,
      attacking: (a, b) => b.attackPct - a.attackPct,
      comeback: (a, b) => parseDate(b.date) - parseDate(a.date),
      close: (a, b) => b.dur - a.dur,
    };
    return list.slice().sort(sortFns[lens] || sortFns.all);
  }, [disc, lens]);

  const lensNote =
    lens === "long"
      ? "Sorted by longest rally"
      : lens === "fast"
        ? "Sorted by peak smash speed"
        : lens === "marathon"
          ? "Sorted by match duration"
          : lens === "attacking"
            ? "Sorted by attack share"
            : lens === "comeback"
              ? "Only matches with a lost first game and a three-game win"
              : lens === "close"
                ? "Only three-game matches"
                : null;

  return (
    <section>
      <div className="mb-5">
        <h1 className="font-display text-[28px] font-semibold tracking-[-0.025em] text-[var(--text-strong)]">
          Match library
        </h1>
        <p className="mt-[7px] max-w-[62ch] text-[14.5px] leading-[1.55] text-[var(--text-secondary)]">
          Every broadcast BWF singles match in one place. Filter by discipline or
          tournament, then open any match to replay it stroke by stroke.
        </p>
      </div>

      <div className="mb-[18px] flex flex-wrap items-center gap-3">
        <Tabs
          variant="pill"
          value={disc}
          onChange={(v) => setDisc(v as "all" | Disc)}
          items={[
            { value: "all", label: "All" },
            { value: "MS", label: "Men's singles" },
            { value: "WS", label: "Women's singles" },
          ]}
        />
        <div className="flex-1" />
        <span className="font-mono text-xs text-[var(--text-muted)]">
          {filteredMatches.length} matches
        </span>
      </div>

      <div className="mb-[18px]">
        <div className="flex flex-wrap gap-2">
          {LENS.map((l) => {
            const Icon = LENS_ICONS[l.id] ?? LayoutGrid;
            const on = lens === l.id;
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => setLens(l.id)}
                className={cn(
                  "inline-flex h-[34px] items-center gap-1.5 rounded-full border px-[13px] text-[13px]",
                  on
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text-strong)]"
                    : "border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]",
                )}
              >
                <Icon
                  className={cn(
                    "h-3.5 w-3.5",
                    on ? "text-[var(--accent)]" : "text-[var(--text-muted)]",
                  )}
                />
                {l.label}
              </button>
            );
          })}
        </div>
        {lensNote ? (
          <div className="mt-[11px] font-mono text-[11.5px] text-[var(--text-muted)]">
            {lensNote}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 pb-2 md:grid-cols-2 xl:grid-cols-3">
        {filteredMatches.map((m) => (
          <MatchCard key={m.id} m={m} lens={lens} />
        ))}
      </div>
    </section>
  );
}
