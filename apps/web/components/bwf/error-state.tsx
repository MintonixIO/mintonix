"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BookOpen, RefreshCw, Trophy } from "lucide-react";

export function BwfErrorState({
  title = "Catalog temporarily unavailable",
  message,
}: {
  title?: string;
  message?: string;
}) {
  const router = useRouter();

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-edge)]">
      <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-2)] px-6 py-4 sm:px-8">
        <div className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
          <Trophy className="h-3.5 w-3.5 text-[var(--accent)]" />
          BWF catalog
        </div>
      </div>
      <div className="px-6 py-12 text-center sm:px-10 sm:py-14">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-[14px] border border-[var(--border)] bg-[var(--accent-soft)] text-[var(--accent)]">
          <RefreshCw className="h-5 w-5" aria-hidden />
        </div>
        <h1 className="text-balance font-display text-xl font-semibold tracking-[-0.02em] text-[var(--text-strong)] sm:text-2xl">
          {title}
        </h1>
        <p className="mx-auto mt-3 max-w-[48ch] text-pretty text-sm leading-relaxed text-[var(--text-secondary)]">
          {message ||
            "We could not load the BWF match catalog right now. This is usually a missing or misconfigured server key, or a temporary data issue."}
        </p>
        <div className="mx-auto mt-8 flex max-w-md flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => {
              router.refresh();
              // Hard reload if soft refresh does not remount server data.
              window.setTimeout(() => {
                window.location.reload();
              }, 120);
            }}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] bg-[var(--brand)] px-5 text-sm font-medium text-[var(--text-on-blue)] hover:bg-[var(--brand-hover)]"
          >
            <RefreshCw className="h-4 w-4" />
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] px-5 text-sm font-medium text-[var(--text-strong)] hover:border-[var(--border-strong)]"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to home
          </Link>
          <Link
            href="/docs"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] border border-[var(--border)] px-5 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-strong)]"
          >
            <BookOpen className="h-4 w-4" />
            Docs
          </Link>
        </div>
        <p className="mx-auto mt-6 max-w-[42ch] font-mono text-[11px] leading-relaxed text-[var(--text-muted)]">
          If this keeps happening, the catalog may be temporarily offline.
        </p>
      </div>
    </section>
  );
}
