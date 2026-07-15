"use client";

import Link from "next/link";
import {
  Check,
  Download,
  GitCompare,
  LayoutGrid,
  List,
  MoreHorizontal,
  Play,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { AppTopbar } from "@/components/app/app-topbar";
import { VideoCard } from "@/components/app/video-card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type MatchStatus = "analyzed" | "processing" | "queued";

type LibraryMatch = {
  id: string;
  title: string;
  opponent: string;
  tournament: string;
  date: string;
  ord: number;
  status: MatchStatus;
  win: boolean | null;
  score: string;
  shots: number;
  size: string;
  dur: string | null;
  durMin: number;
  progress?: number;
};

const MATCHES: LibraryMatch[] = [
  {
    id: "m1",
    title: "Axelsen vs Momota",
    opponent: "Kento Momota",
    tournament: "All England · Final",
    date: "12 Jun",
    ord: 220,
    status: "analyzed",
    win: true,
    score: "21–18, 21–16",
    shots: 312,
    size: "1.4 GB",
    dur: "41:20",
    durMin: 41,
  },
  {
    id: "m2",
    title: "An Se-young vs Marín",
    opponent: "Carolina Marín",
    tournament: "All England · SF",
    date: "10 Jun",
    ord: 210,
    status: "analyzed",
    win: true,
    score: "21–14, 19–21, 21–17",
    shots: 248,
    size: "1.1 GB",
    dur: "33:05",
    durMin: 33,
  },
  {
    id: "m3",
    title: "Singles drills — session 14",
    opponent: "Training",
    tournament: "Velocity BC · Court 2",
    date: "Today",
    ord: 999,
    status: "processing",
    win: null,
    score: "",
    shots: 0,
    size: "2.2 GB",
    dur: null,
    durMin: 0,
    progress: 64,
  },
  {
    id: "m4",
    title: "Tai Tzu-ying vs Sindhu",
    opponent: "P.V. Sindhu",
    tournament: "Indonesia Open · Group B",
    date: "03 Jun",
    ord: 160,
    status: "analyzed",
    win: false,
    score: "18–21, 21–23",
    shots: 274,
    size: "1.3 GB",
    dur: "38:12",
    durMin: 38,
  },
  {
    id: "m5",
    title: "Lin vs Lee — exhibition",
    opponent: "Lee Chong Wei",
    tournament: "Legends Exhibition",
    date: "01 Jun",
    ord: 150,
    status: "analyzed",
    win: true,
    score: "21–19, 21–19",
    shots: 356,
    size: "1.6 GB",
    dur: "46:51",
    durMin: 46,
  },
  {
    id: "m6",
    title: "Antonsen vs Ginting",
    opponent: "Anthony Ginting",
    tournament: "Malaysia Masters · QF",
    date: "28 May",
    ord: 140,
    status: "analyzed",
    win: false,
    score: "21–17, 15–21, 19–21",
    shots: 298,
    size: "1.5 GB",
    dur: "44:08",
    durMin: 44,
  },
  {
    id: "m7",
    title: "Footwork ladder — court 1",
    opponent: "Training",
    tournament: "Velocity BC · Drills",
    date: "26 May",
    ord: 130,
    status: "analyzed",
    win: null,
    score: "",
    shots: 92,
    size: "640 MB",
    dur: "14:22",
    durMin: 14,
  },
  {
    id: "m8",
    title: "Yamaguchi vs Chochuwong",
    opponent: "Pornpawee Chochuwong",
    tournament: "Thailand Open · R16",
    date: "21 May",
    ord: 110,
    status: "queued",
    win: null,
    score: "",
    shots: 0,
    size: "1.2 GB",
    dur: "36:40",
    durMin: 36,
  },
  {
    id: "m9",
    title: "Christie vs Lakshya Sen",
    opponent: "Lakshya Sen",
    tournament: "Singapore Open · SF",
    date: "18 May",
    ord: 100,
    status: "analyzed",
    win: true,
    score: "21–15, 21–18",
    shots: 261,
    size: "1.2 GB",
    dur: "34:55",
    durMin: 34,
  },
  {
    id: "m10",
    title: "Doubles set — Velocity pairs",
    opponent: "Internal",
    tournament: "Velocity BC · Court 3",
    date: "15 May",
    ord: 90,
    status: "analyzed",
    win: null,
    score: "",
    shots: 188,
    size: "980 MB",
    dur: "28:30",
    durMin: 28,
  },
  {
    id: "m11",
    title: "Kunlavut vs Popov",
    opponent: "Christo Popov",
    tournament: "French Open · QF",
    date: "11 May",
    ord: 80,
    status: "analyzed",
    win: true,
    score: "21–12, 21–19",
    shots: 233,
    size: "1.1 GB",
    dur: "31:12",
    durMin: 31,
  },
  {
    id: "m12",
    title: "Shi Yu Qi vs Lee Zii Jia",
    opponent: "Lee Zii Jia",
    tournament: "Asia Champ. · Final",
    date: "04 May",
    ord: 70,
    status: "analyzed",
    win: false,
    score: "21–18, 18–21, 17–21",
    shots: 341,
    size: "1.7 GB",
    dur: "49:40",
    durMin: 49,
  },
];

const STATUS_TABS: { v: "all" | MatchStatus; label: string }[] = [
  { v: "all", label: "All" },
  { v: "analyzed", label: "Analyzed" },
  { v: "processing", label: "Processing" },
  { v: "queued", label: "Queued" },
];

function StatusPill({ m }: { m: LibraryMatch }) {
  if (m.status === "analyzed") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(45,212,167,0.3)] bg-[var(--success-bg)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--success-500)]">
        <span className="h-[5px] w-[5px] rounded-full bg-[var(--success-500)]" />
        Analyzed
      </span>
    );
  }
  if (m.status === "processing") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(54,147,255,0.3)] bg-[var(--brand-subtle)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--accent)]">
        <span className="h-[5px] w-[5px] animate-pulse rounded-full bg-[var(--accent)]" />
        {m.progress ?? 0}%
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[rgba(154,168,194,0.1)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--text-secondary)]">
      <span className="h-[5px] w-[5px] rounded-full bg-[var(--text-muted)]" />
      Queued
    </span>
  );
}

export function LibraryApp() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | MatchStatus>("all");
  const [sort, setSort] = useState("recent");
  const [view, setView] = useState<"table" | "grid">("table");
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const counts = useMemo(
    () => ({
      all: MATCHES.length,
      analyzed: MATCHES.filter((m) => m.status === "analyzed").length,
      processing: MATCHES.filter((m) => m.status === "processing").length,
      queued: MATCHES.filter((m) => m.status === "queued").length,
    }),
    [],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = MATCHES.filter((m) => {
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
        subtitle={`${counts.all} matches · ${counts.analyzed} analyzed`}
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

      {/* Filter toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] px-7 py-4">
        <div className="flex gap-0.5 rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] p-0.5">
          {STATUS_TABS.map((t) => {
            const active = status === t.v;
            const count = counts[t.v];
            return (
              <button
                key={t.v}
                type="button"
                onClick={() => setStatus(t.v)}
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
            onChange={(e) => setSort(e.target.value)}
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
            onClick={() => setView("table")}
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
            onClick={() => setView("grid")}
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

      {/* Bulk action bar */}
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
          <div className="overflow-hidden rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-edge)]">
            <div className="mx-scroll overflow-x-auto">
              <div className="min-w-[880px]">
                <div className="grid grid-cols-[38px_minmax(0,3fr)_minmax(0,1.3fr)_110px_120px_84px_78px_40px] items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-[11px] font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)] uppercase">
                  <button
                    type="button"
                    aria-label="Select all"
                    onClick={toggleAll}
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
                          onClick={() => toggleOne(m.id)}
                          className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border-[1.5px] border-[var(--border-strong)] bg-[var(--surface-2)] p-0"
                        >
                          {sel ? (
                            <Check className="h-3 w-3 text-[var(--accent)]" />
                          ) : null}
                        </button>
                        <Link
                          href={
                            m.status === "analyzed" ? "/video-analysis" : "#"
                          }
                          className="flex min-w-0 items-center gap-3 text-left"
                        >
                          <span className="relative inline-flex h-[30px] w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-md border border-[var(--border)] bg-[linear-gradient(160deg,#0f1b34_0%,#070b16_100%)]">
                            <span className="absolute inset-0 opacity-70 [background-image:linear-gradient(180deg,transparent_calc(50%-0.5px),rgba(154,168,194,0.4)_50%,transparent_calc(50%+0.5px))]" />
                            <Play className="relative h-[13px] w-[13px] text-[var(--text-secondary)]" />
                          </span>
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
                          href={
                            m.status === "analyzed" ? "/video-analysis" : "#"
                          }
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
        ) : (
          <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((m) => {
              const sel = !!selected[m.id];
              if (m.status !== "analyzed") {
                return (
                  <div key={m.id} className="relative">
                    {sel ? (
                      <div className="pointer-events-none absolute inset-0 z-[1] rounded-[14px] bg-[rgba(54,147,255,0.08)] shadow-[inset_3px_0_0_var(--accent)]" />
                    ) : null}
                    <VideoCard
                      v={{
                        id: m.id,
                        title: m.title,
                        players: m.opponent,
                        event: m.tournament,
                        duration: m.dur || "—",
                        status:
                          m.status === "processing" ? "analyzing" : "queued",
                        progress: m.progress,
                        date: m.date,
                      }}
                    />
                  </div>
                );
              }
              return (
                <div
                  key={m.id}
                  className="relative flex flex-col overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-edge)] transition-colors hover:border-[var(--border-strong)]"
                >
                  {sel ? (
                    <div className="pointer-events-none absolute inset-0 z-[1] bg-[rgba(54,147,255,0.08)] shadow-[inset_3px_0_0_var(--accent)]" />
                  ) : null}
                  <Link
                    href="/video-analysis"
                    className="relative aspect-video overflow-hidden bg-[linear-gradient(160deg,#0f1b34_0%,#070b16_100%)]"
                  >
                    <span
                      className="absolute inset-0 opacity-50"
                      style={{
                        backgroundImage:
                          "linear-gradient(90deg, transparent 28%, rgba(54,147,255,0.16) 28%, rgba(54,147,255,0.16) calc(28% + 1px), transparent calc(28% + 1px)), linear-gradient(90deg, transparent 72%, rgba(54,147,255,0.16) 72%, rgba(54,147,255,0.16) calc(72% + 1px), transparent calc(72% + 1px)), linear-gradient(180deg, transparent calc(50% - 1px), rgba(154,168,194,0.28) 50%, transparent calc(50% + 1px))",
                      }}
                    />
                    <span className="absolute top-1/2 left-1/2 inline-flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[rgba(54,147,255,0.92)] text-white shadow-[var(--glow-blue)]">
                      <Play className="ml-0.5 h-[18px] w-[18px]" />
                    </span>
                    <span className="absolute right-2.5 bottom-2.5 rounded-md border border-[var(--border)] bg-[rgba(7,11,22,0.78)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-strong)]">
                      {m.dur || "—"}
                    </span>
                  </Link>
                  <div className="flex flex-col gap-2.5 px-3.5 pt-[13px] pb-3.5">
                    <div>
                      <div className="truncate text-sm font-semibold text-[var(--text-strong)]">
                        {m.title}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--text-muted)]">
                        {m.opponent} · {m.date}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] pt-2.5 font-mono text-[11px] text-[var(--text-muted)]">
                      {m.win === true ? (
                        <span className="font-medium text-[var(--success-500)]">
                          W {m.score}
                        </span>
                      ) : m.win === false ? (
                        <span>L {m.score}</span>
                      ) : (
                        <span>Training</span>
                      )}
                      <div className="flex-1" />
                      <span>{m.shots ? m.shots : "—"} shots</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
