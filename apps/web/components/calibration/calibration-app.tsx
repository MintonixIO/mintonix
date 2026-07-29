"use client";

import Link from "next/link";
import { Check, Film, X } from "lucide-react";
import { CalibrationCanvas } from "@/components/calibration/calibration-canvas";
import {
  CalibrationFooterConnected,
  CalibrationTransport,
} from "@/components/calibration/calibration-transport";
import {
  CalibrationProvider,
  TITLE_MAP,
  useCalibrationStep,
} from "@/components/calibration/calibration-context";
import { PlayersPanel } from "@/components/calibration/players-panel";
import { PointsPanel } from "@/components/calibration/points-panel";
import { ReviewPanel } from "@/components/calibration/review-panel";
import { PA, STEPS } from "@/lib/calibration/constants";
import { cn } from "@/lib/utils";

function CalibrationShell() {
  const { step, maxStep, stepIdx, filename, goTo } = useCalibrationStep();

  return (
    <div className="flex h-screen min-h-[640px] flex-col overflow-hidden bg-[var(--bg-base)] text-[var(--text-primary)]">
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
            <span className="truncate">{filename}</span>
          </span>
        </div>
        <div className="flex-1" />
        <span className="font-mono text-[11px] tracking-wide text-[var(--text-muted)]">
          STEP {stepIdx + 1} / {STEPS.length}
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
          <CalibrationCanvas />
          <CalibrationTransport />
        </section>

        {/* Wizard panel */}
        <aside className="mxPanel flex w-[394px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface-1)] max-[880px]:w-full max-[880px]:border-l-0 max-[880px]:border-t max-[880px]:min-h-0 max-[880px]:flex-1">
          {/* Stepper */}
          <div className="shrink-0 border-b border-[var(--border-subtle)] px-5 pb-4 pt-[18px]">
            <div className="flex items-start gap-0.5">
              {STEPS.map((s, i) => {
                const done = i < stepIdx;
                const active = i === stepIdx;
                const reachable = i <= maxStep;
                return (
                  <div
                    key={s.key}
                    className="flex flex-1 flex-col items-center gap-1.5"
                  >
                    <div className="flex w-full items-center">
                      <div
                        className="h-[1.5px] flex-1"
                        style={{
                          background:
                            i === 0
                              ? "transparent"
                              : i <= stepIdx
                                ? PA
                                : "var(--border)",
                        }}
                      />
                      <button
                        type="button"
                        disabled={!reachable}
                        onClick={() => goTo(s.key)}
                        aria-current={active ? "step" : undefined}
                        aria-label={`Step ${i + 1}: ${s.label}`}
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
                              : i < stepIdx
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
                      {s.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Title */}
          <div className="shrink-0 px-5 pb-1 pt-[18px]">
            <h2 className="font-display text-[19px] font-semibold tracking-[-0.015em] text-[var(--text-strong)]">
              {TITLE_MAP[step][0]}
            </h2>
            <p className="mt-1.5 text-[13.5px] leading-[1.5] text-[var(--text-secondary)]">
              {TITLE_MAP[step][1]}
            </p>
          </div>

          {/* Body */}
          <div className="mxsc min-h-0 flex-1 overflow-y-auto px-5 py-4 pb-[22px]">
            {step === "points" && <PointsPanel />}
            {step === "players" && <PlayersPanel />}
            {step === "review" && <ReviewPanel />}
          </div>

          <CalibrationFooterConnected />
        </aside>
      </div>
    </div>
  );
}

export function CalibrationApp() {
  return (
    <CalibrationProvider>
      <CalibrationShell />
    </CalibrationProvider>
  );
}
