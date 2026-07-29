import { LayoutGrid, List } from "lucide-react";
import { Select } from "@/components/ui/select";
import {
  LIBRARY_STATUS_TABS,
  type LibraryStatusFilter,
} from "@/lib/matches";
import { cn } from "@/lib/utils";

type LibraryToolbarProps = {
  status: LibraryStatusFilter;
  onStatusChange: (v: LibraryStatusFilter) => void;
  counts: Record<string, number>;
  sort: string;
  onSortChange: (v: string) => void;
  view: "table" | "grid";
  onViewChange: (v: "table" | "grid") => void;
};

export function LibraryToolbar({
  status,
  onStatusChange,
  counts,
  sort,
  onSortChange,
  view,
  onViewChange,
}: LibraryToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] px-7 py-4">
      <div className="flex gap-0.5 rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] p-0.5">
        {LIBRARY_STATUS_TABS.map((t) => {
          const active = status === t.v;
          const count = counts[t.v] ?? 0;
          return (
            <button
              key={t.v}
              type="button"
              onClick={() => onStatusChange(t.v)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-[13px]",
                active
                  ? "bg-[var(--accent)] text-white"
                  : "bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-strong)]",
              )}
            >
              {t.label}
              <span
                className={cn(
                  "font-mono text-[11px]",
                  active ? "opacity-85" : "text-[var(--text-faint)]",
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex-1" />
      <span className="font-mono text-[11px] tracking-[0.1em] text-[var(--text-faint)] uppercase">
        Sort
      </span>
      <div className="w-[170px]">
        <Select
          size="sm"
          value={sort}
          onChange={(e) => onSortChange(e.target.value)}
          options={[
            { value: "recent", label: "Most recent" },
            { value: "oldest", label: "Oldest first" },
            { value: "longest", label: "Longest" },
            { value: "shots", label: "Most shots" },
            { value: "name", label: "Name (A–Z)" },
          ]}
        />
      </div>
      <div className="flex gap-0.5 rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] p-0.5">
        <button
          type="button"
          aria-label="Table view"
          onClick={() => onViewChange("table")}
          className={cn(
            "inline-flex h-7 w-8 items-center justify-center rounded-md",
            view === "table"
              ? "bg-[var(--accent)] text-white"
              : "bg-transparent text-[var(--text-muted)] hover:text-[var(--text-strong)]",
          )}
        >
          <List className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Grid view"
          onClick={() => onViewChange("grid")}
          className={cn(
            "inline-flex h-7 w-8 items-center justify-center rounded-md",
            view === "grid"
              ? "bg-[var(--accent)] text-white"
              : "bg-transparent text-[var(--text-muted)] hover:text-[var(--text-strong)]",
          )}
        >
          <LayoutGrid className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
