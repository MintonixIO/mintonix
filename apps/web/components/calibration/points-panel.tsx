"use client";

import {
  Check,
  ChevronRight,
  MousePointerClick,
  ScanLine,
  Scissors,
  X,
} from "lucide-react";
import { CourtSchematic } from "@/components/calibration/court-schematic";
import { useMarks } from "@/components/calibration/calibration-context";
import { lmById } from "@/lib/calibration/geometry";
import { cn } from "@/lib/utils";

export function PointsPanel() {
  const {
    marks,
    selectedLm,
    setSelectedLm,
    pointsPhase,
    armedLm,
    Q,
    linesDetected,
    detectLines,
    placedIds,
    removeMark,
  } = useMarks();

  return (
    <div>
      {/* Phase banner */}
      <div className="mb-3.5 flex items-center gap-2">
        {(
          [
            {
              n: 1,
              label: "Court corners",
              count: pointsPhase.corners,
              total: 4,
              active: pointsPhase.phase === "corners",
              done: pointsPhase.corners === 4,
              dim: false,
            },
            {
              n: 2,
              label: "Net pole tops",
              count: pointsPhase.net,
              total: 2,
              active: pointsPhase.phase === "net",
              done: pointsPhase.phase === "done",
              dim: pointsPhase.phase === "corners",
            },
          ] as const
        ).map((ph, idx) => (
          <div key={ph.n} className="contents">
            {idx > 0 ? (
              <ChevronRight className="h-[15px] w-[15px] shrink-0 text-[var(--text-faint)]" />
            ) : null}
            <div
              className={cn(
                "flex flex-1 items-center gap-2 rounded-[11px] border px-2.5 py-2",
                ph.active
                  ? "border-[var(--brand)] bg-[rgba(54,147,255,0.08)]"
                  : "border-[var(--border-subtle)] bg-[var(--surface-2)]",
                ph.dim && "opacity-50",
              )}
            >
              <span
                className={cn(
                  "inline-flex h-[23px] w-[23px] shrink-0 items-center justify-center rounded-[7px] font-mono text-[11px] font-semibold",
                  ph.done &&
                    "bg-[rgba(45,212,167,0.16)] text-[var(--success-500)]",
                  ph.active && !ph.done && "bg-[var(--brand)] text-white",
                  !ph.active &&
                    !ph.done &&
                    "bg-[var(--surface-3)] text-[var(--text-muted)]",
                )}
              >
                {ph.done ? <Check className="h-3 w-3" /> : ph.n}
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    "whitespace-nowrap text-[12.5px] font-medium",
                    ph.active || ph.done
                      ? "text-[var(--text-strong)]"
                      : "text-[var(--text-secondary)]",
                  )}
                >
                  {ph.label}
                </div>
                <div
                  className={cn(
                    "font-mono text-[10px] tracking-wide",
                    ph.done
                      ? "text-[var(--success-500)]"
                      : ph.active
                        ? "text-[var(--brand-hover,#5ba8ff)]"
                        : "text-[var(--text-muted)]",
                  )}
                >
                  {ph.count} / {ph.total}
                  {ph.done ? " done" : ""}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Diagram card */}
      <div className="mb-3.5 rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-sunken)] px-3 pb-[11px] pt-3">
        {armedLm ? (
          <div className="mb-2.5 flex items-center gap-2.5 rounded-[10px] border border-[var(--brand)] bg-[rgba(54,147,255,0.08)] px-3 py-2.5">
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-[var(--brand)] font-mono text-[11px] font-semibold text-white">
              {armedLm.short}
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-[var(--brand)]">
                Next point
              </div>
              <div className="text-[13px] font-medium text-[var(--text-strong)]">
                {armedLm.label}
              </div>
            </div>
            <span className="whitespace-nowrap font-mono text-[10px] text-[var(--text-muted)]">
              Click on frame
            </span>
          </div>
        ) : (
          <div className="mb-2.5 flex items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-[12.5px] text-[var(--text-secondary)]">
            <MousePointerClick className="h-[15px] w-[15px] shrink-0 text-[var(--text-muted)]" />
            Pick another point on the diagram to add it
          </div>
        )}
        <CourtSchematic
          marks={marks}
          selectedLm={selectedLm}
          onArm={(id) => setSelectedLm(id)}
        />
        <div className="mt-1.5 flex items-center justify-center gap-1.5 text-[11.5px] text-[var(--text-muted)]">
          <Scissors className="h-3.5 w-3.5 shrink-0" />
          <span>Point blocked? Skip it — just pick another.</span>
        </div>
      </div>

      {/* Quality meter */}
      <div className="my-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3">
        <div className="mb-2 flex items-baseline gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
            Calibration quality
          </span>
          <div className="flex-1" />
          <span
            className="font-mono text-[13px] font-semibold"
            style={{ color: Q.color }}
          >
            {Q.label}
          </span>
        </div>
        <div className="relative h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-200 ease-out"
            style={{
              width: `${Q.score}%`,
              background: Q.ready
                ? "var(--success-500)"
                : "var(--warning-500)",
            }}
          />
        </div>
        <div className="mt-2 flex items-center gap-3 font-mono text-[11px] text-[var(--text-muted)]">
          <span className="text-[var(--text-secondary)]">
            <span className="font-semibold text-[var(--text-strong)]">
              {Q.n}
            </span>{" "}
            pts
          </span>
          <span
            className={Q.quad >= 4 ? "text-[var(--success-500)]" : undefined}
          >
            {Q.quad}/4 zones
          </span>
          <div className="flex-1" />
          {!Q.netReady ? (
            <span className="text-[var(--warning-500)]">
              net poles required
            </span>
          ) : Q.zonesLeft ? (
            <span className="text-[var(--warning-500)]">
              {Q.zonesLeft} zone{Q.zonesLeft === 1 ? "" : "s"} left
            </span>
          ) : (
            <span className="text-[var(--success-500)]">ready</span>
          )}
        </div>
      </div>

      {/* Auto-detect */}
      {linesDetected !== true ? (
        <button
          type="button"
          onClick={detectLines}
          disabled={linesDetected === "scanning"}
          className="mb-3.5 flex h-10 w-full items-center justify-center gap-2 rounded-[10px] border border-[var(--brand)] bg-[rgba(54,147,255,0.12)] text-[13.5px] font-medium text-[var(--brand-hover,#5ba8ff)] disabled:cursor-default"
        >
          {linesDetected === "scanning" ? (
            <span
              className="inline-block h-3.5 w-3.5 rounded-full border-2 border-[rgba(91,168,255,0.3)] border-t-[#5ba8ff]"
              style={{ animation: "mxSpin 0.7s linear infinite" }}
            />
          ) : (
            <ScanLine className="h-4 w-4" />
          )}
          {linesDetected === "scanning"
            ? "Detecting…"
            : "Auto-detect court lines"}
        </button>
      ) : null}

      {/* Marked list */}
      {placedIds.length ? (
        <div className="flex flex-col gap-1.5">
          <div className="px-0.5 pb-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
            Marked points · {placedIds.length}
          </div>
          {placedIds.map((id) => {
            const lm = lmById(id);
            return (
              <div
                key={id}
                className="flex items-center gap-2.5 rounded-[9px] border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2 py-1.5"
              >
                <span
                  className={cn(
                    "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md font-mono text-[10px] font-semibold text-[var(--brand)]",
                    lm.zone === "net"
                      ? "bg-[rgba(54,147,255,0.16)]"
                      : "bg-[var(--surface-3)]",
                  )}
                >
                  {lm.short}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--text-primary)]">
                  {lm.label}
                </span>
                {lm.zone === "net" ? (
                  <span className="font-mono text-[9.5px] tracking-wide text-[var(--text-faint)]">
                    NET
                  </span>
                ) : null}
                <button
                  type="button"
                  aria-label={`Remove ${lm.label}`}
                  onClick={() => removeMark(id)}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] text-[var(--text-muted)] hover:text-[var(--text-strong)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-[10px] border border-dashed border-[var(--border)] px-3 py-3.5 text-center text-[12.5px] text-[var(--text-muted)]">
          No points yet. Tap the diagram, then click the frame.
        </div>
      )}
    </div>
  );
}
