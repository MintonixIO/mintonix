"use client";

import {
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { Eye, Move3d, RotateCcw } from "lucide-react";
import { courtToPct } from "@/lib/match-viewer/generate";
import type { Frame, PlayerPov, ViewMode } from "@/lib/match-viewer/types";
import { cn } from "@/lib/utils";

type CourtViewportProps = {
  frame: Frame;
  trail: Array<{ x: number; y: number; z: number }>;
  mode: Exclude<ViewMode, "broadcast">;
  playerPov: PlayerPov;
  az: number;
  el: number;
  zoom: number;
  onOrbit: (az: number, el: number) => void;
  onZoom: (deltaY: number) => void;
  onResetOrbit?: () => void;
  currentShotLabel?: string;
  playerAName: string;
  playerBName: string;
  /** Honest label for synthetic overlay (default Demo). */
  overlayBadge?: string;
};

function PlayerFigure({ color, dark }: { color: string; dark: string }) {
  return (
    <>
      <div
        className="absolute left-1/2 top-1/2 h-[11px] w-[26px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px]"
        style={{
          borderColor: `${color}bf`,
          background: `radial-gradient(closest-side, ${color}4d, transparent)`,
          boxShadow: `0 0 12px ${color}73`,
        }}
      />
      <div
        className="absolute bottom-0 left-1/2 h-[46px] w-6 origin-bottom -translate-x-1/2"
        style={{ transform: "translateX(-50%) rotateX(-90deg)", transformOrigin: "50% 100%" }}
      >
        <div
          className="absolute left-1/2 top-0 h-[13px] w-[13px] -translate-x-1/2 rounded-full"
          style={{ background: color, boxShadow: `0 0 10px ${color}b3` }}
        />
        <div
          className="absolute bottom-0 left-1/2 h-[29px] w-4 -translate-x-1/2 rounded-[8px_8px_5px_5px]"
          style={{
            background: `linear-gradient(${color}, ${dark})`,
            boxShadow: `0 0 14px ${color}80`,
          }}
        />
      </div>
      <div
        className="absolute bottom-0 left-1/2 h-[46px] w-6 origin-bottom -translate-x-1/2"
        style={{
          transform: "translateX(-50%) rotateX(-90deg) rotateY(90deg)",
          transformOrigin: "50% 100%",
        }}
      >
        <div
          className="absolute left-1/2 top-0 h-[13px] w-[13px] -translate-x-1/2 rounded-full"
          style={{ background: dark, boxShadow: `0 0 10px ${color}99` }}
        />
        <div
          className="absolute bottom-0 left-1/2 h-[29px] w-4 -translate-x-1/2 rounded-[8px_8px_5px_5px]"
          style={{
            background: `linear-gradient(${dark}, ${color}99)`,
            boxShadow: `0 0 14px ${color}66`,
          }}
        />
      </div>
    </>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export function CourtViewport({
  frame,
  trail,
  mode,
  playerPov,
  az,
  el,
  zoom,
  onOrbit,
  onZoom,
  onResetOrbit,
  currentShotLabel,
  playerAName,
  playerBName,
  overlayBadge = "Demo",
}: CourtViewportProps) {
  const dragRef = useRef<{ x: number; y: number; az: number; el: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const aPct = courtToPct(frame.a);
  const bPct = courtToPct(frame.b);
  const sPct = courtToPct(frame.shuttle);

  const playerCam = useMemo(() => {
    const self = playerPov === "A" ? frame.a : frame.b;
    const target = frame.shuttle;
    const dx = target.x - self.x;
    const dy = target.y - self.y;
    const dz = target.z - 1.55;
    const azLook = (Math.atan2(dx, -dy) * 180) / Math.PI;
    const dist = Math.max(0.4, Math.hypot(dx, dy));
    const elLook = clamp(10 + ((Math.atan2(dz, dist) * 180) / Math.PI) * 0.45, 5, 26);
    const shiftX = -self.x * 5.5;
    const shiftY = playerPov === "A" ? -self.y * 3.2 + 28 : -self.y * 3.2 - 28;
    return { az: azLook, el: elLook, zoom: 1.42, shiftX, shiftY };
  }, [frame, playerPov]);

  const useAz = mode === "player" ? playerCam.az : az;
  const useEl = mode === "player" ? playerCam.el : el;
  const useZoom = mode === "player" ? playerCam.zoom * (0.92 + zoom * 0.08) : zoom;
  const shiftX = mode === "player" ? playerCam.shiftX : 0;
  const shiftY = mode === "player" ? playerCam.shiftY : 0;

  const canOrbit = mode === "corner";

  const onStageDown = (e: ReactPointerEvent) => {
    if (!canOrbit) return;
    if ((e.target as HTMLElement).closest("button,a")) return;
    dragRef.current = { x: e.clientX, y: e.clientY, az, el };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onStageMove = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d || !canOrbit) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    onOrbit(d.az + dx * 0.42, Math.max(4, Math.min(68, d.el - dy * 0.3)));
  };

  const onStageUp = () => {
    dragRef.current = null;
    setDragging(false);
  };

  const onWheel = (e: ReactWheelEvent) => {
    e.preventDefault();
    onZoom(e.deltaY);
  };

  const rot = `rotateX(${useEl}deg) rotateZ(${useAz}deg)`;
  const hideSelf = mode === "player";
  const perspective = mode === "player" ? 780 : 1180;

  return (
    <div
      onPointerDown={onStageDown}
      onPointerMove={onStageMove}
      onPointerUp={onStageUp}
      onPointerCancel={onStageUp}
      onWheel={onWheel}
      className="relative h-full min-h-0 w-full touch-none overflow-hidden bg-[radial-gradient(120%_90%_at_50%_118%,rgba(80,222,255,0.07),transparent_60%)]"
      style={{
        cursor: canOrbit ? (dragging ? "grabbing" : "grab") : "default",
      }}
      role="img"
      aria-label={
        mode === "corner"
          ? "Corner low-angle 3D view. Drag to orbit, scroll to zoom."
          : `Player POV from ${playerPov === "A" ? playerAName : playerBName}`
      }
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(80,222,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(80,222,255,0.045) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
          maskImage: "radial-gradient(72% 72% at 50% 50%, #000, transparent 82%)",
        }}
      />

      {mode === "player" ? (
        <>
          <div className="pointer-events-none absolute inset-0 z-[5] bg-[radial-gradient(ellipse_at_50%_42%,transparent_38%,rgba(4,8,18,0.62)_100%)]" />
          <div className="pointer-events-none absolute inset-0 z-[5] bg-[linear-gradient(180deg,rgba(54,147,255,0.07),transparent_22%,transparent_70%,rgba(4,8,18,0.4))]" />
        </>
      ) : null}

      <div className="pointer-events-none absolute inset-0" style={{ perspective }}>
        <div
          className={cn(
            "absolute left-1/2 origin-center will-change-transform",
            mode === "player"
              ? "top-[52%] h-[min(440px,60vh)] w-[min(260px,58vw)] sm:h-[460px] sm:w-[270px]"
              : "top-[48%] h-[min(400px,56vh)] w-[min(238px,54vw)] sm:top-1/2 sm:h-[420px] sm:w-[250px]",
          )}
          style={{
            transform: `translate(calc(-50% + ${shiftX}px), calc(-50% + ${shiftY}px)) scale(${useZoom}) ${rot}`,
            transformStyle: "preserve-3d",
            transition:
              dragging || mode === "player" ? "none" : "transform 280ms var(--ease-out)",
          }}
        >
          <div className="absolute inset-0 rounded border-2 border-[rgba(80,222,255,0.5)] bg-[linear-gradient(180deg,rgba(80,222,255,0.09),rgba(54,147,255,0.04))] shadow-[inset_0_0_30px_rgba(80,222,255,0.1)]" />
          <div className="absolute bottom-0 left-[8%] top-0 border-l border-[rgba(80,222,255,0.24)]" />
          <div className="absolute bottom-0 right-[8%] top-0 border-r border-[rgba(80,222,255,0.24)]" />
          <div className="absolute left-0 right-0 top-[36%] border-t border-[rgba(80,222,255,0.3)]" />
          <div className="absolute left-0 right-0 top-[64%] border-t border-[rgba(80,222,255,0.3)]" />
          <div className="absolute left-1/2 top-0 h-[36%] border-l border-[rgba(80,222,255,0.3)]" />
          <div className="absolute bottom-0 left-1/2 top-[64%] border-l border-[rgba(80,222,255,0.3)]" />
          <div className="absolute left-[6%] right-[6%] top-1/2 border-t border-dashed border-white/30" />

          <div
            className="absolute left-[6%] right-[6%] top-1/2 h-[26px] border-b-2 border-t border-white/25 border-b-white/85"
            style={{
              transformOrigin: "50% 0%",
              transform: "rotateX(90deg)",
              background:
                "repeating-linear-gradient(0deg, rgba(255,255,255,0.14) 0 1px, transparent 1px 6px), repeating-linear-gradient(90deg, rgba(255,255,255,0.14) 0 1px, transparent 1px 6px)",
            }}
          />
          <div
            className="absolute left-[6%] top-1/2 h-[30px] w-[3px] -translate-x-1/2 rounded-sm bg-[linear-gradient(rgba(255,255,255,0.3),rgba(255,255,255,0.8))]"
            style={{ transformOrigin: "50% 0%", transform: "translateX(-50%) rotateX(90deg)" }}
          />
          <div
            className="absolute right-[6%] top-1/2 h-[30px] w-[3px] translate-x-1/2 rounded-sm bg-[linear-gradient(rgba(255,255,255,0.3),rgba(255,255,255,0.8))]"
            style={{ transformOrigin: "50% 0%", transform: "translateX(50%) rotateX(90deg)" }}
          />

          {trail.map((p, i) => {
            const pct = courtToPct(p);
            const o = ((i + 1) / trail.length) * 0.55;
            return (
              <div
                key={i}
                className="absolute h-[5px] w-[5px] rounded-full bg-[rgba(80,222,255,0.85)]"
                style={{
                  left: `${pct.left}%`,
                  top: `${pct.top}%`,
                  opacity: o,
                  transform: `translate(-50%, -50%) translateZ(${pct.z * 14}px)`,
                }}
              />
            );
          })}

          <div className="absolute h-0 w-0" style={{ left: `${sPct.left}%`, top: `${sPct.top}%` }}>
            <div className="mx-land-ping absolute left-0 top-0 h-5 w-5 rounded-full border-[1.5px] border-[rgba(80,222,255,0.55)]" />
          </div>

          {!(hideSelf && playerPov === "A") ? (
            <div
              className="absolute h-0 w-0"
              style={{
                left: `${aPct.left}%`,
                top: `${aPct.top}%`,
                transformStyle: "preserve-3d",
              }}
            >
              <PlayerFigure color="#3693ff" dark="#2563c9" />
            </div>
          ) : null}

          {!(hideSelf && playerPov === "B") ? (
            <div
              className="absolute h-0 w-0"
              style={{
                left: `${bPct.left}%`,
                top: `${bPct.top}%`,
                transformStyle: "preserve-3d",
              }}
            >
              <PlayerFigure color="#fbbf24" dark="#d09410" />
            </div>
          ) : null}

          <div
            className="mx-shuttle absolute h-[10px] w-[10px] rounded-full bg-white"
            style={{
              left: `${sPct.left}%`,
              top: `${sPct.top}%`,
              transform: `translate(-50%, -50%) translateZ(${sPct.z * 14}px)`,
            }}
          />
        </div>
      </div>

      <div className="absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[rgba(10,16,32,0.78)] px-2.5 py-1.5 font-mono text-[10.5px] text-[var(--text-secondary)] backdrop-blur">
        {mode === "corner" ? (
          <>
            <Move3d className="h-3.5 w-3.5 text-[var(--cyan-500)]" aria-hidden />
            Corner · drag to orbit
          </>
        ) : (
          <>
            <Eye className="h-3.5 w-3.5 text-[var(--cyan-500)]" aria-hidden />
            Seeing as{" "}
            {playerPov === "A" ? playerAName.split(" ").pop() : playerBName.split(" ").pop()}
          </>
        )}
      </div>

      {currentShotLabel ? (
        <div className="absolute bottom-12 left-3 z-10 max-w-[min(260px,72%)] rounded-[9px] border border-[var(--border)] bg-[rgba(10,16,32,0.82)] px-2.5 py-1.5 text-[12px] text-[var(--text-strong)] backdrop-blur sm:bottom-3">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--cyan-500)]">
            {overlayBadge}
          </span>
          <div className="mt-0.5 truncate font-medium">{currentShotLabel}</div>
        </div>
      ) : null}

      <div className="absolute bottom-3 right-3 z-10 flex flex-col items-end gap-1.5">
        <div className="rounded-[9px] border border-[var(--border)] bg-[rgba(10,16,32,0.72)] px-2.5 py-1.5 font-mono text-[10.5px] text-[var(--text-muted)] backdrop-blur">
          Shuttle{" "}
          <span className="text-[var(--text-strong)] tabular-nums">
            {frame.shuttle.z.toFixed(2)}m
          </span>
        </div>
        {mode === "corner" ? (
          <div className="flex items-center gap-1.5">
            <div className="hidden items-center gap-2 rounded-[9px] border border-[var(--border)] bg-[rgba(10,16,32,0.72)] px-2.5 py-1.5 font-mono text-[11px] backdrop-blur sm:flex">
              <span className="text-[var(--cyan-500)]">Free orbit</span>
              <span className="h-3 w-px bg-[var(--border)]" />
              <span className="tabular-nums text-[var(--text-muted)]">
                AZ {Math.round(az)}° · EL {Math.round(el)}°
              </span>
            </div>
            {onResetOrbit ? (
              <button
                type="button"
                onClick={onResetOrbit}
                className="inline-flex h-8 w-8 items-center justify-center rounded-[9px] border border-[var(--border)] bg-[rgba(10,16,32,0.78)] text-[var(--text-secondary)] backdrop-blur hover:text-[var(--cyan-500)]"
                title="Reset to corner"
                aria-label="Reset corner camera"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {mode === "player" ? (
        <div className="pointer-events-none absolute left-1/2 top-[42%] h-6 w-6 -translate-x-1/2 -translate-y-1/2">
          <div className="absolute inset-0 rounded-full border border-[rgba(80,222,255,0.28)]" />
          <div className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--cyan-500)]" />
          <div className="absolute left-1/2 top-0 h-1.5 w-px -translate-x-1/2 bg-[rgba(80,222,255,0.35)]" />
          <div className="absolute bottom-0 left-1/2 h-1.5 w-px -translate-x-1/2 bg-[rgba(80,222,255,0.35)]" />
          <div className="absolute left-0 top-1/2 h-px w-1.5 -translate-y-1/2 bg-[rgba(80,222,255,0.35)]" />
          <div className="absolute right-0 top-1/2 h-px w-1.5 -translate-y-1/2 bg-[rgba(80,222,255,0.35)]" />
        </div>
      ) : null}
    </div>
  );
}
