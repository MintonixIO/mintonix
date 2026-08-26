import type { ReactNode } from "react";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import type { FormBoardRow } from "@/lib/bwf/types";
import { cn } from "@/lib/utils";

export function FormBoardList({
  rows,
  header,
  empty,
}: {
  rows: FormBoardRow[];
  header?: ReactNode;
  empty: ReactNode;
}) {
  if (rows.length === 0) return empty;
  const maxForm = Math.max(...rows.map((r) => r.rankScore), 1);
  return (
    <div className="overflow-hidden rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-edge)]">
      {header}
      {rows.map((r, i) => (
        <Link
          key={r.id}
          href={r.href}
          className={cn(
            "flex w-full items-center gap-[13px] px-4 py-[11px] text-left hover:bg-[var(--surface-2)]",
            (i > 0 || header) && "border-t border-[var(--border-subtle)]",
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
              {r.disc}
              {r.kind === "pair" ? " · pair" : ""}
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
  );
}
