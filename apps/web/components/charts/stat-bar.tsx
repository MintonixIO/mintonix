"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const BAR_H = { xs: 3, sm: 6, md: 24 } as const;

const SEG_COLORS: Record<string, string> = {
  success: "var(--success-500, #2dd4a7)",
  "success-soft": "rgba(45,212,167,0.6)",
  "success-faint": "rgba(45,212,167,0.3)",
  danger: "var(--danger-500, #f4515c)",
  "danger-soft": "rgba(244,81,92,0.6)",
  "danger-faint": "rgba(244,81,92,0.3)",
  accent: "var(--accent, #3693ff)",
};

const FILL_COLORS: Record<string, string> = {
  accent: "var(--accent, #3693ff)",
  success: "var(--success-500, #2dd4a7)",
  danger: "var(--danger-500, #f4515c)",
  warning: "var(--warning-500, #fbbf24)",
  neutral: "var(--ink-300, #647391)",
};

const clamp = (x: number) => Math.max(0, Math.min(100, Number(x) || 0));

export interface StatBarSegment {
  pct: number;
  tone?: string;
  title?: string;
}

export interface StatBarProps extends React.HTMLAttributes<HTMLElement> {
  label?: string;
  labelWidth?: string;
  pct?: number;
  baseline?: number | null;
  tone?: string;
  value?: string | number;
  n?: string | number;
  size?: keyof typeof BAR_H;
  segments?: StatBarSegment[] | null;
  onClick?: () => void;
}

export function StatBar({
  label,
  labelWidth = "88px",
  pct = 0,
  baseline = null,
  tone = "accent",
  value,
  n,
  size = "sm",
  segments = null,
  onClick,
  className = "",
  ...rest
}: StatBarProps) {
  const cls = cn("mx-statbar", className);

  if (segments && segments.length) {
    const h = BAR_H[size] >= 10 ? BAR_H[size] : 24;
    return (
      <div className={cls} {...(rest as React.HTMLAttributes<HTMLDivElement>)}>
        <span className="mx-statbar__stack" style={{ height: h }}>
          {segments.map((s, i) => (
            <span
              key={i}
              className="mx-statbar__seg"
              title={s.title}
              style={{
                width: `${clamp(s.pct)}%`,
                background: SEG_COLORS[s.tone || "accent"] || SEG_COLORS.accent,
              }}
            />
          ))}
        </span>
      </div>
    );
  }

  const h = BAR_H[size] ?? 6;
  const p = clamp(pct);
  const b =
    baseline == null || baseline === ("" as unknown as number)
      ? null
      : clamp(baseline);
  let t = tone;
  if (t === "auto") {
    const d = p - (b == null ? p : b);
    t = d > 2 ? "success" : d < -2 ? "danger" : "accent";
  }
  const trackH = b == null ? h : Math.max(12, h);
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cls}
      {...(rest as React.HTMLAttributes<HTMLElement>)}
    >
      {label != null && label !== "" ? (
        <span className="mx-statbar__label" style={{ width: labelWidth }}>
          {label}
        </span>
      ) : null}
      <span className="mx-statbar__track" style={{ height: trackH }}>
        <span className="mx-statbar__rail" style={{ height: h }} />
        <span
          className="mx-statbar__fill"
          style={{
            height: h,
            width: `${p}%`,
            background: FILL_COLORS[t] || FILL_COLORS.accent,
          }}
        />
        {b != null ? (
          <span
            className="mx-statbar__tick"
            title="baseline"
            style={{ left: `${b}%` }}
          />
        ) : null}
      </span>
      {value != null && value !== "" ? (
        <span className="mx-statbar__value">{value}</span>
      ) : null}
      {n != null && n !== "" ? <span className="mx-statbar__n">{n}</span> : null}
    </Tag>
  );
}
