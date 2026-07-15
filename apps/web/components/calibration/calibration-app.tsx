"use client";

import Link from "next/link";
import { Check, Film, X } from "lucide-react";
import { CalibrationCanvas } from "@/components/calibration/calibration-canvas";
import {
  CalibrationFooter,
  CalibrationTransport,
} from "@/components/calibration/calibration-transport";
import { PlayersPanel } from "@/components/calibration/players-panel";
import { PointsPanel } from "@/components/calibration/points-panel";
import { ReviewPanel } from "@/components/calibration/review-panel";
import { useCalibrationState } from "@/components/calibration/use-calibration-state";
import { PA, STEPS } from "@/lib/calibration/constants";
import { cn } from "@/lib/utils";

export function CalibrationApp() {
  const s = useCalibrationState();

  return (
    <div className="flex h-screen min-h-[640px] flex-col overflow-hidden bg-[var(--bg-base)] text-[var(--text-primary)]">
      <style jsx global>{`
        @keyframes mxPing {
          0% {
            opacity: 0.55;
            transform: translate(-50%, -50%) scale(0.55);
          }
          100% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(1.9);
          }
        }
        @keyframes mxSpin {
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes mxScanY {
          0% {
            top: 2%;
          }
          100% {
            top: 98%;
          }
        }
        @keyframes mxRise {
          from {
            opacity: 0;
            transform: translateY(7px);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .motion-safe\\:animate-\\[mxPing_1\\.5s_ease-out_infinite\\],
          [style*="mxPing"],
          [style*="mxSpin"],
          [style*="mxScanY"],
          [style*="mxRise"] {
            animation: none !important;
          }
        }
      `}</style>

      {/* Top bar */}
      <header className="flex h-[58px] shrink-0 items-center gap-3.5 border-b border-[var(--border)] bg-[var(--surface-1)] px-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/assets/logomark.png"
          alt="Mintonix"
          className="block h-[21px] w-auto"
        />
        <span className="h-[22px] w-px bg-[var(--border)]" aria-hidden />
        <div className="flex min-w-0 flex-col gap-px max-[560px]:hidden">
          <span className="font-display text-sm font-semibold tracking-[-0.01em] text-[var(--text-strong)]">
            Calibrate match
          </span>
          <span className="inline-flex max-w-[240px] items-center gap-1.5 truncate font-mono text-[11px] text-[var(--text-muted)]">
            <Film className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{s.filename}</span>
          </span>
        </div>
        <div className="flex-1" />
        <span className="font-mono text-[11px] tracking-wide text-[var(--text-muted)]">
          STEP {s.stepIdx + 1} / {STEPS.length}
        </span>
        <Link
          href="/dashboard"
          aria-label="Close"
          className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]"
        >
          <X className="h-[17px] w-[17px]" />
        </Link>
      </header>

      <div className="mxRow flex min-h-0 flex-1 max-[880px]:flex-col">
        {/* Canvas */}
        <section className="flex min-w-0 flex-1 flex-col bg-[var(--bg-sunken)]">
          <CalibrationCanvas
            canvasRef={s.canvasRef}
            videoRef={s.videoRef}
            loupeVidRef={s.loupeVidRef}
            step={s.step}
            selectedLm={s.selectedLm}
            marks={s.marks}
            players={s.players}
            linesDetected={s.linesDetected}
            draggingId={s.draggingId}
            vidReady={s.vidReady}
            vidErr={s.vidErr}
            cursor={s.cursor}
            loupe={s.loupe}
            Q={s.Q}
            activeCorners={s.activeCorners}
            gridPaths={s.gridPaths}
            showFit={s.showFit}
            hintText={s.hintText}
            onCanvasPointerMove={s.onCanvasPointerMove}
            onCanvasClick={s.onCanvasClick}
            setCursor={s.setCursor}
            setVidReady={s.setVidReady}
            setVidErr={s.setVidErr}
            onMarkerPointerDown={s.onMarkerPointerDown}
            onMarkerPointerMove={s.onMarkerPointerMove}
            onMarkerPointerUp={s.onMarkerPointerUp}
          />

          <CalibrationTransport
            trackRef={s.trackRef}
            frame={s.frame}
            setFrame={s.setFrame}
            calibFrame={s.calibFrame}
            isCal={s.isCal}
            scrubAt={s.scrubAt}
            onScrubDown={s.onScrubDown}
            useThisFrame={s.useThisFrame}
            resetStep={s.resetStep}
          />
        </section>

        {/* Wizard panel */}
        <aside className="mxPanel flex w-[394px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface-1)] max-[880px]:w-full max-[880px]:border-l-0 max-[880px]:border-t max-[880px]:min-h-0 max-[880px]:flex-1">
          {/* Stepper */}
          <div className="shrink-0 border-b border-[var(--border-subtle)] px-5 pb-4 pt-[18px]">
            <div className="flex items-start gap-0.5">
              {STEPS.map((step, i) => {
                const done = i < s.stepIdx;
                const active = i === s.stepIdx;
                const reachable = i <= s.maxStep;
                return (
                  <div
                    key={step.key}
                    className="flex flex-1 flex-col items-center gap-1.5"
                  >
                    <div className="flex w-full items-center">
                      <div
                        className="h-[1.5px] flex-1"
                        style={{
                          background:
                            i === 0
                              ? "transparent"
                              : i <= s.stepIdx
                                ? PA
                                : "var(--border)",
                        }}
                      />
                      <button
                        type="button"
                        disabled={!reachable}
                        onClick={() => s.goTo(step.key)}
                        aria-current={active ? "step" : undefined}
                        aria-label={`Step ${i + 1}: ${step.label}`}
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-[1.5px] font-mono text-[11.5px] font-semibold",
                          active &&
                            "border-[var(--brand)] bg-[var(--brand)] text-white",
                          done &&
                            !active &&
                            "border-[var(--brand)] bg-[rgba(54,147,255,0.16)] text-[var(--brand)]",
                          !active &&
                            !done &&
                            "border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--text-muted)]",
                          reachable ? "cursor-pointer" : "cursor-default",
                        )}
                      >
                        {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                      </button>
                      <div
                        className="h-[1.5px] flex-1"
                        style={{
                          background:
                            i === STEPS.length - 1
                              ? "transparent"
                              : i < s.stepIdx
                                ? PA
                                : "var(--border)",
                        }}
                      />
                    </div>
                    <span
                      className={cn(
                        "whitespace-nowrap text-[10.5px]",
                        active
                          ? "font-semibold text-[var(--text-strong)]"
                          : "text-[var(--text-muted)]",
                      )}
                    >
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Title */}
          <div className="shrink-0 px-5 pb-1 pt-[18px]">
            <h2 className="font-display text-[19px] font-semibold tracking-[-0.015em] text-[var(--text-strong)]">
              {s.titleMap[s.step][0]}
            </h2>
            <p className="mt-1.5 text-[13.5px] leading-[1.5] text-[var(--text-secondary)]">
              {s.titleMap[s.step][1]}
            </p>
          </div>

          {/* Body */}
          <div className="mxsc min-h-0 flex-1 overflow-y-auto px-5 py-4 pb-[22px]">
            {s.step === "points" && (
              <PointsPanel
                marks={s.marks}
                selectedLm={s.selectedLm}
                setSelectedLm={s.setSelectedLm}
                pointsPhase={s.pointsPhase}
                armedLm={s.armedLm}
                Q={s.Q}
                linesDetected={s.linesDetected}
                detectLines={s.detectLines}
                placedIds={s.placedIds}
                removeMark={s.removeMark}
              />
            )}

            {s.step === "players" && (
              <PlayersPanel
                players={s.players}
                setPlayers={s.setPlayers}
                identify={s.identify}
                setIdentify={s.setIdentify}
                results={s.results}
              />
            )}

            {s.step === "review" && (
              <ReviewPanel
                reviewVidRef={s.reviewVidRef}
                marks={s.marks}
                Q={s.Q}
                activeCorners={s.activeCorners}
                identify={s.identify}
                calibFrame={s.calibFrame}
              />
            )}
          </div>

          <CalibrationFooter
            step={s.step}
            stepIdx={s.stepIdx}
            stepComplete={s.stepComplete}
            starting={s.starting}
            onBack={s.onBack}
            onPrimary={s.onPrimary}
          />
        </aside>
      </div>
    </div>
  );
}
