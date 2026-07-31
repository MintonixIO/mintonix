"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import {
  BOARD_METRICS,
  type BoardMetricKey,
} from "@/components/bwf/board-metrics";
import type { DirectoryPlayer, Disc } from "@/lib/bwf/types";
import { DISCS } from "@/lib/bwf/types";
import { cn } from "@/lib/utils";

type DirMode = "profiles" | "boards";

const PAGE_SIZE = 60;
const RATE_METRICS = new Set<BoardMetricKey>(["winRate"]);

export function PlayersView({ players }: { players: DirectoryPlayer[] }) {
  const [disc, setDisc] = useState<"all" | Disc>("all");
  const [dirMode, setDirMode] = useState<DirMode>("profiles");
  const [boardMetric, setBoardMetric] = useState<BoardMetricKey>("winRate");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const dirPlayers = useMemo(() => {
    const query = q.trim().toLowerCase();
    return players.filter((p) => {
      if (disc !== "all" && p.disc !== disc && !p.discs.includes(disc)) {
        return false;
      }
      if (query && !p.name.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [players, disc, q]);

  const totalPages = Math.max(1, Math.ceil(dirPlayers.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const pageSlice = dirPlayers.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  const setDiscAndReset = (v: "all" | Disc) => {
    setDisc(v);
    setPage(1);
  };
  const setDirModeAndReset = (v: DirMode) => {
    setDirMode(v);
    setPage(1);
  };
  const setQueryAndReset = (value: string) => {
    setQ(value);
    setPage(1);
  };

  const boardMetricDef =
    BOARD_METRICS.find((m) => m.key === boardMetric) || BOARD_METRICS[0];
  const boardRows = useMemo(() => {
    // Rate-like: require ≥3 decided results; count metrics: ≥1 match.
    const filtered = RATE_METRICS.has(boardMetricDef.key)
      ? dirPlayers.filter((p) => p.wins + p.losses >= 3)
      : dirPlayers.filter((p) => p.matches >= 1);
    const max = Math.max(...filtered.map((p) => boardMetricDef.get(p)), 1);
    return filtered
      .slice()
      .sort((a, b) => boardMetricDef.get(b) - boardMetricDef.get(a))
      .map((p, i) => ({
        p,
        rank: i + 1,
        value: boardMetricDef.get(p),
        pct: (boardMetricDef.get(p) / max) * 100,
      }));
  }, [dirPlayers, boardMetricDef]);

  return (
    <section>
      <div className="mb-5">
        <h1 className="font-display text-[28px] font-semibold tracking-[-0.025em] text-[var(--text-strong)]">
          Player directory
        </h1>
        <p className="mt-[7px] max-w-[60ch] text-[14.5px] leading-[1.55] text-[var(--text-secondary)]">
          Every player name from the BWF catalog, rolled up into wins, losses,
          and leaderboard metrics computed from real match rows.
        </p>
      </div>

      <div className="mb-[18px] flex flex-wrap items-center gap-3">
        <Tabs
          variant="pill"
          value={disc}
          onChange={(v) => setDiscAndReset(v as "all" | Disc)}
          items={[
            { value: "all", label: "All" },
            ...DISCS.map((d) => ({ value: d, label: d })),
          ]}
        />
        <Tabs
          variant="pill"
          value={dirMode}
          onChange={(v) => setDirModeAndReset(v as DirMode)}
          items={[
            { value: "profiles", label: "Profiles" },
            { value: "boards", label: "Leaderboards" },
          ]}
        />
        <Input
          size="sm"
          value={q}
          onChange={(e) => setQueryAndReset(e.target.value)}
          placeholder="Filter by name…"
          className="w-[min(220px,100%)]"
        />
        <div className="flex-1" />
        <span className="font-mono text-xs text-[var(--text-muted)]">
          {dirMode === "profiles"
            ? dirPlayers.length === 0
              ? "0 players"
              : `Showing ${pageSlice.length} of ${dirPlayers.length}`
            : `${dirPlayers.length} players`}
        </span>
      </div>

      {dirPlayers.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-[var(--border)] px-6 py-14 text-center text-[13px] text-[var(--text-muted)]">
          No players match this filter.
        </div>
      ) : dirMode === "profiles" ? (
        <>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {pageSlice.map((p) => (
              <Link
                key={p.id}
                href={`/bwf/players/${p.id}`}
                className="flex items-center gap-3.5 rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-[15px] text-left shadow-[var(--shadow-edge)] transition-[transform,border-color] hover:-translate-y-0.5 hover:border-[var(--border-strong)]"
              >
                <Avatar name={p.name} src={p.imageUrl ?? undefined} size={46} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-[15px] font-semibold text-[var(--text-strong)]">
                    {p.name}
                  </div>
                  <div className="mt-[3px] flex items-center gap-[7px] font-mono text-[11px] text-[var(--text-muted)]">
                    <span>{p.disc ?? "—"}</span>
                    <span className="h-[3px] w-[3px] rounded-full bg-[var(--text-faint)]" />
                    <span>
                      {p.wins}–{p.losses}
                    </span>
                  </div>
                  <div className="mt-2.5 flex items-center gap-3.5">
                    <span className="inline-flex flex-col">
                      <span className="font-mono text-sm tabular-nums text-[var(--success-500)]">
                        {p.winRate}%
                      </span>
                      <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
                        win rate
                      </span>
                    </span>
                    <span className="inline-flex flex-col">
                      <span className="font-mono text-sm tabular-nums text-[var(--text-strong)]">
                        {p.matches}
                      </span>
                      <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
                        matches
                      </span>
                    </span>
                    <span className="inline-flex flex-col">
                      <span className="font-mono text-sm tabular-nums text-[var(--accent)]">
                        {p.threeGames}
                      </span>
                      <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
                        3-game
                      </span>
                    </span>
                  </div>
                </div>
                <ChevronRight className="h-[17px] w-[17px] shrink-0 text-[var(--text-muted)]" />
              </Link>
            ))}
          </div>
          {totalPages > 1 ? (
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className={cn(
                  "inline-flex h-9 items-center rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[13px] text-[var(--text-secondary)]",
                  safePage <= 1 && "opacity-40",
                )}
              >
                Previous
              </button>
              <span className="font-mono text-xs text-[var(--text-muted)]">
                Page {safePage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className={cn(
                  "inline-flex h-9 items-center rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[13px] text-[var(--text-secondary)]",
                  safePage >= totalPages && "opacity-40",
                )}
              >
                Next
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className="mb-4">
            <div className="flex flex-wrap gap-2">
              {BOARD_METRICS.map((m) => {
                const Icon = m.icon;
                const on = boardMetric === m.key;
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setBoardMetric(m.key)}
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
                        on
                          ? "text-[var(--accent)]"
                          : "text-[var(--text-muted)]",
                      )}
                    />
                    {m.short}
                  </button>
                );
              })}
            </div>
            <div className="mt-[11px] font-mono text-[11.5px] text-[var(--text-muted)]">
              Ranked by {boardMetricDef.label.toLowerCase()}
              {RATE_METRICS.has(boardMetricDef.key)
                ? " · min 3 decided results"
                : ""}
            </div>
          </div>
          <div className="overflow-hidden rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-edge)]">
            <div className="flex items-center gap-2.5 border-b border-[var(--border-subtle)] px-4 py-[13px]">
              <span className="font-display text-[15px] font-semibold text-[var(--text-strong)]">
                {boardMetricDef.label}
              </span>
              <div className="flex-1" />
              <span className="font-mono text-[11px] text-[var(--text-muted)]">
                Top {Math.min(50, boardRows.length)}
                {boardRows.length > 50
                  ? ` of ${boardRows.length} ranked`
                  : " ranked"}
              </span>
            </div>
            {boardRows.slice(0, 50).map((r) => (
              <Link
                key={r.p.id}
                href={`/bwf/players/${r.p.id}`}
                className="flex w-full items-center gap-[13px] border-t border-[var(--border-subtle)] px-4 py-[11px] text-left hover:bg-[var(--surface-2)]"
              >
                <span className="w-6 text-right font-mono text-xs tabular-nums text-[var(--text-faint)]">
                  {r.rank}
                </span>
                <Avatar
                  name={r.p.name}
                  src={r.p.imageUrl ?? undefined}
                  size={34}
                />
                <span className="w-[168px] shrink-0 min-w-0">
                  <span className="block truncate font-display text-sm font-semibold text-[var(--text-strong)]">
                    {r.p.name}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[10.5px] text-[var(--text-muted)]">
                    {r.p.disc ?? "—"} · {r.p.matches} matches
                  </span>
                </span>
                <span className="min-w-[60px] flex-1">
                  <span className="block h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${r.pct}%`,
                        background: boardMetricDef.color,
                      }}
                    />
                  </span>
                </span>
                <span className="w-24 shrink-0 text-right font-mono text-sm tabular-nums text-[var(--text-strong)]">
                  {r.value}
                  {boardMetricDef.unit}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
