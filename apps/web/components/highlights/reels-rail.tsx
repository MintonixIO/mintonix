import Link from "next/link";
import { Film } from "lucide-react";
import { REELS } from "@/lib/highlights/reels";

export function ReelsRail() {
  return (
    <section className="flex flex-col gap-3 border-t border-[var(--border-subtle)] pt-[18px]">
      <div className="flex items-center gap-2">
        <Film className="h-[15px] w-[15px] text-[var(--text-muted)]" />
        <h2 className="font-display text-sm font-semibold text-[var(--text-strong)]">
          Saved reels
        </h2>
        <span className="font-mono text-[11px] text-[var(--text-muted)]">
          {REELS.length} reels
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {REELS.map((r) => (
          <Link
            key={r.id}
            href="/video-analysis"
            className="flex flex-col gap-1.5 rounded-[11px] border border-[var(--border)] bg-[var(--surface-1)] px-[13px] py-3 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]"
          >
            <span className="truncate text-[13px] font-semibold text-[var(--text-strong)]">
              {r.title}
            </span>
            <span className="truncate font-mono text-[10.5px] text-[var(--text-muted)]">
              {r.criteriaLabel}
            </span>
            <span className="flex items-center gap-2 font-mono text-[10.5px] text-[var(--text-muted)]">
              {r.clips} clips · {r.dur}
              <span className="flex-1" />
              {r.status === "ready" ? (
                <span className="inline-flex items-center gap-1 text-[var(--success-500)]">
                  <span className="h-[5px] w-[5px] rounded-full bg-[var(--success-500)]" />
                  Ready
                </span>
              ) : r.status === "draft" ? (
                <span className="text-[var(--text-secondary)]">Draft</span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[var(--accent)]">
                  <span className="h-[5px] w-[5px] animate-pulse rounded-full bg-[var(--accent)]" />
                  {r.progress}%
                </span>
              )}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
