import Link from "next/link";
import { Check, MoreHorizontal, Play } from "lucide-react";
import { CourtThumb } from "@/components/media/court-thumb";
import type { LibraryMatch } from "@/lib/matches";
import { StatusPill } from "./status-pill";

type LibraryTableProps = {
  rows: LibraryMatch[];
  selected: Record<string, boolean>;
  allSelected: boolean;
  onToggleOne: (id: string) => void;
  onToggleAll: () => void;
};

export function LibraryTable({
  rows,
  selected,
  allSelected,
  onToggleOne,
  onToggleAll,
}: LibraryTableProps) {
  return (
    <div className="overflow-hidden rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-edge)]">
      <div className="mx-scroll overflow-x-auto">
        <div className="min-w-[880px]">
          <div className="grid grid-cols-[38px_minmax(0,3fr)_minmax(0,1.3fr)_110px_120px_84px_78px_40px] items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-[11px] font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)] uppercase">
            <button
              type="button"
              aria-label="Select all"
              onClick={onToggleAll}
              className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border-[1.5px] border-[var(--border-strong)] bg-[var(--surface-2)] p-0"
            >
              {allSelected ? (
                <Check className="h-3 w-3 text-[var(--accent)]" />
              ) : null}
            </button>
            <span>Match</span>
            <span>Opponent</span>
            <span>Date</span>
            <span>Status</span>
            <span className="text-right">Shots</span>
            <span className="text-right">Size</span>
            <span />
          </div>

          {rows.map((m) => {
            const sel = !!selected[m.id];
            const href = m.status === "ready" ? "/video-analysis" : "#";
            return (
              <div
                key={m.id}
                className="relative border-b border-[var(--border-subtle)] last:border-b-0"
              >
                {sel ? (
                  <div className="pointer-events-none absolute inset-0 z-[1] bg-[rgba(54,147,255,0.08)] shadow-[inset_3px_0_0_var(--accent)]" />
                ) : null}
                <div className="relative grid grid-cols-[38px_minmax(0,3fr)_minmax(0,1.3fr)_110px_120px_84px_78px_40px] items-center gap-3 px-4 py-[13px] hover:bg-[var(--surface-hover)]">
                  <button
                    type="button"
                    aria-label="Select"
                    onClick={() => onToggleOne(m.id)}
                    className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border-[1.5px] border-[var(--border-strong)] bg-[var(--surface-2)] p-0"
                  >
                    {sel ? (
                      <Check className="h-3 w-3 text-[var(--accent)]" />
                    ) : null}
                  </button>
                  <Link
                    href={href}
                    className="flex min-w-0 items-center gap-3 text-left"
                  >
                    <CourtThumb
                      className="inline-flex h-[30px] w-[52px] shrink-0 items-center justify-center rounded-md border border-[var(--border)]"
                      gridOpacity={0.7}
                    >
                      <Play className="relative h-[13px] w-[13px] text-[var(--text-secondary)]" />
                    </CourtThumb>
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-medium text-[var(--text-strong)]">
                        {m.title}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[11px] text-[var(--text-muted)]">
                        {m.tournament}
                      </span>
                    </span>
                  </Link>
                  <span className="truncate text-[13px] text-[var(--text-secondary)]">
                    {m.opponent}
                  </span>
                  <span className="whitespace-nowrap font-mono text-xs text-[var(--text-muted)]">
                    {m.date}
                  </span>
                  <span>
                    <StatusPill m={m} />
                  </span>
                  <span className="text-right font-mono text-[12.5px] tabular-nums text-[var(--text-strong)]">
                    {m.shots ? m.shots : "—"}
                  </span>
                  <span className="text-right font-mono text-xs tabular-nums text-[var(--text-muted)]">
                    {m.size}
                  </span>
                  <Link
                    href={href}
                    aria-label="Open match"
                    className="inline-flex h-[30px] w-[30px] items-center justify-center justify-self-end rounded-[7px] text-[var(--text-muted)] hover:border hover:border-[var(--border)] hover:bg-[var(--surface-2)] hover:text-[var(--text-strong)]"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            );
          })}

          {rows.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <div className="text-sm text-[var(--text-secondary)]">
                No matches found.
              </div>
              <div className="mt-1 font-mono text-xs text-[var(--text-muted)]">
                Try a different search or status filter.
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
