import {
  Bell,
  Search,
  UploadCloud,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CourtThumb } from "@/components/media/court-thumb";
import { ProgressBar } from "@/components/ui/progress-bar";
import { cn } from "@/lib/utils";

const PIPELINE = [
  {
    title: "Club finals — Court 2",
    players: "Koster vs Nguyen",
    status: "analyzing" as const,
    progress: 62,
    dur: "48:12",
  },
  {
    title: "U19 sparring set",
    players: "Park / Lee vs Chen / Wu",
    status: "queued" as const,
    dur: "36:40",
  },
];

const RECENT = [
  {
    title: "Axelsen vs Momota",
    players: "V. Axelsen vs K. Momota",
    event: "All England · MS SF",
    dur: "1:12:04",
  },
  {
    title: "League night — Court 1",
    players: "Koster vs Alvarez",
    event: "Velocity Club · MS",
    dur: "41:22",
  },
  {
    title: "Training block B",
    players: "Squad · multi-rally",
    event: "Practice · mixed",
    dur: "22:08",
  },
];

function Thumb({
  status,
  progress,
  dur,
}: {
  status?: "analyzing" | "queued" | "ready";
  progress?: number;
  dur: string;
}) {
  return (
    <CourtThumb className="aspect-video">
      {status === "analyzing" ? (
        <div className="absolute left-2 top-2">
          <Badge tone="cyan" live pill>
            Analyzing
          </Badge>
        </div>
      ) : status === "queued" ? (
        <div className="absolute left-2 top-2">
          <Badge tone="warning" pill>
            Queued
          </Badge>
        </div>
      ) : (
        <div className="absolute left-2 top-2">
          <Badge tone="success" pill>
            Ready
          </Badge>
        </div>
      )}
      <div className="absolute bottom-2 right-2 rounded border border-[var(--border)] bg-[rgba(10,16,32,0.72)] px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-[var(--text-secondary)]">
        {dur}
      </div>
      {status === "analyzing" && progress != null ? (
        <div className="absolute inset-x-0 bottom-0 p-2">
          <ProgressBar value={progress} size="sm" />
        </div>
      ) : null}
    </CourtThumb>
  );
}

/** Marketing dashboard preview — mirrors the design's embedded dashboard frame. */
export function DashboardDemo({ className }: { className?: string }) {
  return (
    <div aria-label="Product illustration — not the live product"
      className={cn(
        "flex h-full min-h-[520px] overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-primary)] shadow-[var(--shadow-lg),var(--shadow-edge)]",
        className,
      )}
    >
      {/* Mini sidebar */}
      <aside className="flex w-[200px] shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--surface-1)]">
        <div className="flex h-[52px] items-center gap-2 border-b border-[var(--border-subtle)] px-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logomark.png" alt="" className="h-5 w-auto" />
          <span className="font-display text-[15px] font-semibold text-[var(--text-strong)]">
            Mintonix
          </span>
        </div>
        <div className="flex-1 space-y-0.5 p-2">
          <div className="px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--text-faint)]">
            Workspace
          </div>
          {[
            { l: "Dashboard", on: true },
            { l: "Library" },
            { l: "Analysis" },
            { l: "Highlights" },
          ].map((i) => (
            <div
              key={i.l}
              className={cn(
                "rounded-md px-2.5 py-2 text-[12.5px]",
                i.on
                  ? "border border-[var(--border)] bg-[var(--accent-soft)] font-medium text-[var(--text-strong)]"
                  : "text-[var(--text-secondary)]",
              )}
            >
              {i.l}
            </div>
          ))}
        </div>
        <div className="border-t border-[var(--border-subtle)] p-3">
          <div className="mb-1.5 flex justify-between font-mono text-[9px] uppercase tracking-wide text-[var(--text-faint)]">
            <span>Usage</span>
            <span>428 / 600</span>
          </div>
          <ProgressBar value={71} size="sm" />
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] bg-[rgba(10,16,32,0.78)] px-4 backdrop-blur">
          <div>
            <div className="font-display text-[14px] font-semibold text-[var(--text-strong)]">
              Dashboard
            </div>
            <div className="font-mono text-[10px] text-[var(--text-muted)]">
              Velocity Badminton Club
            </div>
          </div>
          <div className="flex-1" />
          <div className="flex h-8 w-[200px] items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[12px] text-[var(--text-faint)]">
            <Search className="h-3.5 w-3.5" />
            Search matches…
          </div>
          <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)]">
            <Bell className="h-4 w-4" />
            <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
          </span>
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border-strong)] bg-[linear-gradient(150deg,#1c2a4a,#0e162d)] font-display text-[11px] font-semibold text-[var(--text-strong)]">
            VK
          </span>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-hidden p-4">
          <div>
            <div className="font-display text-[18px] font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
              Welcome back, Viktor
            </div>
            <div className="mt-0.5 text-[12.5px] text-[var(--text-secondary)]">
              Upload footage to analyze a new match, or pick up where you left off.
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-[12px] border border-dashed border-[var(--border-strong)] bg-[var(--surface-1)] px-4 py-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] border border-[var(--border)] bg-[var(--accent-soft)] text-[var(--accent)]">
              <UploadCloud className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-[var(--text-strong)]">
                Drop match footage to analyze
              </div>
              <div className="font-mono text-[10px] text-[var(--text-muted)]">
                MP4, MOV, MKV · up to 8 GB
              </div>
            </div>
            <span className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[12px] text-[var(--text-secondary)]">
              Browse files
            </span>
          </div>

          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="font-display text-[13px] font-semibold text-[var(--text-strong)]">
                In the pipeline
              </span>
              <span className="font-mono text-[11px] text-[var(--text-muted)]">
                2 active
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {PIPELINE.map((v) => (
                <div
                  key={v.title}
                  className="overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface-1)]"
                >
                  <Thumb status={v.status} progress={v.progress} dur={v.dur} />
                  <div className="p-2.5">
                    <div className="truncate text-[12.5px] font-semibold text-[var(--text-strong)]">
                      {v.title}
                    </div>
                    <div className="truncate text-[11px] text-[var(--text-secondary)]">
                      {v.players}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 font-display text-[13px] font-semibold text-[var(--text-strong)]">
              Jump back in
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {RECENT.map((v) => (
                <div
                  key={v.title}
                  className="overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface-1)]"
                >
                  <Thumb status="ready" dur={v.dur} />
                  <div className="p-2.5">
                    <div className="truncate text-[12px] font-semibold text-[var(--text-strong)]">
                      {v.title}
                    </div>
                    <div className="truncate font-mono text-[10px] text-[var(--text-muted)]">
                      {v.event}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
