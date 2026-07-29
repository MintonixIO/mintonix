import Link from "next/link";
import { Play } from "lucide-react";
import { VideoCard } from "@/components/app/video-card";
import { CourtThumb } from "@/components/media/court-thumb";
import type { LibraryMatch } from "@/lib/matches";

type LibraryGridProps = {
  rows: LibraryMatch[];
  selected: Record<string, boolean>;
};

export function LibraryGrid({ rows, selected }: LibraryGridProps) {
  return (
    <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((m) => {
        const sel = !!selected[m.id];
        if (m.status !== "ready") {
          return (
            <div key={m.id} className="relative">
              {sel ? (
                <div className="pointer-events-none absolute inset-0 z-[1] rounded-[14px] bg-[rgba(54,147,255,0.08)] shadow-[inset_3px_0_0_var(--accent)]" />
              ) : null}
              <VideoCard
                v={{
                  id: m.id,
                  title: m.title,
                  players: m.opponent,
                  event: m.tournament,
                  duration: m.dur || "—",
                  status: m.status,
                  progress: m.progress,
                  date: m.date,
                }}
              />
            </div>
          );
        }
        return (
          <div
            key={m.id}
            className="relative flex flex-col overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-edge)] transition-colors hover:border-[var(--border-strong)]"
          >
            {sel ? (
              <div className="pointer-events-none absolute inset-0 z-[1] bg-[rgba(54,147,255,0.08)] shadow-[inset_3px_0_0_var(--accent)]" />
            ) : null}
            <Link href="/video-analysis">
              <CourtThumb className="aspect-video">
                <span className="absolute top-1/2 left-1/2 inline-flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[rgba(54,147,255,0.92)] text-white shadow-[var(--glow-blue)]">
                  <Play className="ml-0.5 h-[18px] w-[18px]" />
                </span>
                <span className="absolute right-2.5 bottom-2.5 rounded-md border border-[var(--border)] bg-[rgba(7,11,22,0.78)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-strong)]">
                  {m.dur || "—"}
                </span>
              </CourtThumb>
            </Link>
            <div className="flex flex-col gap-2.5 px-3.5 pt-[13px] pb-3.5">
              <div>
                <div className="truncate text-sm font-semibold text-[var(--text-strong)]">
                  {m.title}
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--text-muted)]">
                  {m.opponent} · {m.date}
                </div>
              </div>
              <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] pt-2.5 font-mono text-[11px] text-[var(--text-muted)]">
                {m.win === true ? (
                  <span className="font-medium text-[var(--success-500)]">
                    W {m.score}
                  </span>
                ) : m.win === false ? (
                  <span>L {m.score}</span>
                ) : (
                  <span>Training</span>
                )}
                <div className="flex-1" />
                <span>{m.shots ? m.shots : "—"} shots</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
