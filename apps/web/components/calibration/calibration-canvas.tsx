"use client";

import {
  CheckCircle2,
  Crosshair,
  Film,
  ScanSearch,
} from "lucide-react";
import { useCanvas } from "@/components/calibration/calibration-context";
import { PBOX, POLE, lmById } from "@/lib/calibration/geometry";
import { PA, PB } from "@/lib/calibration/constants";
import { cn } from "@/lib/utils";

export function CalibrationCanvas() {
  const {
    canvasRef,
    videoRef,
    loupeVidRef,
    step,
    selectedLm,
    marks,
    players,
    linesDetected,
    draggingId,
    vidReady,
    vidErr,
    cursor,
    loupe,
    Q,
    activeCorners,
    gridPaths,
    showFit,
    hintText,
    onCanvasPointerMove,
    onCanvasClick,
    setCursor,
    setVidReady,
    setVidErr,
    onMarkerPointerDown,
    onMarkerPointerMove,
    onMarkerPointerUp,
  } = useCanvas();

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-[22px] max-[880px]:flex-none max-[880px]:p-[11px]">
      <div
        ref={canvasRef}
        role="application"
        aria-label="Calibration frame — click to place points"
        onPointerMove={onCanvasPointerMove}
        onPointerLeave={() => setCursor(null)}
        onClick={onCanvasClick}
        className="relative aspect-video w-full max-w-[calc((100vh-210px)*1.7778)] touch-none select-none overflow-hidden rounded-[13px] border border-[var(--border-strong)] bg-[#060b0a] shadow-[var(--shadow-lg)]"
        style={{
          cursor:
            step === "points" && selectedLm
              ? "crosshair"
              : step === "players"
                ? "pointer"
                : "default",
        }}
      >
        {/* Video */}
        <div className="absolute inset-0 bg-[#070b0a]">
          {vidErr ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 font-mono text-[12.5px] text-[var(--text-muted)]">
              <Film className="h-5 w-5" />
              Footage preview unavailable
            </div>
          ) : !vidReady ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-[radial-gradient(120%_100%_at_50%_30%,#11201d_0%,#0a120f_55%,#070b0a_100%)] font-mono text-xs text-[var(--text-muted)]">
              <span
                className="inline-block h-4 w-4 rounded-full border-2 border-[rgba(54,147,255,0.3)] border-t-[var(--brand)]"
                style={{ animation: "mxSpin 0.7s linear infinite" }}
              />
              Loading footage…
            </div>
          ) : null}
          <video
            ref={videoRef}
            src="/media/clip.mp4"
            muted
            playsInline
            preload="auto"
            tabIndex={-1}
            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
            onLoadedMetadata={() => setVidReady(true)}
            onLoadedData={() => setVidReady(true)}
            onError={() => setVidErr(true)}
          />
        </div>

        {/* SVG overlays */}
        <div className="pointer-events-none absolute inset-0">
          <svg
            viewBox="0 0 1600 900"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
          >
            {showFit ? (
              <>
                <polygon
                  points={activeCorners.map((p) => p.join(",")).join(" ")}
                  fill="rgba(54,147,255,0.10)"
                  stroke={PA}
                  strokeWidth={2.4}
                  strokeDasharray={
                    step === "points" && Q.n < 6 ? "7 6" : "none"
                  }
                  strokeLinejoin="round"
                />
                <path
                  d={gridPaths}
                  stroke="rgba(54,147,255,0.26)"
                  strokeWidth={1}
                  fill="none"
                />
                {(Q.netReady || step !== "points") && (
                  <line
                    x1={(marks["net-l"] || POLE[0])[0]}
                    y1={(marks["net-l"] || POLE[0])[1]}
                    x2={(marks["net-r"] || POLE[1])[0]}
                    y2={(marks["net-r"] || POLE[1])[1]}
                    stroke={PA}
                    strokeWidth={2.2}
                    strokeDasharray="6 5"
                  />
                )}
              </>
            ) : null}

            {(["a", "b"] as const).map((k) => {
              if (step === "points") return null;
              const color = k === "a" ? PA : PB;
              const b = PBOX[k];
              const cx = b.x + b.w / 2;
              const headR = b.w * 0.3;
              const headCy = b.y + headR * 0.9;
              if (players[k] === "detected") {
                return (
                  <g key={k}>
                    <circle
                      cx={cx}
                      cy={headCy}
                      r={headR}
                      fill={color}
                      fillOpacity={0.3}
                    />
                    <rect
                      x={b.x + b.w * 0.08}
                      y={headCy}
                      width={b.w * 0.84}
                      height={b.h - (headCy - b.y)}
                      rx={b.w * 0.26}
                      fill={color}
                      fillOpacity={0.3}
                    />
                    <rect
                      x={b.x}
                      y={b.y}
                      width={b.w}
                      height={b.h}
                      rx={8}
                      fill="none"
                      stroke={color}
                      strokeWidth={2.4}
                      strokeDasharray="8 6"
                    />
                  </g>
                );
              }
              if (players[k] === "detecting") {
                return (
                  <rect
                    key={k}
                    x={b.x}
                    y={b.y}
                    width={b.w}
                    height={b.h}
                    rx={8}
                    fill="rgba(54,147,255,0.08)"
                    stroke={color}
                    strokeWidth={2}
                    strokeDasharray="4 4"
                  />
                );
              }
              return null;
            })}
          </svg>

          {/* Player labels */}
          {step !== "points" &&
            (["a", "b"] as const).map((k) => {
              const b = PBOX[k];
              const color = k === "a" ? PA : PB;
              if (players[k] === "detected") {
                return (
                  <div
                    key={`lbl${k}`}
                    className="absolute inline-flex items-center gap-1.5 rounded-[7px] px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wide"
                    style={{
                      left: `${(b.x / 1600) * 100}%`,
                      top: `${(b.y / 900) * 100}%`,
                      transform: "translateY(-100%)",
                      marginTop: -3,
                      background: color,
                      color: k === "a" ? "#fff" : "#1a1300",
                      animation: "mxRise 240ms var(--ease-out, ease) both",
                    }}
                  >
                    Player {k.toUpperCase()}
                    <span className="font-normal opacity-75">98%</span>
                  </div>
                );
              }
              if (players[k] === "detecting") {
                return (
                  <div
                    key={`det${k}`}
                    className="absolute inline-flex items-center gap-1.5 rounded-[7px] border px-2 py-1 font-mono text-[11px] text-[var(--text-primary)]"
                    style={{
                      left: `${((b.x + b.w / 2) / 1600) * 100}%`,
                      top: `${(b.y / 900) * 100}%`,
                      transform: "translate(-50%, -130%)",
                      background: "rgba(7,8,9,0.85)",
                      borderColor: color,
                    }}
                  >
                    <span
                      className="inline-block h-[11px] w-[11px] rounded-full border-2 border-white/25"
                      style={{
                        borderTopColor: color,
                        animation: "mxSpin 0.7s linear infinite",
                      }}
                    />
                    Segmenting…
                  </div>
                );
              }
              return null;
            })}

          {/* Placed markers (draggable) */}
          {step === "points" &&
            Object.entries(marks).map(([id, p]) => {
              const lm = lmById(id);
              return (
                <div
                  key={id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${lm.label} marker — drag to adjust`}
                  onPointerDown={(e) => onMarkerPointerDown(id, e)}
                  onPointerMove={(e) => onMarkerPointerMove(id, e)}
                  onPointerUp={() => onMarkerPointerUp(id)}
                  onPointerCancel={() => onMarkerPointerUp(id)}
                  className={cn(
                    "absolute z-[4] h-[34px] w-[34px] touch-none",
                    draggingId === id ? "cursor-grabbing" : "cursor-grab",
                  )}
                  style={{
                    left: `${(p[0] / 1600) * 100}%`,
                    top: `${(p[1] / 900) * 100}%`,
                    transform: "translate(-50%, -50%)",
                  }}
                >
                  <div
                    className="absolute inset-0 rounded-full border-2"
                    style={{
                      borderColor: PA,
                      boxShadow: `0 0 0 1px rgba(7,8,9,0.6), 0 0 12px color-mix(in srgb, ${PA} 40%, transparent)`,
                    }}
                  />
                  <div
                    className="absolute left-1/2 top-1/2 h-3.5 w-px -translate-x-1/2 -translate-y-1/2"
                    style={{ background: PA }}
                  />
                  <div
                    className="absolute left-1/2 top-1/2 h-px w-3.5 -translate-x-1/2 -translate-y-1/2"
                    style={{ background: PA }}
                  />
                  <div
                    className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                    style={{ background: PA }}
                  />
                  <div
                    className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 rounded bg-[rgba(7,8,9,0.82)] px-1.5 py-px font-mono text-[10px] font-semibold leading-relaxed"
                    style={{ color: PA }}
                  >
                    {lm.short}
                  </div>
                </div>
              );
            })}
        </div>

        {/* Scan overlay */}
        {step === "points" && linesDetected === "scanning" ? (
          <div className="pointer-events-none absolute inset-0 overflow-hidden bg-[rgba(54,147,255,0.04)]">
            <div
              className="absolute left-0 right-0 h-0.5"
              style={{
                background: `linear-gradient(90deg, transparent, ${PA}, transparent)`,
                boxShadow: `0 0 18px ${PA}`,
                animation: "mxScanY 0.95s var(--ease-out, ease) forwards",
              }}
            />
            <div
              className="absolute left-1/2 top-3.5 flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11.5px] text-[var(--text-primary)]"
              style={{ borderColor: PA, background: "rgba(7,8,9,0.85)" }}
            >
              <span
                className="inline-block h-[11px] w-[11px] rounded-full border-2 border-white/25"
                style={{
                  borderTopColor: PA,
                  animation: "mxSpin 0.7s linear infinite",
                }}
              />
              Detecting court lines…
            </div>
          </div>
        ) : null}

        {/* Magnifier loupe */}
        {loupe && cursor ? (
          <div
            className="pointer-events-none absolute z-[6] overflow-hidden rounded-full border-2 bg-[#060b0a]"
            style={{
              left: loupe.lx,
              top: loupe.ly,
              width: loupe.S,
              height: loupe.S,
              borderColor: PA,
              boxShadow:
                "0 0 0 1px rgba(7,8,9,0.6), 0 10px 30px rgba(3,7,18,0.6)",
            }}
            aria-hidden
          >
            <video
              ref={loupeVidRef}
              src="/media/clip.mp4"
              muted
              playsInline
              preload="auto"
              tabIndex={-1}
              className="absolute object-fill"
              style={{
                left: loupe.ox,
                top: loupe.oy,
                width: loupe.innerW,
                height: loupe.innerH,
              }}
            />
            <div className="absolute bottom-0 left-1/2 top-0 w-px bg-[rgba(54,147,255,0.6)]" />
            <div className="absolute left-0 right-0 top-1/2 h-px bg-[rgba(54,147,255,0.6)]" />
            <div className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80" />
            <div className="absolute bottom-2 left-2 font-mono text-[9px] tracking-wide text-white/70">
              2.5×
            </div>
          </div>
        ) : null}

        {/* Fit chip */}
        {step === "points" && Q.n >= 4 && linesDetected !== "scanning" ? (
          <div
            className="pointer-events-none absolute right-3.5 top-3.5 z-[5] inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[11px] text-[var(--text-secondary)] backdrop-blur-[8px]"
            style={{
              background: "rgba(7,8,9,0.72)",
              borderColor:
                Q.level === "need"
                  ? "rgba(251,191,36,0.4)"
                  : "rgba(45,212,167,0.4)",
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: Q.color }}
            />
            <span className="font-semibold" style={{ color: Q.color }}>
              FIT
            </span>
            reproj {Q.err}px
          </div>
        ) : null}

        {/* Canvas hint */}
        <div className="pointer-events-none absolute left-3.5 top-3.5 z-[5] inline-flex max-w-[54%] items-center gap-2 rounded-[9px] border border-white/10 bg-[rgba(7,8,9,0.7)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] backdrop-blur-[8px]">
          {step === "players" ? (
            <ScanSearch className="h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />
          ) : step === "review" ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />
          ) : (
            <Crosshair className="h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />
          )}
          {hintText}
        </div>
      </div>
    </div>
  );
}
