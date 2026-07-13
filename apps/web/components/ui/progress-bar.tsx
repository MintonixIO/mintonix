import * as React from "react";
import { cn } from "@/lib/utils";

export interface ProgressBarProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  max?: number;
  label?: string;
  showValue?: boolean;
  valueLabel?: string;
  tone?: "brand" | "success" | "warning" | "danger" | "neutral";
  size?: "sm" | "md" | "lg";
  compare?: { a: number; b: number };
}

export function ProgressBar({
  value = 0,
  max = 100,
  label,
  showValue = false,
  valueLabel,
  tone = "brand",
  size = "md",
  compare,
  className = "",
  ...rest
}: ProgressBarProps) {
  if (compare) {
    const total = (compare.a || 0) + (compare.b || 0) || 1;
    const ap = (compare.a / total) * 100;
    return (
      <div
        className={cn("mx-progress", `mx-progress--${size}`, className)}
        {...rest}
      >
        {label ? (
          <div className="mx-progress__head">
            <span className="mx-progress__label">{label}</span>
          </div>
        ) : null}
        <div className="mx-progress__track mx-progress__track--split">
          <span className="mx-progress__seg mx-progress__seg--a" style={{ width: `${ap}%` }} />
          <span
            className="mx-progress__seg mx-progress__seg--b"
            style={{ width: `${100 - ap}%` }}
          />
        </div>
      </div>
    );
  }
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      className={cn(
        "mx-progress",
        `mx-progress--${tone}`,
        `mx-progress--${size}`,
        className,
      )}
      {...rest}
    >
      {label || showValue ? (
        <div className="mx-progress__head">
          {label ? <span className="mx-progress__label">{label}</span> : <span />}
          {showValue ? (
            <span className="mx-progress__val">
              {valueLabel ?? `${Math.round(pct)}%`}
            </span>
          ) : null}
        </div>
      ) : null}
      <div
        className="mx-progress__track"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemax={max}
      >
        <span className="mx-progress__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
