import type { LibraryMatch } from "@/lib/matches";

export function StatusPill({ m }: { m: LibraryMatch }) {
  if (m.status === "ready") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--success-bg)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--success-500)]">
        <span className="h-[5px] w-[5px] rounded-full bg-[var(--success-500)]" />
        Analyzed
      </span>
    );
  }
  if (m.status === "analyzing") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(54,147,255,0.3)] bg-[var(--brand-subtle)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--accent)]">
        <span className="h-[5px] w-[5px] animate-pulse rounded-full bg-[var(--accent)]" />
        {m.progress ?? 0}%
      </span>
    );
  }
  if (m.status === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(244,81,92,0.3)] bg-[var(--danger-bg)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--danger-400)]">
        <span className="h-[5px] w-[5px] rounded-full bg-[var(--danger-400)]" />
        Failed
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
