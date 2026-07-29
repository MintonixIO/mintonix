import Link from "next/link";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { CourtThumb } from "@/components/media/court-thumb";
import {
  MATCH_STATUS_UI,
  type MatchStatus,
  type MatchSummary,
} from "@/lib/matches";
import { cn } from "@/lib/utils";

/** @deprecated Prefer MatchSummary from @/lib/matches */
export type VideoStatus = MatchStatus;
/** @deprecated Prefer MatchSummary from @/lib/matches */
export type VideoCardData = MatchSummary;

export function VideoCard({ v }: { v: MatchSummary }) {
  const ui = MATCH_STATUS_UI[v.status];
  const href = v.href || (v.status === "ready" ? "/video-analysis" : "#");
  return (
    <Link
      href={href}
      className="group flex flex-col overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-edge)] transition-colors hover:border-[var(--border-strong)]"
    >
      <CourtThumb className="aspect-video">
        <div className="absolute left-2.5 top-2.5 flex gap-1.5">
          <Badge tone={ui.tone as BadgeTone} live={ui.live} pill>
            {ui.label}
          </Badge>
        </div>
        <div className="absolute bottom-2.5 right-2.5 rounded-md border border-[var(--border)] bg-[rgba(10,16,32,0.72)] px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-[var(--text-secondary)] backdrop-blur-sm">
          {v.duration}
        </div>
        {v.status === "analyzing" && v.progress != null ? (
          <div className="absolute inset-x-0 bottom-0 p-2.5">
            <ProgressBar value={v.progress} size="sm" tone="brand" />
          </div>
        ) : null}
      </CourtThumb>
      <div className="flex flex-1 flex-col gap-1.5 p-3.5">
        <div className="font-display text-[14.5px] font-semibold tracking-[-0.01em] text-[var(--text-strong)] group-hover:text-white">
          {v.title}
        </div>
        <div className="text-[13px] text-[var(--text-secondary)]">{v.players}</div>
        <div className="mt-auto flex items-center gap-2 pt-2">
          {v.event ? (
            <span className="truncate font-mono text-[11px] text-[var(--text-muted)]">
              {v.event}
            </span>
          ) : null}
          <span className="flex-1" />
          {v.date ? (
            <span className="shrink-0 font-mono text-[11px] text-[var(--text-faint)]">
              {v.date}
            </span>
          ) : null}
        </div>
        {v.tags?.length ? (
          <div className="flex flex-wrap gap-1 pt-1">
            {v.tags.map((t) => (
              <span
                key={t}
                className={cn(
                  "rounded border border-[var(--border-subtle)] bg-[var(--surface-2)] px-1.5 py-px font-mono text-[10px] text-[var(--text-muted)]",
                )}
              >
                {t}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </Link>
  );
}
