"use client";

import Link from "next/link";
import {
  Check,
  ChevronRight,
  Film,
  Play,
  Share2,
  SlidersHorizontal,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { AppTopbar } from "@/components/app/app-topbar";
import { VideoCard } from "@/components/app/video-card";
import { CourtThumb } from "@/components/media/court-thumb";
import { Button } from "@/components/ui/button";
import { REELS } from "@/lib/highlights/reels";
import {
  pipelineVideos,
  recentVideos,
  type MatchSummary,
} from "@/lib/matches";
import { cn } from "@/lib/utils";

const DASHBOARD_REELS = REELS.filter((r) => r.status !== "rendering").slice(0, 3);

export function DashboardHome() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [extra, setExtra] = useState<MatchSummary[]>([]);

  const pickFiles = () => inputRef.current?.click();

  const addFiles = useCallback((fileList: FileList | null) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const created: MatchSummary[] = files.map((f, i) => ({
      id: `up-${Date.now()}-${i}`,
      title: f.name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ") || "New upload",
      players: "New upload",
      event: "Just now",
      duration: "—",
      status: "analyzing" as const,
      progress: 8,
      date: "Now",
      tags: ["upload"],
    }));
    setExtra((prev) => [...created, ...prev]);
  }, []);

  const pipeline = [...extra, ...pipelineVideos];
  const recent = recentVideos;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <AppTopbar
        title="Dashboard"
        subtitle="Velocity Badminton Club workspace"
      />
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-[22px] p-7">
        <div>
          <h1 className="font-display text-[26px] font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
            Welcome back, Viktor
          </h1>
          <p className="mt-1.5 text-[14.5px] text-[var(--text-secondary)]">
            Upload footage to analyze a new match, or pick up where you left off.
          </p>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />

        <div
          role="button"
          tabIndex={0}
          onClick={pickFiles}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") pickFiles();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (!dragging) setDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}
          className={cn(
            "relative cursor-pointer overflow-hidden rounded-[15px] border-[1.5px] border-dashed border-[var(--border-strong)] bg-[var(--surface-1)] px-7 py-[34px] transition-colors hover:border-[var(--accent)] hover:bg-[var(--surface-2)]",
            dragging && "border-[var(--accent)]",
          )}
        >
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(70% 130% at 50% 0%, rgba(255,255,255,0.04), transparent 60%)",
            }}
          />
          {dragging ? (
            <div className="pointer-events-none absolute inset-0 rounded-[15px] bg-[var(--accent-soft)] shadow-[inset_0_0_0_2px_var(--accent)]" />
          ) : null}
          <div className="relative flex flex-wrap items-center gap-[22px]">
            <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px] border border-[var(--border)] bg-[var(--accent-soft)] text-[var(--accent)]">
              <UploadCloud className="h-[26px] w-[26px]" strokeWidth={1.6} />
            </span>
            <div className="min-w-[200px] flex-1">
              <div className="font-display text-[17px] font-semibold text-[var(--text-strong)]">
                Drop match footage to analyze
              </div>
              <div className="mt-1 text-[13.5px] text-[var(--text-secondary)]">
                Drag a video here, or click to browse.{" "}
                <span className="font-mono text-xs text-[var(--text-muted)]">
                  MP4, MOV, MKV · up to 8 GB · 1080p / 4K
                </span>
              </div>
            </div>
            <Button
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                pickFiles();
              }}
            >
              Browse files
            </Button>
          </div>
        </div>

        <section className="flex flex-col gap-3.5">
          <div className="flex items-center gap-2.5">
            <h2 className="font-display text-base font-semibold tracking-[-0.01em] text-[var(--text-strong)]">
              In the pipeline
            </h2>
            <span className="font-mono text-xs text-[var(--text-muted)]">
              {pipeline.length} active
            </span>
          </div>
          {pipeline.length ? (
            <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 xl:grid-cols-3">
              {pipeline.map((v) => (
                <VideoCard key={v.id} v={v} />
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-[13px] border border-dashed border-[var(--border)] bg-[var(--surface-1)] p-[22px]">
              <span className="inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] bg-[var(--success-bg)] text-[var(--success-500)]">
                <Check className="h-[18px] w-[18px]" />
              </span>
              <div>
                <div className="text-sm font-medium text-[var(--text-strong)]">
                  All caught up
                </div>
                <div className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
                  Nothing analyzing right now. Drop footage above to start a new
                  match.
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3.5">
          <div className="flex items-center gap-2.5">
            <h2 className="font-display text-base font-semibold tracking-[-0.01em] text-[var(--text-strong)]">
              Jump back in
            </h2>
            <div className="flex-1" />
            <Link
              href="/dashboard/library"
              className="inline-flex items-center gap-1 text-[13px] text-[var(--text-link)] hover:text-[var(--accent)]"
            >
              Open library
              <ChevronRight className="h-[15px] w-[15px]" />
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 xl:grid-cols-3">
            {recent.map((v) => (
              <VideoCard key={v.id} v={v} />
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3.5 pb-8">
          <div className="flex items-center gap-2.5">
            <h2 className="font-display text-base font-semibold tracking-[-0.01em] text-[var(--text-strong)]">
              Recent highlights
            </h2>
            <span className="font-mono text-xs text-[var(--text-muted)]">
              3 reels
            </span>
            <div className="flex-1" />
            <Link
              href="/dashboard/highlights"
              className="inline-flex items-center gap-1 text-[13px] text-[var(--text-link)] hover:text-[var(--accent)]"
            >
              <Sparkles className="h-[15px] w-[15px]" />
              New highlight
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 xl:grid-cols-3">
            {DASHBOARD_REELS.map((h) => (
              <Link
                key={h.id}
                href="/dashboard/highlights"
                className="group flex flex-col overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-edge)] transition-colors hover:border-[var(--border-strong)]"
              >
                <CourtThumb className="aspect-video">
                  <div
                    className="absolute inset-0"
                    style={{
                      background: `radial-gradient(80% 60% at 50% 42%, ${h.glow}, transparent 70%)`,
                    }}
                  />
                  <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[rgba(7,11,22,0.7)] px-2 py-1 font-mono text-[10px] tracking-[0.06em] text-[var(--text-secondary)] backdrop-blur-[6px]">
                    <SlidersHorizontal className="h-3 w-3 text-[var(--accent)]" />
                    {h.criteriaLabel}
                  </span>
                  <span className="absolute right-2.5 bottom-2.5 rounded-md border border-[var(--border)] bg-[rgba(7,11,22,0.78)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-strong)] backdrop-blur-sm">
                    {h.clips} clips · {h.dur}
                  </span>
                  <span className="absolute top-1/2 left-1/2 inline-flex h-[46px] w-[46px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[rgba(54,147,255,0.92)] text-white shadow-[var(--glow-blue)]">
                    <Play className="ml-0.5 h-[19px] w-[19px]" />
                  </span>
                </CourtThumb>
                <div className="flex flex-1 flex-col gap-3 px-[15px] pt-3.5 pb-[15px]">
                  <div className="flex items-start gap-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14.5px] font-semibold text-[var(--text-strong)]">
                        {h.title}
                      </div>
                      <div className="mt-0.5 font-mono text-[11.5px] text-[var(--text-muted)]">
                        {h.match}
                      </div>
                    </div>
                    <span
                      aria-label="Share"
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-[var(--text-muted)]"
                    >
                      <Share2 className="h-[15px] w-[15px]" />
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5 border-t border-[var(--border-subtle)] pt-[11px] font-mono text-[11px] text-[var(--text-muted)]">
                    <span className="inline-flex items-center gap-1">
                      <Film className="h-[13px] w-[13px]" />
                      {h.clips} clips
                    </span>
                    <span className="h-[3px] w-[3px] rounded-full bg-[var(--text-faint)]" />
                    <span>{h.dur}</span>
                    <div className="flex-1" />
                    <span
                      className={
                        h.status === "ready"
                          ? "font-medium text-[var(--success-500)]"
                          : "font-medium text-[var(--text-muted)]"
                      }
                    >
                      {h.status === "ready" ? "Ready" : "Draft"}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
