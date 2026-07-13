import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { cn } from "@/lib/utils";

export type VideoStatus = "analyzing" | "ready" | "queued" | "failed";

export interface VideoCardData {
  id: string;
  title: string;
  players: string;
  event?: string;
  duration: string;
  status: VideoStatus;
  progress?: number;
  href?: string;
  date?: string;
  tags?: string[];
}

const statusTone: Record<VideoStatus, "brand" | "success" | "warning" | "danger" | "cyan"> = {
  analyzing: "cyan",
  ready: "success",
  queued: "warning",
  failed: "danger",
};

const statusLabel: Record<VideoStatus, string> = {
  analyzing: "Analyzing",
  ready: "Ready",
  queued: "Queued",
  failed: "Failed",
};

export function VideoCard({ v }: { v: VideoCardData }) {
  const href = v.href || (v.status === "ready" ? "/video-analysis" : "#");
  return (
    <Link
      href={href}
      className="group flex flex-col overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-edge)] transition-colors hover:border-[var(--border-strong)]"
    >
      <div className="relative aspect-video overflow-hidden bg-[linear-gradient(160deg,#0f1b34_0%,#070b16_100%)]">
        <div
          className="absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              "linear-gradient(90deg, transparent 28%, rgba(54,147,255,0.16) 28%, rgba(54,147,255,0.16) calc(28% + 1px), transparent calc(28% + 1px)), linear-gradient(90deg, transparent 72%, rgba(54,147,255,0.16) 72%, rgba(54,147,255,0.16) calc(72% + 1px), transparent calc(72% + 1px)), linear-gradient(180deg, transparent calc(50% - 1px), rgba(154,168,194,0.28) 50%, transparent calc(50% + 1px))",
          }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_42%,rgba(54,147,255,0.14),transparent_70%)]" />
        <div className="absolute left-2.5 top-2.5 flex gap-1.5">
          <Badge tone={statusTone[v.status]} live={v.status === "analyzing"} pill>
            {statusLabel[v.status]}
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
      </div>
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
