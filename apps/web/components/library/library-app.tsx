"use client";

import Link from "next/link";
import { Download, GitCompare, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { AppTopbar } from "@/components/app/app-topbar";
import { Button } from "@/components/ui/button";
import {
  libraryMatches,
  type LibraryMatch,
  type LibraryStatusFilter,
} from "@/lib/matches";
import { LibraryGrid } from "./library-grid";
import { LibraryTable } from "./library-table";
import { LibraryToolbar } from "./library-toolbar";

export function LibraryApp() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<LibraryStatusFilter>("all");
  const [sort, setSort] = useState("recent");
  const [view, setView] = useState<"table" | "grid">("table");
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const counts = useMemo(
    () => ({
      all: libraryMatches.length,
      ready: libraryMatches.filter((m) => m.status === "ready").length,
      analyzing: libraryMatches.filter((m) => m.status === "analyzing").length,
      queued: libraryMatches.filter((m) => m.status === "queued").length,
      failed: libraryMatches.filter((m) => m.status === "failed").length,
    }),
    [],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list: LibraryMatch[] = libraryMatches.filter((m) => {
      if (status !== "all" && m.status !== status) return false;
      if (
        q &&
        !(
          m.title.toLowerCase().includes(q) ||
          m.opponent.toLowerCase().includes(q) ||
          m.tournament.toLowerCase().includes(q)
        )
      ) {
        return false;
      }
      return true;
    });
    list = list.slice();
    if (sort === "recent") list.sort((a, b) => b.ord - a.ord);
    else if (sort === "oldest") list.sort((a, b) => a.ord - b.ord);
    else if (sort === "longest") list.sort((a, b) => b.durMin - a.durMin);
    else if (sort === "shots") list.sort((a, b) => b.shots - a.shots);
    else if (sort === "name")
      list.sort((a, b) => a.title.localeCompare(b.title));
    return list;
  }, [query, status, sort]);

  const selectedCount = Object.values(selected).filter(Boolean).length;
  const visibleIds = rows.map((m) => m.id);
  const allSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected[id]);

  const toggleOne = (id: string) =>
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  const toggleAll = () => {
    if (allSelected) setSelected({});
    else {
      const next: Record<string, boolean> = {};
      visibleIds.forEach((id) => {
        next[id] = true;
      });
      setSelected(next);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <AppTopbar
        title="Library"
        subtitle={`${counts.all} matches · ${counts.ready} analyzed`}
        searchPlaceholder="Search match or opponent…"
        showBell={false}
        showAccount={false}
        searchValue={query}
        onSearchChange={setQuery}
        onSearchClear={() => setQuery("")}
        actions={
          <Link href="/dashboard">
            <Button size="md">Upload footage</Button>
          </Link>
        }
      />

      <LibraryToolbar
        status={status}
        onStatusChange={setStatus}
        counts={counts}
        sort={sort}
        onSortChange={setSort}
        view={view}
        onViewChange={setView}
      />

      {selectedCount > 0 ? (
        <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--accent-soft)] px-7 py-[11px]">
          <span className="font-mono text-[12.5px] tabular-nums text-[var(--text-strong)]">
            {selectedCount} selected
          </span>
          <button
            type="button"
            onClick={() => setSelected({})}
            className="text-[12.5px] text-[var(--text-link)] hover:underline"
          >
            Clear
          </button>
          <div className="flex-1" />
          <Link
            href="/dashboard/compare"
            className="inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-1)] px-3 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-strong)]"
          >
            <GitCompare className="h-[15px] w-[15px]" />
            Compare
          </Link>
          <button
            type="button"
            className="inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-1)] px-3 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-strong)]"
          >
            <Download className="h-[15px] w-[15px]" />
            Export
          </button>
          <button
            type="button"
            className="inline-flex h-[34px] items-center gap-1.5 rounded-lg px-3 text-[13px] text-[var(--danger-400)] hover:bg-[var(--danger-bg)]"
          >
            <Trash2 className="h-[15px] w-[15px]" />
            Delete
          </button>
        </div>
      ) : null}

      <div className="flex-1 px-7 pt-[18px] pb-10">
        {view === "table" ? (
          <LibraryTable
            rows={rows}
            selected={selected}
            allSelected={allSelected}
            onToggleOne={toggleOne}
            onToggleAll={toggleAll}
          />
        ) : (
          <LibraryGrid rows={rows} selected={selected} />
        )}
      </div>
    </div>
  );
}
