import * as React from "react";

const clamp = (v: number) => Math.max(0, Math.min(100, Number(v) || 0));

export interface CourtDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  x?: number;
  y?: number;
  size?: number;
}

/** Glowing shuttle-landing dot for court thumbnails. */
export function CourtDot({
  x = 50,
  y = 50,
  size = 8,
  style,
  ...rest
}: CourtDotProps) {
  const s = Number(size) || 8;
  return (
    <span
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        display: "block",
        ...style,
      }}
      {...rest}
    >
      <span
        style={{
          position: "absolute",
          left: `${clamp(x)}%`,
          top: `${clamp(y)}%`,
          width: s,
          height: s,
          borderRadius: 999,
          background: "var(--accent, #3693ff)",
          boxShadow: `0 0 ${Math.round(s * 1.4)}px rgba(54,147,255,0.9)`,
          transform: "translate(-50%, -50%)",
          display: "block",
        }}
      />
    </span>
  );
}
