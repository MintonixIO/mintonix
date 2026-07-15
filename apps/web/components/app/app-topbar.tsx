"use client";

import { Bell, Search, X } from "lucide-react";

export function AppTopbar({
  title,
  subtitle,
  actions,
  searchPlaceholder = "Search matches…",
  showSearch = true,
  showBell = true,
  showAccount = true,
  searchValue,
  onSearchChange,
  onSearchClear,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  searchPlaceholder?: string;
  showSearch?: boolean;
  showBell?: boolean;
  showAccount?: boolean;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  onSearchClear?: () => void;
}) {
  const controlled = onSearchChange != null;
  const hasQuery = controlled && (searchValue?.length ?? 0) > 0;

  return (
    <header className="sticky top-0 z-50 flex h-[76px] shrink-0 items-center gap-4 border-b border-[var(--border-subtle)] bg-[rgba(10,16,32,0.78)] px-7 backdrop-blur-[14px]">
      <div className="min-w-0 shrink-0">
        <div className="font-display text-lg font-semibold tracking-[-0.01em] text-[var(--text-strong)]">
          {title}
        </div>
        {subtitle ? (
          <div className="mt-px truncate font-mono text-[11.5px] text-[var(--text-muted)]">
            {subtitle}
          </div>
        ) : null}
      </div>
      <div className="flex-1" />
      {showSearch ? (
        <label className="hidden h-10 w-[300px] max-w-full items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface-1)] px-3.5 focus-within:border-[var(--border-strong)] md:flex">
          <Search className="h-4 w-4 shrink-0 text-[var(--text-muted)]" strokeWidth={1.75} />
          <input
            placeholder={searchPlaceholder}
            value={controlled ? (searchValue ?? "") : undefined}
            onChange={
              controlled ? (e) => onSearchChange(e.target.value) : undefined
            }
            className="min-w-0 flex-1 border-none bg-transparent text-[13.5px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-faint)]"
          />
          {hasQuery && onSearchClear ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={onSearchClear}
              className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text-strong)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : !controlled ? (
            <span className="rounded border border-[var(--border)] px-1.5 py-px font-mono text-[11px] text-[var(--text-faint)]">
              /
            </span>
          ) : null}
        </label>
      ) : null}
      {showBell ? (
        <button
          type="button"
          aria-label="Notifications"
          className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]"
        >
          <Bell className="h-[17px] w-[17px]" strokeWidth={1.75} />
          <span className="absolute top-2 right-[9px] h-1.5 w-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_0_2px_var(--surface-1)]" />
        </button>
      ) : null}
      {actions}
      {showAccount ? (
        <>
          <span className="hidden h-[26px] w-px shrink-0 bg-[var(--border-subtle)] sm:block" />
          <button
            type="button"
            aria-label="Account"
            className="inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border border-[var(--border-strong)] bg-[linear-gradient(150deg,#1c2a4a,#0e162d)] font-display text-[13px] font-semibold tracking-wide text-[var(--text-strong)] transition-colors hover:border-[var(--accent)]"
          >
            VK
          </button>
        </>
      ) : null}
    </header>
  );
}
