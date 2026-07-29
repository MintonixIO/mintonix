"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronRight,
  Search,
  ShieldAlert,
  Swords,
  Trophy,
  User,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { SearchHit } from "@/lib/bwf/types";
import { cn } from "@/lib/utils";

function viewFromPath(pathname: string) {
  if (pathname.startsWith("/bwf/matches")) return "matches";
  if (pathname.startsWith("/bwf/players")) return "players";
  if (pathname.startsWith("/bwf/h2h")) return "h2h";
  return "home";
}

const VIEW_HREF: Record<string, string> = {
  home: "/bwf",
  matches: "/bwf/matches",
  players: "/bwf/players",
  h2h: "/bwf/h2h",
};

export function BwfShell({
  children,
  searchIndex = [],
}: {
  children: React.ReactNode;
  /** Lightweight server-built index for instant client search. */
  searchIndex?: SearchHit[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const view = viewFromPath(pathname);

  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [remoteHits, setRemoteHits] = useState<SearchHit[]>([]);
  const [remoteQuery, setRemoteQuery] = useState("");

  const localResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return searchIndex
      .filter(
        (h) =>
          h.label.toLowerCase().includes(q) ||
          h.sub.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [query, searchIndex]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;

    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/bwf/search?q=${encodeURIComponent(q.slice(0, 100))}`,
          { signal: controller.signal },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { hits?: SearchHit[] };
        if (controller.signal.aborted) return;
        setRemoteHits(data.hits ?? []);
        setRemoteQuery(q);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        /* keep local results on network failure */
      }
    }, 220);

    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [query]);

  const searchResults =
    query.trim().length >= 2 && remoteQuery === query.trim()
      ? remoteHits
      : localResults;

  return (
    <div className="min-h-screen bg-[var(--bg-base)] font-sans text-[var(--text-primary)] antialiased">
      <header className="sticky top-0 z-50 flex h-[60px] items-center gap-3.5 border-b border-[var(--border-subtle)] bg-[rgba(10,16,32,0.82)] px-6 backdrop-blur-[14px]">
        <Link
          href="/"
          aria-label="Back to Mintonix"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]"
        >
          <ArrowLeft className="h-[18px] w-[18px]" />
        </Link>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/assets/logomark.png"
          alt="Mintonix"
          className="block h-[22px] w-auto"
        />
        <div className="hidden items-center gap-2 font-mono text-xs text-[var(--text-muted)] sm:flex">
          <span>Mintonix</span>
          <ChevronRight className="h-[13px] w-[13px]" />
          <span className="text-[var(--text-secondary)]">BWF library</span>
        </div>
        <div className="flex-1" />

        <div className="relative w-[min(360px,40vw)]">
          <div className="flex h-9 items-center gap-2 rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] px-3">
            <Search className="h-[15px] w-[15px] shrink-0 text-[var(--text-faint)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
              placeholder="Search players, matches, tournaments…"
              className="min-w-0 flex-1 border-none bg-transparent text-[13px] text-[var(--text-strong)] outline-none placeholder:text-[var(--text-faint)]"
            />
            {query ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery("")}
                className="text-[var(--text-muted)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          {searchFocused && query.trim().length >= 1 ? (
            <div className="absolute left-0 right-0 top-11 z-60 max-h-96 overflow-y-auto rounded-xl border border-[var(--border-strong)] bg-[var(--surface-1)] p-1.5 shadow-[var(--shadow-xl)]">
              {searchResults.length ? (
                searchResults.map((r) => {
                  const Icon =
                    r.kind === "Player"
                      ? User
                      : r.kind === "Match"
                        ? Swords
                        : Trophy;
                  return (
                    <button
                      key={`${r.kind}-${r.id}`}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        router.push(r.href);
                        setQuery("");
                        setSearchFocused(false);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--surface-2)]"
                    >
                      <span className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--accent)]">
                        <Icon className="h-[15px] w-[15px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] text-[var(--text-strong)]">
                          {r.label}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[10.5px] text-[var(--text-muted)]">
                          {r.sub}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-wide text-[var(--text-faint)]">
                        {r.kind}
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="px-3 py-4 text-[13px] text-[var(--text-muted)]">
                  No players, matches, or tournaments match that search.
                </div>
              )}
            </div>
          ) : null}
        </div>

        <nav className="mx-tabs mx-tabs--pill" aria-label="BWF library">
          {(
            [
              { value: "home", label: "Home" },
              { value: "matches", label: "Matches" },
              { value: "players", label: "Players" },
              { value: "h2h", label: "Head-to-Head" },
            ] as const
          ).map((it) => {
            const href = VIEW_HREF[it.value];
            const on = view === it.value;
            return (
              <Link
                key={it.value}
                href={href}
                className={cn("mx-tab", on && "is-active")}
                aria-current={on ? "page" : undefined}
                aria-selected={on}
              >
                {it.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <div className="mx-auto max-w-[1320px] px-6 pb-0 pt-[26px]">
        {children}

        <footer className="mt-14 border-t border-[var(--border-subtle)] pb-10 pt-[26px]">
          <div className="mb-[18px] flex items-start gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] px-[18px] py-4">
            <ShieldAlert className="mt-0.5 h-[17px] w-[17px] shrink-0 text-[var(--text-muted)]" />
            <div>
              <div className="mb-[5px] text-[13px] font-medium text-[var(--text-strong)]">
                Not affiliated with the Badminton World Federation
              </div>
              <p className="m-0 max-w-[96ch] text-[12.5px] leading-[1.6] text-[var(--text-muted)]">
                Mintonix is an independent project and is not affiliated with,
                endorsed by, sponsored by, or in any way officially connected to
                the Badminton World Federation (BWF) or any of its events.
                &quot;BWF&quot;, &quot;BWF World Tour&quot;, event names, and all
                associated marks are the property of their respective owners and
                are used here for identification and descriptive purposes only.
                Match scores and rosters are loaded from the Mintonix catalog
                (scraped public results). Pipeline analysis fields appear only
                when a match has been processed.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <span className="font-mono text-[11.5px] text-[var(--text-faint)]">
              © 2026 Mintonix · Independent badminton analytics
            </span>
            <div className="flex-1" />
            <div className="flex gap-[22px]">
              <Link
                href="/terms"
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              >
                Terms
              </Link>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
