"use client";

import { LANDMARKS, type Marks } from "@/lib/calibration/geometry";
import { PA } from "@/lib/calibration/constants";

export function CourtSchematic({
  marks,
  selectedLm,
  onArm,
}: {
  marks: Marks;
  selectedLm: string | null;
  onArm: (id: string) => void;
}) {
  const X0 = 42,
    X1 = 158,
    Y0 = 22,
    Y1 = 338;
  const sx = (u: number) => X0 + u * (X1 - X0);
  const sy = (v: number) => Y0 + v * (Y1 - Y0);

  return (
    <svg
      viewBox="0 0 200 360"
      className="mx-auto block w-full max-w-[256px]"
      role="img"
      aria-label="Court diagram — pick a reference point"
    >
      <text
        x={100}
        y={12}
        textAnchor="middle"
        fill="var(--text-faint)"
        style={{ fontFamily: "var(--font-mono)", fontSize: 8, letterSpacing: "0.12em" }}
      >
        FAR
      </text>
      <text
        x={100}
        y={354}
        textAnchor="middle"
        fill="var(--text-faint)"
        style={{ fontFamily: "var(--font-mono)", fontSize: 8, letterSpacing: "0.12em" }}
      >
        NEAR
      </text>
      <rect
        x={sx(0)}
        y={sy(0)}
        width={sx(1) - sx(0)}
        height={sy(1) - sy(0)}
        rx={2}
        fill="rgba(34,86,77,0.32)"
        stroke="rgba(228,242,237,0.72)"
        strokeWidth={1.6}
      />
      {[
        [sx(0.08), sy(0), sx(0.08), sy(1), 0.42],
        [sx(0.92), sy(0), sx(0.92), sy(1), 0.42],
        [sx(0), sy(0.07), sx(1), sy(0.07), 0.28],
        [sx(0), sy(0.93), sx(1), sy(0.93), 0.28],
        [sx(0), sy(0.36), sx(1), sy(0.36), 0.5],
        [sx(0), sy(0.64), sx(1), sy(0.64), 0.5],
        [sx(0.5), sy(0), sx(0.5), sy(0.36), 0.42],
        [sx(0.5), sy(0.64), sx(0.5), sy(1), 0.42],
      ].map(([x1, y1, x2, y2, o], i) => (
        <line
          key={i}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={`rgba(228,242,237,${o})`}
          strokeWidth={1.3}
          strokeLinecap="round"
        />
      ))}
      <line
        x1={sx(-0.085)}
        y1={sy(0.5)}
        x2={sx(1.085)}
        y2={sy(0.5)}
        stroke="rgba(228,242,237,0.6)"
        strokeWidth={1.3}
        strokeDasharray="4 3"
        strokeLinecap="round"
      />
      {LANDMARKS.map((lm) => {
        const pos = lm.uv
          ? [sx(lm.uv[0]), sy(lm.uv[1])]
          : [lm.id === "net-l" ? sx(-0.06) : sx(1.06), sy(0.5)];
        const placed = !!marks[lm.id];
        const armed = selectedLm === lm.id;
        const reqOpen = lm.zone === "net" && !placed;
        const ringCol = reqOpen ? "var(--warning-500)" : PA;
        return (
          <g
            key={lm.id}
            onClick={(e) => {
              e.stopPropagation();
              onArm(lm.id);
            }}
            className="cursor-pointer"
            role="button"
            tabIndex={0}
            aria-label={`${lm.label}${placed ? " (placed)" : ""}${armed ? " (selected)" : ""}`}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onArm(lm.id);
              }
            }}
          >
            <circle cx={pos[0]} cy={pos[1]} r={11} fill="transparent" />
            {reqOpen ? (
              <circle
                cx={pos[0]}
                cy={pos[1]}
                r={8.5}
                fill="none"
                stroke="var(--warning-500)"
                strokeWidth={1.2}
                strokeDasharray="2.2 2.4"
                opacity={armed ? 0.5 : 0.85}
              />
            ) : null}
            {armed ? (
              <circle
                cx={pos[0]}
                cy={pos[1]}
                r={5}
                fill="none"
                stroke={ringCol}
                strokeWidth={1.5}
                className="motion-safe:animate-[mxPing_1.5s_ease-out_infinite]"
                style={{ transformOrigin: `${pos[0]}px ${pos[1]}px` }}
              />
            ) : null}
            <circle
              cx={pos[0]}
              cy={pos[1]}
              r={armed ? 5.6 : placed ? 5 : 4.4}
              fill={
                placed
                  ? PA
                  : armed
                    ? reqOpen
                      ? "color-mix(in srgb, var(--player-b) 28%, transparent)"
                      : "rgba(54,147,255,0.28)"
                    : reqOpen
                      ? "color-mix(in srgb, var(--player-b) 16%, transparent)"
                      : "rgba(7,8,9,0.55)"
              }
              stroke={
                placed ? PA : reqOpen ? "var(--warning-500)" : armed ? PA : "rgba(228,242,237,0.55)"
              }
              strokeWidth={1.6}
            />
            {placed ? (
              <path
                d={`M${pos[0] - 2.3} ${pos[1]} l1.7 1.8 l3.1 -3.6`}
                stroke="#fff"
                strokeWidth={1.4}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
            {reqOpen ? (
              <text
                x={pos[0]}
                y={pos[1] - 13}
                textAnchor="middle"
                fill="var(--warning-500)"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 7,
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                }}
              >
                POLE
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
