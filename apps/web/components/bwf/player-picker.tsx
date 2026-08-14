"use client";

import { ChevronsUpDown, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { H2hPickerPlayer } from "@/lib/bwf/types";
import { cn } from "@/lib/utils";

type Accent = "a" | "b";

/**
 * Searchable player dropdown. Uses a slim seed list plus optional remote
 * typeahead (`/api/bwf/players`) so the full directory need not be serialized.
 */
export function PlayerPicker({
  players,
  selectedId,
  placeholder = "Select player",
  accent = "a",
  excludeId,
  disabled = false,
  remoteSearch = false,
  onSelect,
}: {
  players: H2hPickerPlayer[];
  selectedId: string;
  placeholder?: string;
  accent?: Accent;
  /** Optional id to hide from the list (e.g. already picked as opponent). */
  excludeId?: string;
  disabled?: boolean;
  /** When true, query the server once the user types 2+ characters. */
  remoteSearch?: boolean;
  onSelect: (player: H2hPickerPlayer) => void;
}) {
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<H2hPickerPlayer[] | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const selected =
    players.find((p) => p.id === selectedId) ??
    remote?.find((p) => p.id === selectedId) ??
    null;

  useEffect(() => {
    if (!remoteSearch || !open) return;
    const q = query.trim();
    if (q.length < 2) {
      setRemote(null);
      setRemoteLoading(false);
      setRemoteError(false);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      setRemoteLoading(true);
      setRemoteError(false);
      try {
        const res = await fetch(
          `/api/bwf/players?q=${encodeURIComponent(q)}&limit=40`,
        );
        if (!res.ok) throw new Error("search failed");
        const data = (await res.json()) as { players?: H2hPickerPlayer[] };
        if (!cancelled) {
          setRemote(data.players ?? []);
          setRemoteError(false);
        }
      } catch {
        if (!cancelled) {
          setRemote(null);
          setRemoteError(true);
        }
      } finally {
        if (!cancelled) setRemoteLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query, open, remoteSearch]);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    const source =
      remoteSearch && q.length >= 2 && remote != null ? remote : players;
    return source
      .filter((p) => !excludeId || p.id !== excludeId)
      .filter((p) => {
        if (remoteSearch && q.length >= 2 && remote != null) return true;
        return !q || p.name.toLowerCase().includes(q);
      })
      .slice(0, 40);
  }, [players, query, excludeId, remote, remoteSearch]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query, options.length, open]);

  useEffect(() => {
    if (open) {
      // Defer so the open input is mounted.
      const t = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  const borderFocus =
    accent === "a"
      ? "border-[var(--player-a)] shadow-[var(--ring)]"
      : "border-[var(--player-b)]";
  const openStyle =
    accent === "b"
      ? {
          borderColor: "var(--player-b)",
          boxShadow: "var(--ring-player-b)",
        }
      : undefined;

  const pick = (p: H2hPickerPlayer) => {
    onSelect(p);
    setOpen(false);
    setQuery("");
    setRemote(null);
    setRemoteError(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQuery("");
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (options.length === 0) return;
      setActiveIdx((i) => Math.min(i + 1, options.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (options.length === 0) return;
      setActiveIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const hit = options[activeIdx];
      if (hit) pick(hit);
    }
  };

  const statusText = remoteLoading
    ? "Searching catalog…"
    : remoteError
      ? "Search unavailable — try again."
      : options.length === 0
        ? remoteSearch && query.trim().length < 2
          ? "Type at least 2 characters, or pick from the list."
          : "No players match."
        : `${options.length} player${options.length === 1 ? "" : "s"}`;

  return (
    <div className="relative min-w-0 flex-1">
      {!open ? (
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={false}
          onClick={() => {
            if (disabled) return;
            setOpen(true);
            setQuery("");
            setRemote(null);
            setRemoteError(false);
          }}
          className={cn(
            "flex min-h-10 h-10 w-full items-center gap-2.5 rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] px-3 text-left hover:border-[var(--border-strong)]",
            disabled && "cursor-wait opacity-70",
          )}
        >
          <span className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--text-strong)]">
            {selected?.name ?? placeholder}
          </span>
          {selected ? (
            <span className="shrink-0 font-mono text-[11px] text-[var(--text-muted)]">
              {selected.country ? `${selected.country.toUpperCase()} · ` : ""}
              {selected.disc ?? "—"} · {selected.matches}
            </span>
          ) : null}
          <ChevronsUpDown className="h-[15px] w-[15px] shrink-0 text-[var(--text-muted)]" />
        </button>
      ) : (
        <div className="relative">
          <div
            className={cn(
              "flex min-h-10 h-10 items-center gap-2 rounded-[9px] border bg-[var(--surface-1)] px-3",
              accent === "a" && borderFocus,
            )}
            style={openStyle}
          >
            <Search className="h-[15px] w-[15px] shrink-0 text-[var(--text-muted)]" />
            <input
              ref={inputRef}
              disabled={disabled}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              onKeyDown={onKeyDown}
              placeholder={
                remoteSearch ? "Type 2+ letters to search…" : "Search players…"
              }
              role="combobox"
              aria-expanded
              aria-haspopup="listbox"
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={
                options[activeIdx]
                  ? `${listboxId}-opt-${activeIdx}`
                  : undefined
              }
              aria-label="Search players"
              className="min-w-0 flex-1 border-none bg-transparent text-[13px] text-[var(--text-strong)] outline-none"
            />
          </div>
          <div
            id={listboxId}
            role="listbox"
            aria-label="Player options"
            className="absolute left-0 right-0 top-11 z-60 max-h-[300px] overflow-y-auto rounded-[11px] border border-[var(--border-strong)] bg-[var(--surface-1)] p-1.5 shadow-[var(--shadow-xl)]"
          >
            <div className="sr-only" aria-live="polite">
              {statusText}
            </div>
            {remoteLoading ? (
              <div className="px-2.5 py-3 text-[12.5px] text-[var(--text-muted)]">
                Searching catalog…
              </div>
            ) : remoteError ? (
              <div className="px-2.5 py-3 text-[12.5px] text-[var(--text-muted)]">
                Search unavailable — try again.
                {options.length > 0 ? " Showing seed list below." : ""}
              </div>
            ) : null}
            {!remoteLoading && options.length === 0 && !remoteError ? (
              <div className="px-2.5 py-3 text-[12.5px] text-[var(--text-muted)]">
                {remoteSearch && query.trim().length < 2
                  ? "Type at least 2 characters, or pick from the list."
                  : "No players match."}
              </div>
            ) : null}
            {!remoteLoading && options.length > 0
              ? options.map((p, i) => (
                  <button
                    key={p.id}
                    id={`${listboxId}-opt-${i}`}
                    type="button"
                    role="option"
                    aria-selected={i === activeIdx}
                    disabled={disabled}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => pick(p)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 min-h-10 text-left",
                      i === activeIdx
                        ? "bg-[var(--surface-2)]"
                        : "hover:bg-[var(--surface-2)]",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-strong)]">
                      {p.name}
                      {p.country ? (
                        <span className="ml-1.5 font-mono text-[10.5px] uppercase text-[var(--text-faint)]">
                          {p.country}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 font-mono text-[10.5px] text-[var(--text-muted)]">
                      {p.disc ?? "—"} · {p.matches}
                    </span>
                  </button>
                ))
              : null}
          </div>
        </div>
      )}
    </div>
  );
}
