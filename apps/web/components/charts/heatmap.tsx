"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

function cellColors(value: number | string | null | undefined, scale: string) {
  if (value == null || value === "" || Number.isNaN(Number(value))) {
    return {
      bg: "var(--surface-2, #141e38)",
      bd: "var(--border-subtle, #182039)",
      fg: "var(--text-faint, #45506b)",
    };
  }
  const v = Number(value);
  if (scale === "diverging") {
    const m = Math.min(1, Math.abs(v));
    const rgb = v >= 0 ? "61,206,184" : "244,81,92";
    return {
      bg: `rgba(${rgb},${(0.07 + 0.4 * m).toFixed(3)})`,
      bd: `rgba(${rgb},${(0.18 + 0.3 * m).toFixed(3)})`,
      fg: "var(--text-strong, #f1f5fc)",
    };
  }
  const t = Math.max(0, Math.min(1, v));
  const rgb = scale === "exposed" ? "244,81,92" : "54,147,255";
  const a =
    scale === "exposed" ? [0.06, 0.5, 0.15, 0.35] : [0.07, 0.55, 0.16, 0.4];
  return {
    bg: `rgba(${rgb},${(a[0] + a[1] * t).toFixed(3)})`,
    bd: `rgba(${rgb},${(a[2] + a[3] * t).toFixed(3)})`,
    fg: "var(--text-strong, #f1f5fc)",
  };
}

export interface HeatmapCell {
  value?: number | null;
  big?: React.ReactNode;
  small?: React.ReactNode;
  title?: string;
  onClick?: () => void;
}

export interface HeatmapProps extends React.HTMLAttributes<HTMLDivElement> {
  cells?: HeatmapCell[];
  columns?: number;
  cellHeight?: number;
  rowLabels?: string[];
  scale?: "diverging" | "exposed" | "default" | string;
  gap?: number;
}

export function Heatmap({
  cells = [],
  columns = 3,
  cellHeight = 56,
  rowLabels = [],
  scale = "diverging",
  gap = 4,
  className = "",
  ...rest
}: HeatmapProps) {
  const cols = Number(columns) || 3;
  const ch = Number(cellHeight) || 56;
  const g = Number(gap) || 4;
  return (
    <div className={cn("mx-heatmap", className)} {...rest}>
      <div
        className="mx-heatmap__grid"
        style={{
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridAutoRows: ch,
          gap: g,
        }}
      >
        {cells.map((cell, i) => {
          const k = cellColors(cell.value, scale);
          const content = (
            <>
              <span className="mx-heatmap__big" style={{ color: k.fg }}>
                {cell.big}
              </span>
              {cell.small != null && cell.small !== "" ? (
                <span className="mx-heatmap__small">{cell.small}</span>
              ) : null}
            </>
          );
          if (cell.onClick) {
            return (
              <button
                key={i}
                type="button"
                className="mx-heatmap__cell"
                data-clickable=""
                title={cell.title}
                onClick={cell.onClick}
                style={{ background: k.bg, borderColor: k.bd }}
              >
                {content}
              </button>
            );
          }
          return (
            <div
              key={i}
              className="mx-heatmap__cell"
              title={cell.title}
              style={{ background: k.bg, borderColor: k.bd }}
            >
              {content}
            </div>
          );
        })}
      </div>
      {rowLabels?.length ? (
        <div className="mx-heatmap__labels" style={{ gap: g }}>
          {rowLabels.map((l, i) => (
            <span key={i} style={{ height: ch }}>
              {l}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
