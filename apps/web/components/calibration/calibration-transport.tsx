"use client";

import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Image as ImageIcon,
  RotateCcw,
} from "lucide-react";
import {
  useCalibrationStep,
  useTransport,
} from "@/components/calibration/calibration-context";
import { timecodeOf, type StepKey } from "@/lib/calibration/geometry";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CalibrationTransport() {
  const {
    trackRef,
    frame,
    calibFrame,
    isCal,
    nudgeFrame,
    scrubAt,
    onScrubDown,
    useThisFrame,
    resetStep,
  } = useTransport();

  return (
    <div className="mxStrip flex shrink-0 items-center gap-3.5 border-t border-[var(--border-subtle)] bg-[var(--surface-1)] px-[22px] py-[11px] max-[880px]:flex-wrap max-[880px]:gap-2.5 max-[880px]:px-3.5 max-[880px]:py-2.5">
      <button
        type="button"
        aria-label="Previous frame"
        onClick={() => nudgeFrame(-1)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-strong)]"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="Next frame"
        onClick={() => nudgeFrame(1)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-strong)]"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      <span className="font-mono text-xs tabular-nums tracking-wide text-[var(--text-strong)]">
        {timecodeOf(frame)}{" "}
        <span className="text-[var(--text-faint)]">/ 41:20</span>
      </span>
      <div
        ref={trackRef}
        role="slider"
        aria-label="Scrub calibration frame"
        aria-valuemin={0}
        aria-valuemax={99}
        aria-valuenow={frame}
        tabIndex={0}
        title="Drag to scrub — pick a clean calibration frame"
        onPointerDown={onScrubDown}
        onPointerMove={(e) => {
          if (e.buttons === 1) scrubAt(e.clientX);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") nudgeFrame(-1);
          if (e.key === "ArrowRight") nudgeFrame(1);
        }}
        className="relative flex h-4 flex-1 cursor-pointer touch-none items-center"
      >
        <div className="pointer-events-none relative h-[5px] w-full rounded-full bg-[var(--surface-3)]">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-[var(--brand)] opacity-50"
            style={{ width: `${frame}%` }}
          />
          <div
            className="absolute inset-y-[-3px] w-0.5 -translate-x-1/2 rounded-sm bg-[var(--success-500)]"
            style={{ left: `${calibFrame}%` }}
          />
          <div
            className="absolute top-1/2 h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_3px_rgba(54,147,255,0.25)]"
            style={{ left: `${frame}%` }}
          />
        </div>
      </div>

      <div className="inline-flex items-center gap-2.5 max-[880px]:hidden">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[11px]",
            isCal ? "text-[var(--success-500)]" : "text-[var(--text-muted)]",
          )}
        >
          {isCal ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <ImageIcon className="h-3.5 w-3.5" />
          )}
          CAL {timecodeOf(calibFrame)}
        </span>
        <button
          type="button"
          onClick={useThisFrame}
          disabled={isCal}
          className={cn(
            "inline-flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-[12.5px]",
            isCal
              ? "cursor-default border-[var(--border)] text-[var(--text-faint)]"
              : "border-[var(--brand)] bg-[rgba(54,147,255,0.12)] text-[var(--brand-hover,#5ba8ff)] hover:brightness-110",
          )}
        >
          {isCal ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Crosshair className="h-3.5 w-3.5" />
          )}
          {isCal ? "Calibration frame" : "Use this frame"}
        </button>
      </div>

      <button
        type="button"
        onClick={resetStep}
        className="inline-flex h-[30px] items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 text-[12.5px] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Reset step
      </button>
    </div>
  );
}

export type CalibrationFooterProps = {
  step: StepKey;
  stepIdx: number;
  stepComplete: boolean;
  starting: boolean;
  onBack: () => void;
  onPrimary: () => void;
};

export function CalibrationFooter({
  step,
  stepIdx,
  stepComplete,
  starting,
  onBack,
  onPrimary,
}: CalibrationFooterProps) {
  return (
    <div className="flex shrink-0 items-center gap-2.5 border-t border-[var(--border)] px-[18px] py-3">
      <Button variant="ghost" size="md" disabled={stepIdx === 0} onClick={onBack}>
        Back
      </Button>
      <div className="flex-1" />
      <Button
        variant="primary"
        size="md"
        disabled={step === "review" ? starting : !stepComplete}
        onClick={onPrimary}
      >
        {step === "review"
          ? starting
            ? "Queuing analysis…"
            : "Start analysis"
          : "Continue"}
      </Button>
    </div>
  );
}

/** Convenience footer that reads from context instead of props. */
export function CalibrationFooterConnected() {
  const { step, stepIdx, stepComplete, starting, onBack, onPrimary } =
    useCalibrationStep();
  return (
    <CalibrationFooter
      step={step}
      stepIdx={stepIdx}
      stepComplete={stepComplete}
      starting={starting}
      onBack={onBack}
      onPrimary={onPrimary}
    />
  );
}
