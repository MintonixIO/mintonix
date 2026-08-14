"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { useTransition } from "react";
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

const RATE_METRICS = new Set<BoardMetricKey>(["winRate"]);

function buildHref(parts: {
  mode: DirMode;
  q: string;
  disc: "all" | Disc;
  page: number;
  metric: BoardMetricKey;
}): string {
  const sp = new URLSearchParams();
  if (parts.mode === "boards") sp.set("mode", "boards");
  if (parts.q) sp.set("q", parts.q);
  if (parts.disc !== "all") sp.set("disc", parts.disc);
  if (parts.mode === "profiles" && parts.page > 1) {
    sp.set("page", String(parts.page));
  }
  if (parts.mode === "boards" && parts.metric !== "winRate") {
    sp.set("metric", parts.metric);
  }
  const qs = sp.toString();
  return qs ? `/bwf/players?${qs}` : "/bwf/players";
}

export function PlayersView({
  mode,
  q,
  disc,
  boardMetric,
  players,
  total,
  page,
  pageSize,
  totalPages,
  boardPlayers,
  boardTotal,
}: {
  mode: DirMode;
  q: string;
  disc: "all" | Disc;
  boardMetric: BoardMetricKey;
  players: DirectoryPlayer[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  boardPlayers: DirectoryPlayer[];
  boardTotal: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const navigate = (next: {
    mode?: DirMode;
    q?: string;
    disc?: "all" | Disc;
    page?: number;
    metric?: BoardMetricKey;
  }) => {
    const href = buildHref({
      mode: next.mode ?? mode,
      q: next.q ?? q,
      disc: next.disc ?? disc,
      page: next.page ?? (next.mode && next.mode !== mode ? 1 : page),
      metric: next.metric ?? boardMetric,
    });
    startTransition(() => {
      router.replace(href, { scroll: false });
    });
  };

  const boardMetricDef =
    BOARD_METRICS.find((m) => m.key === boardMetric) || BOARD_METRICS[0];
  const maxBoard = Math.max(
    ...boardPlayers.map((p) => boardMetricDef.get(p)),
    1,
  );
  const boardRows = boardPlayers.map((p, i) => ({
    p,
    rank: i + 1,
    value: boardMetricDef.get(p),
    pct: (boardMetricDef.get(p) / maxBoard) * 100,
  }));

  return (
    <section
      className={cn(isPending && "opacity-90 transition-opacity")}
      aria-busy={isPending}
    >
      <div className="mb-5">
        <h1 className="font-display text-[28px] font-semibold tracking-[-0.025em] text-[var(--text-strong)]">
          Player directory
        </h1>
        <p className="mt-[7px] max-w-[60ch] text-[14.5px] leading-[1.55] text-[var(--text-secondary)]">
          Every player from the BWF catalog. Same display name, different
          association — those are two people. Country is on every card.
        </p>
      </div>

      <div className="mb-[18px] flex flex-wrap items-center gap-3 [&_button]:min-h-10">
        <Tabs
          variant="pill"
          value={disc}
          onChange={(v) =>
            navigate({ disc: v as "all" | Disc, page: 1 })
          }
          items={[
            { value: "all", label: "All" },
            ...DISCS.map((d) => ({ value: d, label: d })),
          ]}
        />
        <Tabs
          variant="pill"
          value={mode}
          onChange={(v) =>
            navigate({ mode: v as DirMode, page: 1 })
          }
          items={[
            { value: "profiles", label: "Profiles" },
            { value: "boards", label: "Leaderboards" },
          ]}
        />
        <Input
          size="md"
          defaultValue={q}
          key={`q-${q}`}
          onChange={(e) => {
            const value = e.target.value;
            // Debounce lightly via timeout on the element
            const el = e.currentTarget;
            window.clearTimeout((el as HTMLInputElement & { _t?: number })._t);
            (el as HTMLInputElement & { _t?: number })._t = window.setTimeout(
              () => navigate({ q: value, page: 1 }),
              250,
            );
          }}
          placeholder="Filter by name…"
          className="w-[min(220px,100%)]"
          aria-label="Filter players by name"
        />
        <div className="flex-1" />
        <span className="font-mono text-xs text-[var(--text-muted)]">
          {mode === "profiles"
            ? total === 0
              ? "0 players"
              : `Showing ${players.length} of ${total}`
            : `${boardTotal} ranked`}
        </span>
      </div>

      {mode === "profiles" ? (
        total === 0 ? (
          <div className="rounded-[14px] border border-dashed border-[var(--border)] px-6 py-14 text-center text-[13px] text-[var(--text-muted)]">
            <p>No players match those filters. Try clearing search or switching discipline.</p>
            <button
              type="button"
              onClick={() => navigate({ q: "", disc: "all", page: 1 })}
              className="mt-5 inline-flex min-h-10 h-10 items-center rounded-[9px] border border-[var(--border)] bg-[var(--surface-2)] px-4 text-[13px] text-[var(--text-strong)] hover:border-[var(--border-strong)]"
            >
              Reset filters
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {players.map((p) => (
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
                      {p.country ? (
                        <>
                          <span className="uppercase">{p.country}</span>
                          <span className="h-[3px] w-[3px] rounded-full bg-[var(--text-faint)]" />
                        </>
                      ) : null}
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
                  disabled={page <= 1 || isPending}
                  onClick={() => navigate({ page: page - 1 })}
                  className={cn(
                    "inline-flex min-h-10 h-10 items-center rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[13px] text-[var(--text-secondary)]",
                    page <= 1 && "opacity-40",
                  )}
                >
                  Previous
                </button>
                <span className="font-mono text-xs text-[var(--text-muted)]">
                  Page {page} / {totalPages}
                  {pageSize ? ` · ${pageSize}/page` : ""}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages || isPending}
                  onClick={() => navigate({ page: page + 1 })}
                  className={cn(
                    "inline-flex min-h-10 h-10 items-center rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[13px] text-[var(--text-secondary)]",
                    page >= totalPages && "opacity-40",
                  )}
                >
                  Next
                </button>
              </div>
            ) : null}
          </>
        )
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
                    onClick={() => navigate({ metric: m.key })}
                    className={cn(
                      "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-[13px] text-[13px]",
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
          {boardRows.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-[var(--border)] px-6 py-14 text-center text-[13px] text-[var(--text-muted)]">
              <p>No players match those filters. Try clearing search or switching discipline.</p>
              <button
                type="button"
                onClick={() => navigate({ q: "", disc: "all", page: 1 })}
                className="mt-5 inline-flex min-h-10 h-10 items-center rounded-[9px] border border-[var(--border)] bg-[var(--surface-2)] px-4 text-[13px] text-[var(--text-strong)] hover:border-[var(--border-strong)]"
              >
                Reset filters
              </button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-edge)]">
              <div className="flex items-center gap-2.5 border-b border-[var(--border-subtle)] px-4 py-[13px]">
                <span className="font-display text-[15px] font-semibold text-[var(--text-strong)]">
                  {boardMetricDef.label}
                </span>
                <div className="flex-1" />
                <span className="font-mono text-[11px] text-[var(--text-muted)]">
                  Top {boardRows.length}
                  {boardTotal > boardRows.length
                    ? ` of ${boardTotal} ranked`
                    : " ranked"}
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
                  <Avatar
                    name={r.p.name}
                    src={r.p.imageUrl ?? undefined}
                    size={34}
                  />
                  <span className="min-w-0 flex-1 min-w-0 flex-1 max-w-[40%]">
                    <span className="block truncate font-display text-sm font-semibold text-[var(--text-strong)]">
                      {r.p.name}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[10.5px] text-[var(--text-muted)]">
                      {r.p.country ? `${r.p.country.toUpperCase()} · ` : ""}
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
          )}
        </>
      )}
    </section>
  );
}
