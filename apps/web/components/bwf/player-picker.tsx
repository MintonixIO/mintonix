"use client";

import { ChevronsUpDown, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { H2hPickerPlayer } from "@/lib/bwf/types";
import { cn } from "@/lib/utils";

type Accent = "a" | "b";

/**
 * Shared searchable player dropdown for H2H (and similar) pickers.
 */
export function PlayerPicker({
  players,
  selectedId,
  placeholder = "Select player",
  accent = "a",
  excludeId,
  disabled = false,
  onSelect,
}: {
  players: H2hPickerPlayer[];
  selectedId: string;
  placeholder?: string;
  accent?: Accent;
  /** Optional id to hide from the list (e.g. already picked as opponent). */
  excludeId?: string;
  disabled?: boolean;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = players.find((p) => p.id === selectedId) ?? null;

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return players
      .filter((p) => !excludeId || p.id !== excludeId)
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .slice(0, 40);
  }, [players, query, excludeId]);

  const borderFocus =
    accent === "a"
      ? "border-[var(--player-a)] shadow-[var(--ring)]"
      : "border-[var(--player-b)]";
  const openStyle =
    accent === "b"
      ? {
          borderColor: "var(--player-b)",
          boxShadow: "0 0 0 3px rgba(251,191,36,0.22)",
        }
      : undefined;

  return (
    <div className="relative min-w-0 flex-1">
      {!open ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            setOpen(true);
            setQuery("");
          }}
          className={cn(
            "flex h-[38px] w-full items-center gap-2.5 rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] px-3 text-left hover:border-[var(--border-strong)]",
            disabled && "cursor-wait opacity-70",
          )}
        >
          <span className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--text-strong)]">
            {selected?.name ?? placeholder}
          </span>
          {selected ? (
            <span className="shrink-0 font-mono text-[11px] text-[var(--text-muted)]">
              {selected.disc ?? "—"} · {selected.matches}
            </span>
          ) : null}
          <ChevronsUpDown className="h-[15px] w-[15px] shrink-0 text-[var(--text-muted)]" />
        </button>
      ) : (
        <div className="relative">
          <div
            className={cn(
              "flex h-[38px] items-center gap-2 rounded-[9px] border bg-[var(--surface-1)] px-3",
              accent === "a" && borderFocus,
            )}
            style={openStyle}
          >
            <Search className="h-[15px] w-[15px] shrink-0 text-[var(--text-faint)]" />
            <input
              autoFocus
              disabled={disabled}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              placeholder="Search players…"
              className="min-w-0 flex-1 border-none bg-transparent text-[13px] text-[var(--text-strong)] outline-none"
            />
          </div>
          <div className="absolute left-0 right-0 top-11 z-60 max-h-[300px] overflow-y-auto rounded-[11px] border border-[var(--border-strong)] bg-[var(--surface-1)] p-1.5 shadow-[var(--shadow-xl)]">
            {options.length === 0 ? (
              <div className="px-2.5 py-3 text-[12.5px] text-[var(--text-muted)]">
                No players match.
              </div>
            ) : (
              options.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={disabled}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onSelect(p.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--surface-2)]"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-strong)]">
                    {p.name}
                  </span>
                  <span className="shrink-0 font-mono text-[10.5px] text-[var(--text-muted)]">
                    {p.disc ?? "—"} · {p.matches}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
