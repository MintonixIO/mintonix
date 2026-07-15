"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Tabs } from "@/components/ui/tabs";
import { BOARD_METRICS } from "@/lib/bwf/board-metrics";
import { PLAYERS } from "@/lib/bwf/data";
import type { DirMode, Disc } from "@/lib/bwf/types";
import { cn } from "@/lib/utils";

export function PlayersView() {
  const [disc, setDisc] = useState<"all" | Disc>("all");
  const [dirMode, setDirMode] = useState<DirMode>("profiles");
  const [boardMetric, setBoardMetric] = useState<string>("fastestSmash");

  const dirPlayers = useMemo(
    () => PLAYERS.filter((p) => disc === "all" || p.disc === disc),
    [disc],
  );

  const boardMetricDef =
    BOARD_METRICS.find((m) => m.key === boardMetric) || BOARD_METRICS[0];
  const boardRows = useMemo(() => {
    const max = Math.max(...dirPlayers.map((p) => boardMetricDef.get(p)), 1);
    return dirPlayers
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
          Player profiles
        </h1>
        <p className="mt-[7px] max-w-[60ch] text-[14.5px] leading-[1.55] text-[var(--text-secondary)]">
          Every player&apos;s matches rolled up into one analytical profile — win
          rate, shot mix, court coverage, and form, all from the same engine that
          reads each match.
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
        <Tabs
          variant="pill"
          value={dirMode}
          onChange={(v) => setDirMode(v as DirMode)}
          items={[
            { value: "profiles", label: "Profiles" },
            { value: "boards", label: "Leaderboards" },
          ]}
        />
        <div className="flex-1" />
        <span className="font-mono text-xs text-[var(--text-muted)]">
          {dirPlayers.length} players
        </span>
      </div>

      {dirMode === "profiles" ? (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {dirPlayers.map((p) => (
            <Link
              key={p.id}
              href={`/bwf/players/${p.id}`}
              className="flex items-center gap-3.5 rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-[15px] text-left shadow-[var(--shadow-edge)] transition-[transform,border-color] hover:-translate-y-0.5 hover:border-[var(--border-strong)]"
            >
              <Avatar name={p.name} size={46} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-[15px] font-semibold text-[var(--text-strong)]">
                  {p.name}
                </div>
                <div className="mt-[3px] flex items-center gap-[7px] font-mono text-[11px] text-[var(--text-muted)]">
                  <span>{p.countryName}</span>
                  <span className="h-[3px] w-[3px] rounded-full bg-[var(--text-faint)]" />
                  <span>
                    {p.disc} · #{p.rank}
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
                    <span className="font-mono text-sm tabular-nums text-[var(--danger-500)]">
                      {p.fastestSmash}
                    </span>
                    <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
                      top smash
                    </span>
                  </span>
                </div>
              </div>
              <ChevronRight className="h-[17px] w-[17px] shrink-0 text-[var(--text-muted)]" />
            </Link>
          ))}
        </div>
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
              Ranked by {boardMetricDef.label.toLowerCase()} across the profiled
              field
            </div>
          </div>
          <div className="overflow-hidden rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-edge)]">
            <div className="flex items-center gap-2.5 border-b border-[var(--border-subtle)] px-4 py-[13px]">
              <span className="font-display text-[15px] font-semibold text-[var(--text-strong)]">
                {boardMetricDef.label}
              </span>
              <div className="flex-1" />
              <span className="font-mono text-[11px] text-[var(--text-muted)]">
                {dirPlayers.length} ranked
              </span>
            </div>
            {boardRows.map((r) => (
              <Link
                key={r.p.id}
                href={`/bwf/players/${r.p.id}`}
                className="flex w-full items-center gap-[13px] border-t border-[var(--border-subtle)] px-4 py-[11px] text-left hover:bg-[var(--surface-2)]"
              >
                <span className="w-6 text-right font-mono text-xs tabular-nums text-[var(--text-faint)]">
                  {r.rank}
                </span>
                <Avatar name={r.p.name} size={34} />
                <span className="w-[168px] shrink-0 min-w-0">
                  <span className="block truncate font-display text-sm font-semibold text-[var(--text-strong)]">
                    {r.p.name}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[10.5px] text-[var(--text-muted)]">
                    {r.p.countryName}
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
