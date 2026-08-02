"use client";

import { Camera, Move3d } from "lucide-react";
import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { PlayerFigure } from "@/components/replay/player-figure";
import { PRESETS } from "@/lib/replay/data";
import { cn } from "@/lib/utils";

type ReplayViewportProps = {
  preset: string;
  az: number;
  el: number;
  zoom: number;
  rot: string;
  viewLabel: string;
  onOrbit: (az: number, el: number) => void;
  onZoom: (deltaY: number) => void;
  onPreset: (id: string) => void;
  onCustom: () => void;
};

export function ReplayViewport({
  preset,
  az,
  el,
  zoom,
  rot,
  viewLabel,
  onOrbit,
  onZoom,
  onPreset,
  onCustom,
}: ReplayViewportProps) {
  const dragRef = useRef<{ x: number; y: number; az: number; el: number } | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);

  const onStageDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    dragRef.current = { x: e.clientX, y: e.clientY, az, el };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onCustom();
  };

  const onStageMove = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    onOrbit(d.az + dx * 0.35, Math.max(6, Math.min(88, d.el - dy * 0.25)));
  };

  const onStageUp = () => {
    dragRef.current = null;
    setDragging(false);
  };

  const onWheel = (e: ReactWheelEvent) => {
    e.preventDefault();
    onZoom(e.deltaY);
    onCustom();
  };

  return (
    <div
      onPointerDown={onStageDown}
      onPointerMove={onStageMove}
      onPointerUp={onStageUp}
      onPointerCancel={onStageUp}
      onWheel={onWheel}
      className="relative min-h-0 flex-1 touch-none overflow-hidden bg-[radial-gradient(120%_90%_at_50%_118%,rgba(80,222,255,0.07),transparent_60%)]"
      style={{ cursor: dragging ? "grabbing" : "grab" }}
      role="img"
      aria-label="3D court replay viewport. Drag to orbit, scroll to zoom."
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(80,222,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(80,222,255,0.045) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
          maskImage:
            "radial-gradient(72% 72% at 50% 50%, #000, transparent 82%)",
        }}
      />

      {/* CSS 3D court */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ perspective: 1150 }}
      >
        <div
          className="absolute left-1/2 top-1/2 h-[420px] w-[250px] origin-center will-change-transform"
          style={{
            transform: `translate(-50%, -50%) scale(${zoom}) ${rot}`,
            transformStyle: "preserve-3d",
            transition: dragging
              ? "none"
              : "transform 280ms var(--ease-out, ease)",
          }}
        >
          {/* surface */}
          <div className="absolute inset-0 rounded border-2 border-[rgba(80,222,255,0.5)] bg-[linear-gradient(180deg,rgba(80,222,255,0.09),rgba(255,255,255,0.035))] shadow-[inset_0_0_30px_rgba(80,222,255,0.1)]" />
          {/* singles lines */}
          <div className="absolute bottom-0 left-[8%] top-0 border-l border-[rgba(80,222,255,0.24)]" />
          <div className="absolute bottom-0 right-[8%] top-0 border-r border-[rgba(80,222,255,0.24)]" />
          {/* service */}
          <div className="absolute left-0 right-0 top-[36%] border-t border-[rgba(80,222,255,0.3)]" />
          <div className="absolute left-0 right-0 top-[64%] border-t border-[rgba(80,222,255,0.3)]" />
          <div className="absolute left-1/2 top-0 h-[36%] border-l border-[rgba(80,222,255,0.3)]" />
          <div className="absolute bottom-0 left-1/2 top-[64%] border-l border-[rgba(80,222,255,0.3)]" />
          {/* net floor line */}
          <div className="absolute left-[6%] right-[6%] top-1/2 border-t border-dashed border-white/30" />
          {/* standing net mesh */}
          <div
            className="absolute left-[6%] right-[6%] top-1/2 h-[26px] border-b-2 border-t border-white/25 border-b-white/85"
            style={{
              transformOrigin: "50% 0%",
              transform: "rotateX(90deg)",
              background:
                "repeating-linear-gradient(0deg, rgba(255,255,255,0.14) 0 1px, transparent 1px 6px), repeating-linear-gradient(90deg, rgba(255,255,255,0.14) 0 1px, transparent 1px 6px)",
            }}
          />
          {/* net posts */}
          <div
            className="absolute left-[6%] top-1/2 h-[30px] w-[3px] -translate-x-1/2 rounded-sm bg-[linear-gradient(rgba(255,255,255,0.3),rgba(255,255,255,0.8))]"
            style={{
              transformOrigin: "50% 0%",
              transform: "translateX(-50%) rotateX(90deg)",
            }}
          />
          <div
            className="absolute right-[6%] top-1/2 h-[30px] w-[3px] translate-x-1/2 rounded-sm bg-[linear-gradient(rgba(255,255,255,0.3),rgba(255,255,255,0.8))]"
            style={{
              transformOrigin: "50% 0%",
              transform: "translateX(50%) rotateX(90deg)",
            }}
          />

          {/* landing marker — uses global mxPing keyframes */}
          <div className="absolute left-1/2 top-[20%] h-0 w-0">
            <div className="mx-land-ping absolute left-0 top-0 h-5 w-5 rounded-full border-[1.5px] border-[rgba(80,222,255,0.75)]" />
            <div className="absolute left-0 top-0 h-[5px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[rgba(80,222,255,0.8)]" />
          </div>

          {/* player A far (blue) */}
          <div
            className="absolute left-[46%] top-[24%] h-0 w-0"
            style={{ transformStyle: "preserve-3d" }}
          >
            <PlayerFigure color="#3693ff" dark="#2563c9" />
          </div>
          {/* player B near (cool ice-violet) */}
          <div
            className="absolute left-[56%] top-[72%] h-0 w-0"
            style={{ transformStyle: "preserve-3d" }}
          >
            <PlayerFigure color="#8b9cff" dark="#6b7ae0" />
          </div>
          {/* shuttle */}
          <div
            className="absolute left-[58%] top-[70%] h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.9),0_0_22px_rgba(80,222,255,0.5)]"
            style={{ transform: "translate(-50%, -50%) translateZ(2px)" }}
          />
        </div>
      </div>

      {/* preset pills */}
      <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 gap-1.5 rounded-full border border-[var(--border)] bg-[rgba(10,16,32,0.72)] p-1.5 backdrop-blur-[10px]">
        {PRESETS.map((p) => {
          const active = preset === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onPreset(p.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs",
                active
                  ? "bg-[var(--cyan-500)] font-medium text-[#04141b] shadow-[0_0_14px_rgba(80,222,255,0.35)]"
                  : "bg-transparent text-[var(--text-secondary)] hover:bg-[rgba(80,222,255,0.08)] hover:text-[var(--text-strong)]",
              )}
            >
              <Camera className="h-3 w-3" aria-hidden />
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="absolute bottom-3 left-3 z-10 inline-flex items-center gap-1.5 rounded-[9px] border border-[var(--border)] bg-[rgba(10,16,32,0.72)] px-2.5 py-1.5 font-mono text-[10.5px] tracking-wide text-[var(--text-muted)] backdrop-blur">
        <Move3d className="h-3.5 w-3.5 text-[var(--cyan-500)]" aria-hidden />
        Drag to orbit · scroll to zoom
      </div>
      <div className="absolute bottom-3 right-3 z-10 flex items-center gap-2 rounded-[9px] border border-[var(--border)] bg-[rgba(10,16,32,0.72)] px-2.5 py-1.5 font-mono text-[11px] backdrop-blur">
        <span className="text-[var(--cyan-500)]">{viewLabel}</span>
        <span className="h-3 w-px bg-[var(--border)]" />
        <span className="tabular-nums text-[var(--text-muted)]">
          AZ {Math.round(az)}° · EL {Math.round(el)}° · {zoom.toFixed(2)}×
        </span>
      </div>
    </div>
  );
}
