"use client";

import Link from "next/link";
import {
  Clapperboard,
  Flame,
  LayoutGrid,
  Video,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useMemo, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MatchCard } from "@/components/bwf/match-card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import type { CatalogMatch, CatalogStats, Disc } from "@/lib/bwf/types";
import { DISC_LABEL, DISCS } from "@/lib/bwf/types";
import { cn } from "@/lib/utils";

const LENS = [
  { id: "all", label: "All matches", icon: LayoutGrid },
  { id: "video", label: "With video", icon: Video },
  { id: "three", label: "Three-game wars", icon: Clapperboard },
  { id: "comeback", label: "Comebacks", icon: Flame },
] as const;

type LensId = (typeof LENS)[number]["id"];

export function MatchesView({
  matches,
  total,
  page,
  pageSize,
  totalPages,
  stats,
  filters,
}: {
  matches: CatalogMatch[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  stats: CatalogStats;
  filters: {
    q: string;
    disc: Disc | "all";
    event: string;
    round: string;
    year: string;
    sort: string;
    lens: LensId;
  };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const sp = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === "" || v === "all") sp.delete(k);
        else sp.set(k, v);
      }
      if (!("page" in patch)) sp.delete("page");
      const qs = sp.toString();
      startTransition(() => {
        router.push(qs ? `${pathname}?${qs}` : pathname);
      });
    },
    [pathname, router, searchParams],
  );

  const lensNote = useMemo(() => {
    if (filters.lens === "video")
      return "Only matches with an allowlisted YouTube source URL";
    if (filters.lens === "three") return "Best-of-3 matches that went the distance";
    if (filters.lens === "comeback")
      return "Lost game one, won the match in three";
    return null;
  }, [filters.lens]);

  const highlight =
    filters.lens === "video"
      ? "video"
      : filters.lens === "three"
        ? "three"
        : filters.lens === "comeback"
          ? "comeback"
          : null;

  const pageHref = (p: number) => {
    const sp = new URLSearchParams(searchParams.toString());
    if (p <= 1) sp.delete("page");
    else sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  return (
    <section>
      <div className="mb-5">
        <h1 className="font-display text-[28px] font-semibold tracking-[-0.025em] text-[var(--text-strong)]">
          Match library
        </h1>
        <p className="mt-[7px] max-w-[62ch] text-[14.5px] leading-[1.55] text-[var(--text-secondary)]">
          Live BWF catalog from Supabase — filter by discipline, tournament,
          round, or player, then open any match for scores, roster, and video
          when available.
        </p>
      </div>

      <div className="mb-[18px] flex flex-wrap items-center gap-3 [&_button]:min-h-10 [&_a]:min-h-10">
        <Tabs
          variant="pill"
          value={filters.disc}
          onChange={(v) => setParams({ disc: v })}
          items={[
            { value: "all", label: "All" },
            ...DISCS.map((d) => ({ value: d, label: d })),
          ]}
        />
        <div className="flex-1" />
        <span
          className={cn(
            "font-mono text-xs text-[var(--text-muted)]",
            pending && "opacity-90",
          )}
        >
          {total.toLocaleString()} matches
          {totalPages > 1 ? ` · page ${page}/${totalPages}` : ""}
        </span>
      </div>

      <div className="mb-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
        <Input
          key={`q-${filters.q}`}
          label="Search"
          size="md"
          className="min-h-10"
          defaultValue={filters.q}
          placeholder="Player, event…"
          aria-label="Search matches by player or event"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setParams({ q: (e.target as HTMLInputElement).value });
            }
          }}
          onBlur={(e) => {
            if (e.target.value !== filters.q) setParams({ q: e.target.value });
          }}
        />
        <div className="flex min-w-[min(220px,100%)] flex-col gap-1">
          <label
            htmlFor="bwf-event-filter"
            className="text-[11px] font-medium tracking-wide text-[var(--text-secondary)]"
          >
            Tournament
          </label>
          <input
            id="bwf-event-filter"
            list="bwf-event-options"
            defaultValue={filters.event}
            key={filters.event || "all-events"}
            placeholder="Type to filter events…"
            aria-label="Filter by tournament"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setParams({
                  event: (e.target as HTMLInputElement).value || null,
                });
              }
            }}
            onBlur={(e) => {
              const v = e.target.value;
              if (v !== filters.event) setParams({ event: v || null });
            }}
            className="min-h-10 h-10 rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[13px] text-[var(--text-strong)] outline-none placeholder:text-[var(--text-faint)] focus:border-[var(--brand)] focus:shadow-[var(--ring)]"
          />
          <datalist id="bwf-event-options">
            {stats.events.map((e) => (
              <option key={e.event} value={e.event}>
                {e.count} matches
              </option>
            ))}
          </datalist>
        </div>
        <Select
          label="Round"
          size="md"
          className="min-h-10"
          value={filters.round}
          onChange={(e) => setParams({ round: e.target.value || null })}
        >
          <option value="">All rounds</option>
          {stats.rounds.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
        <Select
          label="Year"
          size="md"
          className="min-h-10"
          value={filters.year === "all" ? "" : filters.year}
          onChange={(e) => setParams({ year: e.target.value || null })}
        >
          <option value="">All years</option>
          {stats.years.map((y) => (
            <option key={y} value={String(y)}>
              {y}
            </option>
          ))}
        </Select>
        <Select
          label="Sort"
          size="md"
          className="min-h-10"
          value={filters.sort}
          onChange={(e) => setParams({ sort: e.target.value })}
        >
          <option value="event">Event / round</option>
          <option value="round">Latest rounds first</option>
          <option value="created">Ingested recently</option>
          <option value="status">Analysis status</option>
        </Select>
      </div>

      <div className="mb-[18px]">
        <div className="flex flex-wrap gap-2">
          {LENS.map((l) => {
            const Icon = l.icon as LucideIcon;
            const on = filters.lens === l.id;
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => setParams({ lens: l.id === "all" ? null : l.id })}
                className={cn(
                  "inline-flex min-h-10 h-10 items-center gap-1.5 rounded-full border px-[13px] text-[13px]",
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
        {filters.disc !== "all" ? (
          <div className="mt-2 font-mono text-[11.5px] text-[var(--text-muted)]">
            Showing {DISC_LABEL[filters.disc]}
          </div>
        ) : null}
      </div>

      {matches.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-[var(--border)] bg-[var(--surface-1)] px-6 py-16 text-center">
          <div className="font-display text-lg font-semibold text-[var(--text-strong)]">
            No matches match these filters
          </div>
          <p className="mx-auto mt-2 max-w-[40ch] text-[13.5px] text-[var(--text-muted)]">
            Try clearing the tournament or search query, or switch discipline.
          </p>
          <button
            type="button"
            onClick={() =>
              startTransition(() => {
                router.push("/bwf/matches");
              })
            }
            className="mt-5 inline-flex min-h-10 h-10 items-center rounded-[9px] border border-[var(--border)] bg-[var(--surface-2)] px-4 text-[13px] text-[var(--text-strong)] hover:border-[var(--border-strong)]"
          >
            Reset filters
          </button>
        </div>
      ) : (
        <div
          className={cn(
            "grid grid-cols-1 gap-4 pb-2 md:grid-cols-2 xl:grid-cols-3",
            pending && "opacity-90 transition-opacity",
          )}
        >
          {matches.map((m) => (
            <MatchCard key={m.id} m={m} highlight={highlight} />
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {page <= 1 ? (
            <span className="inline-flex min-h-10 h-10 items-center rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[13px] text-[var(--text-secondary)] opacity-40">
              Previous
            </span>
          ) : (
            <Link
              href={pageHref(page - 1)}
              className="inline-flex min-h-10 h-10 items-center rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[13px] text-[var(--text-secondary)]"
            >
              Previous
            </Link>
          )}
          <span className="px-2 font-mono text-xs text-[var(--text-muted)]">
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of{" "}
            {total.toLocaleString()}
          </span>
          {page >= totalPages ? (
            <span className="inline-flex min-h-10 h-10 items-center rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[13px] text-[var(--text-secondary)] opacity-40">
              Next
            </span>
          ) : (
            <Link
              href={pageHref(page + 1)}
              className="inline-flex min-h-10 h-10 items-center rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[13px] text-[var(--text-secondary)]"
            >
              Next
            </Link>
          )}
        </div>
      ) : null}
    </section>
  );
}
