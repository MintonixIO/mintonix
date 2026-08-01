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
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  BWF_SEARCH_LIMIT,
  BWF_SEARCH_MAX_Q,
  type SearchHit,
} from "@/lib/bwf/types";
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
  searchIndex?: SearchHit[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const view = viewFromPath(pathname);
  const listboxId = useId();

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [remoteHits, setRemoteHits] = useState<SearchHit[]>([]);
  const [remoteQuery, setRemoteQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const localResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return searchIndex
      .filter((h) => h.label.toLowerCase().includes(q))
      .slice(0, BWF_SEARCH_LIMIT);
  }, [query, searchIndex]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSearchLoading(false);
      setSearchError(false);
      return;
    }
    const controller = new AbortController();
    setSearchLoading(true);
    setSearchError(false);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/bwf/search?q=${encodeURIComponent(q.slice(0, BWF_SEARCH_MAX_Q))}`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          if (!controller.signal.aborted) {
            setSearchError(true);
            setSearchLoading(false);
          }
          return;
        }
        const data = (await res.json()) as { hits?: SearchHit[] };
        if (controller.signal.aborted) return;
        setRemoteHits(data.hits ?? []);
        setRemoteQuery(q);
        setSearchError(false);
        setSearchLoading(false);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!controller.signal.aborted) {
          setSearchError(true);
          setSearchLoading(false);
        }
      }
    }, 220);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [query]);

  const qTrim = query.trim();
  const remoteReady = qTrim.length >= 2 && remoteQuery === qTrim && !searchLoading;
  const searchResults = remoteReady ? remoteHits : localResults;
  const showSearchingPlaceholder =
    open && qTrim.length >= 2 && searchLoading && !remoteReady;

  const listOpen = open && qTrim.length >= 1;

  useEffect(() => {
    setActiveIdx(0);
  }, [query, searchResults.length]);

  const goResult = (r: SearchHit) => {
    router.push(r.href);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQuery("");
      return;
    }
    if (!listOpen || searchResults.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, searchResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = searchResults[activeIdx];
      if (hit) goResult(hit);
    }
  };

  const liveStatus = !listOpen
    ? ""
    : showSearchingPlaceholder
      ? "Searching catalog…"
      : searchError
        ? "Search unavailable"
        : searchResults.length === 0
          ? "No results"
          : `${searchResults.length} result${searchResults.length === 1 ? "" : "s"}`;

  return (
    <div className="min-h-screen bg-[var(--bg-base)] font-sans text-[var(--text-primary)] antialiased">
      <header className="sticky top-0 z-50 grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-2 border-b border-[var(--border-subtle)] bg-[var(--surface-1)]/95 px-3 py-2 backdrop-blur-[var(--blur-md,14px)] sm:flex sm:h-14 sm:gap-3 sm:px-5 sm:py-0">
        <Link
          href="/"
          aria-label="Back to Mintonix"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]"
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

        <div className="relative col-span-3 min-w-0 sm:col-span-1 sm:w-[min(320px,36vw)] sm:flex-1 md:max-w-[360px]">
          <div className="flex h-10 items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface-1)] px-3">
            <Search className="h-[15px] w-[15px] shrink-0 text-[var(--text-muted)]" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              onKeyDown={onKeyDown}
              placeholder="Search players, matches, tournaments…"
              aria-label="Search BWF players, matches, and tournaments"
              role="combobox"
              aria-expanded={listOpen}
              aria-haspopup="listbox"
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={
                listOpen && searchResults[activeIdx]
                  ? `${listboxId}-opt-${activeIdx}`
                  : undefined
              }
              className="min-w-0 flex-1 border-none bg-transparent text-[13px] text-[var(--text-strong)] outline-none placeholder:text-[var(--text-muted)]"
            />
            {query ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setQuery("");
                  setOpen(false);
                  inputRef.current?.focus();
                }}
                className="inline-flex min-h-10 min-w-10 items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-strong)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          {listOpen ? (
            <div
              id={listboxId}
              role="listbox"
              aria-label="Search results"
              className="absolute left-0 right-0 top-11 z-60 max-h-96 overflow-y-auto rounded-xl border border-[var(--border-strong)] bg-[var(--surface-1)] p-1.5 shadow-[var(--shadow-xl)]"
            >
              <div className="sr-only" aria-live="polite">
                {liveStatus}
              </div>
              {showSearchingPlaceholder ? (
                <div className="px-3 py-4 text-[13px] text-[var(--text-muted)]">
                  Searching catalog…
                </div>
              ) : searchError && searchResults.length === 0 ? (
                <div className="px-3 py-4 text-[13px] text-[var(--text-muted)]">
                  Search unavailable — try again in a moment.
                </div>
              ) : searchResults.length ? (
                <>
                  {searchError ? (
                    <div className="px-2.5 py-2 text-[12px] text-[var(--text-muted)]">
                      Live search failed — showing local matches only.
                    </div>
                  ) : null}
                  {searchResults.map((r, i) => {
                    const Icon =
                      r.kind === "Player"
                        ? User
                        : r.kind === "Match"
                          ? Swords
                          : Trophy;
                    return (
                      <button
                        key={`${r.kind}-${r.id}`}
                        id={`${listboxId}-opt-${i}`}
                        type="button"
                        role="option"
                        aria-selected={i === activeIdx}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setActiveIdx(i)}
                        onClick={() => goResult(r)}
                        className={cn(
                          "flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left",
                          i === activeIdx
                            ? "bg-[var(--surface-2)]"
                            : "hover:bg-[var(--surface-2)]",
                        )}
                      >
                        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--accent)]">
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
                        <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-wide text-[var(--text-muted)]">
                          {r.kind}
                        </span>
                      </button>
                    );
                  })}
                </>
              ) : (
                <div className="px-3 py-4 text-[13px] text-[var(--text-muted)]">
                  No players, matches, or tournaments match that search.
                </div>
              )}
            </div>
          ) : null}
        </div>

        <nav
          className="mx-tabs mx-tabs--pill col-span-3 min-h-10 w-full overflow-x-auto sm:col-span-1 sm:ml-auto sm:w-auto"
          aria-label="BWF library sections"
        >
          {(
            [
              { value: "home", label: "Home", short: "Home" },
              { value: "matches", label: "Matches", short: "Matches" },
              { value: "players", label: "Players", short: "Players" },
              { value: "h2h", label: "Head-to-Head", short: "H2H" },
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
              >
                <span className="sm:hidden">{it.short}</span>
                <span className="hidden sm:inline">{it.label}</span>
              </Link>
            );
          })}
        </nav>
      </header>

      <div className="mx-auto max-w-[1320px] px-4 pb-0 pt-5 sm:px-6 sm:pt-[26px]">
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
                "BWF", "BWF World Tour", event names, and all
                associated marks are the property of their respective owners and
                are used here for identification and descriptive purposes only.
                Match scores and rosters are loaded from the Mintonix catalog
                (scraped public results). Pipeline analysis fields appear only
                when a match has been processed.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <span className="font-mono text-[11.5px] text-[var(--text-muted)]">
              © 2026 Mintonix · Independent badminton analytics
            </span>
            <div className="flex-1" />
            <Link
              href="/terms"
              className="inline-flex min-h-10 items-center text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            >
              Terms
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
