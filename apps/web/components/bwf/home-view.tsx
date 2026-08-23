"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Tabs } from "@/components/ui/tabs";
import { DISC_LABEL, DISCS } from "@/lib/bwf/types";
import type { Disc, FormBoardRow, HomeStats } from "@/lib/bwf/types";
import { cn } from "@/lib/utils";

export function HomeView({
  stats,
  formByDisc,
}: {
  stats: HomeStats;
  formByDisc: Record<Disc, { rows: FormBoardRow[]; total: number }>;
}) {
  const defaultDisc =
    DISCS.find((d) => (formByDisc[d]?.rows.length ?? 0) > 0) ?? "MS";
  const [disc, setDisc] = useState<Disc>(defaultDisc);
  const board = formByDisc[disc] ?? { rows: [], total: 0 };
  const maxForm = Math.max(...board.rows.map((r) => r.rankScore), 1);

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
          BWF catalog
        </h1>
        <p className="mt-[7px] max-w-[62ch] text-[14.5px] leading-[1.55] text-[var(--text-secondary)]">
          Form from catalog results (rank score = μ − 2×RD). Doubles boards
          are pairs. Same-name players stay separate by association.
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

      <div className="mb-3.5 flex flex-wrap items-center gap-3">
        <h2 className="font-display text-lg font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
          Form board
        </h2>
        <Tabs
          variant="pill"
          value={disc}
          onChange={(v) => setDisc(v as Disc)}
          items={DISCS.map((d) => ({ value: d, label: d }))}
          aria-label="Form board discipline"
        />
        <div className="flex-1" />
        <Link
          href={`/bwf/players?mode=boards&disc=${disc}`}
          className="inline-flex min-h-10 items-center gap-1.5 text-[13px] text-[var(--text-link)] hover:text-[var(--accent)]"
        >
          Full {disc} board
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <p className="mb-4 font-mono text-[11.5px] text-[var(--text-muted)]">
        {DISC_LABEL[disc]}
        {disc === "MD" || disc === "WD" || disc === "XD"
          ? " · pairs"
          : " · singles"}
        {board.total > 0
          ? ` · top ${board.rows.length}${
              board.total > board.rows.length ? ` of ${board.total}` : ""
            }`
          : ""}
      </p>

      {board.rows.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-[var(--border)] px-6 py-12 text-center">
          <p className="text-[13px] text-[var(--text-muted)]">
            No form ratings for {DISC_LABEL[disc]} yet.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-edge)]">
          {board.rows.map((r, i) => (
            <Link
              key={r.id}
              href={r.href}
              className={cn(
                "flex w-full items-center gap-[13px] px-4 py-[11px] text-left hover:bg-[var(--surface-2)]",
                i > 0 && "border-t border-[var(--border-subtle)]",
              )}
            >
              <span className="w-6 text-right font-mono text-xs tabular-nums text-[var(--text-faint)]">
                {i + 1}
              </span>
              <Avatar name={r.name} size={34} />
              <span className="min-w-0 flex-1 max-w-[40%]">
                <span className="block truncate font-display text-sm font-semibold text-[var(--text-strong)]">
                  {r.name}
                </span>
                <span className="mt-0.5 block truncate font-mono text-[10.5px] text-[var(--text-muted)]">
                  {r.kind === "pair" ? "pair" : "player"}
                  {` · ${r.matches} rated`}
                  {r.rd != null ? ` · RD ${Math.round(r.rd)}` : ""}
                </span>
              </span>
              <span className="min-w-[60px] flex-1">
                <span className="block h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
                  <span
                    className="block h-full rounded-full bg-[var(--accent)]"
                    style={{
                      width: `${(r.rankScore / maxForm) * 100}%`,
                    }}
                  />
                </span>
              </span>
              <span className="w-24 shrink-0 text-right font-mono text-sm tabular-nums text-[var(--text-strong)]">
                {Math.round(r.rankScore)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
