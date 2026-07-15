"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Camera,
  Move3d,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Video,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PRESETS = [
  { id: "broadcast", label: "Broadcast", icon: Camera, az: 0, el: 52, zoom: 0.95 },
  { id: "baseline", label: "Baseline", icon: Camera, az: 0, el: 18, zoom: 1.05 },
  { id: "overhead", label: "Overhead", icon: Camera, az: 0, el: 88, zoom: 0.85 },
  { id: "player", label: "Player POV", icon: Camera, az: -28, el: 12, zoom: 1.15 },
  { id: "side", label: "Side line", icon: Camera, az: 90, el: 22, zoom: 1.0 },
] as const;

const RALLIES = [
  { n: 84, shots: 11, result: "Winner · smash", score: "18–16" },
  { n: 85, shots: 6, result: "Error · net", score: "18–17" },
  { n: 86, shots: 14, result: "Winner · drop", score: "19–17" },
  { n: 87, shots: 9, result: "Forced · drive", score: "20–17" },
  { n: 88, shots: 7, result: "Winner · smash", score: "21–17" },
];

const SHOTS = [
  { n: 1, type: "Serve", who: "A", t: "0.0s" },
  { n: 2, type: "Clear", who: "B", t: "0.8s" },
  { n: 3, type: "Drop", who: "A", t: "1.6s" },
  { n: 4, type: "Net", who: "B", t: "2.3s" },
  { n: 5, type: "Lift", who: "A", t: "2.9s" },
  { n: 6, type: "Smash", who: "B", t: "3.7s" },
  { n: 7, type: "Block", who: "A", t: "4.1s" },
  { n: 8, type: "Drive", who: "B", t: "4.5s" },
  { n: 9, type: "Smash winner", who: "A", t: "5.2s" },
];

function PlayerFigure({ color, dark }: { color: string; dark: string }) {
  return (
    <>
      {/* floor shadow */}
      <div
        className="absolute left-1/2 top-1/2 h-[11px] w-[26px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px]"
        style={{
          borderColor: `${color}bf`,
          background: `radial-gradient(closest-side, ${color}4d, transparent)`,
          boxShadow: `0 0 12px ${color}73`,
        }}
      />
      {/* billboard figure face-on */}
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
      {/* side billboard */}
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

export function ReplayApp() {
  const [preset, setPreset] = useState<string>("broadcast");
  const [az, setAz] = useState(0);
  const [el, setEl] = useState(52);
  const [zoom, setZoom] = useState(0.95);
  const [playing, setPlaying] = useState(false);
  const [shot, setShot] = useState(4);
  const [rally, setRally] = useState(86);
  const dragRef = useRef<{ x: number; y: number; az: number; el: number } | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  const applyPreset = useCallback((id: string) => {
    const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0];
    setPreset(id);
    setAz(p.az);
    setEl(p.el);
    setZoom(p.zoom);
  }, []);

  const rot = useMemo(
    () => `rotateX(${el}deg) rotateZ(${az}deg)`,
    [az, el],
  );

  const onStageDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    dragRef.current = { x: e.clientX, y: e.clientY, az, el };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setPreset("custom");
  };

  const onStageMove = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    setAz(d.az + dx * 0.35);
    setEl(Math.max(6, Math.min(88, d.el - dy * 0.25)));
  };

  const onStageUp = () => {
    dragRef.current = null;
    setDragging(false);
  };

  const onWheel = (e: ReactWheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.55, Math.min(1.9, z - e.deltaY * 0.001)));
    setPreset("custom");
  };

  // Auto-advance shots when playing
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setShot((s) => {
        if (s >= SHOTS.length) {
          setPlaying(false);
          return s;
        }
        return s + 1;
      });
    }, 900);
    return () => clearInterval(id);
  }, [playing]);

  const viewLabel =
    PRESETS.find((p) => p.id === preset)?.label ?? "Free camera";
  const scoreA = 20;
  const scoreB = 17;

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-base)] text-[var(--text-primary)]">
      <style jsx global>{`
        @keyframes mx-ping {
          0% {
            transform: translate(-50%, -50%) scale(0.55);
            opacity: 0.9;
          }
          80% {
            transform: translate(-50%, -50%) scale(1.15);
            opacity: 0.15;
          }
          100% {
            transform: translate(-50%, -50%) scale(1.15);
            opacity: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .mx-land-ping {
            animation: none !important;
          }
        }
      `}</style>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex min-h-[62px] items-center gap-3.5 border-b border-[var(--border-subtle)] bg-[rgba(10,16,32,0.78)] px-5 py-2.5">
          <Link
            href="/dashboard/library"
            aria-label="Back to library"
            className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-strong)]"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-2 font-mono text-xs text-[var(--text-muted)]"
          >
            <span>Library</span>
            <span className="text-[var(--text-faint)]">/</span>
            <span>Axelsen vs Momota</span>
            <span className="text-[var(--text-faint)]">/</span>
            <span className="text-[var(--text-strong)]">Replay</span>
          </nav>
          <div className="flex-1" />
          <div className="flex items-center gap-2.5 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5">
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-[var(--text-secondary)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--player-a)]" />
              Axelsen
            </span>
            <span className="font-mono text-[13px] tabular-nums text-[var(--text-strong)]">
              {scoreA} — {scoreB}
            </span>
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-[var(--text-secondary)]">
              Momota
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--player-b)]" />
            </span>
            <span className="font-mono text-[10.5px] tracking-widest text-[var(--text-faint)]">
              G3
            </span>
          </div>
          <Button variant="outline" size="sm">
            Export clip
          </Button>
        </header>

        <div className="flex min-h-0 flex-1 gap-4 p-4 pb-5">
          {/* Viewport */}
          <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[linear-gradient(160deg,#0c1426,#070d1a)] shadow-[var(--shadow-lg),0_0_0_1px_rgba(80,222,255,0.06)]">
            <div
              ref={stageRef}
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
                  <div className="absolute inset-0 rounded border-2 border-[rgba(80,222,255,0.5)] bg-[linear-gradient(180deg,rgba(80,222,255,0.09),rgba(54,147,255,0.04))] shadow-[inset_0_0_30px_rgba(80,222,255,0.1)]" />
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

                  {/* landing marker */}
                  <div className="absolute left-1/2 top-[20%] h-0 w-0">
                    <div
                      className="mx-land-ping absolute left-0 top-0 h-5 w-5 rounded-full border-[1.5px] border-[rgba(80,222,255,0.75)]"
                      style={{ animation: "mx-ping 1.7s ease-out infinite" }}
                    />
                    <div className="absolute left-0 top-0 h-[5px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[rgba(80,222,255,0.8)]" />
                  </div>

                  {/* player A far (blue) */}
                  <div
                    className="absolute left-[46%] top-[24%] h-0 w-0"
                    style={{ transformStyle: "preserve-3d" }}
                  >
                    <PlayerFigure color="#3693ff" dark="#2563c9" />
                  </div>
                  {/* player B near (amber) */}
                  <div
                    className="absolute left-[56%] top-[72%] h-0 w-0"
                    style={{ transformStyle: "preserve-3d" }}
                  >
                    <PlayerFigure color="#fbbf24" dark="#d09410" />
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
                  const Icon = p.icon;
                  const active = preset === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => applyPreset(p.id)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs",
                        active
                          ? "bg-[var(--cyan-500)] font-medium text-[#04141b] shadow-[0_0_14px_rgba(80,222,255,0.35)]"
                          : "bg-transparent text-[var(--text-secondary)] hover:bg-[rgba(80,222,255,0.08)] hover:text-[var(--text-strong)]",
                      )}
                    >
                      <Icon className="h-3 w-3" aria-hidden />
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

            {/* Playback bar */}
            <div className="flex items-center gap-3 border-t border-[var(--border-subtle)] bg-[rgba(10,16,32,0.6)] px-3.5 py-2.5">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Previous shot"
                  onClick={() => setShot((s) => Math.max(1, s - 1))}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:text-[var(--text-strong)]"
                >
                  <SkipBack className="h-[15px] w-[15px]" />
                </button>
                <button
                  type="button"
                  aria-label={playing ? "Pause" : "Play"}
                  onClick={() => setPlaying((v) => !v)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-[9px] bg-[var(--accent)] text-white shadow-[0_0_16px_rgba(54,147,255,0.35)]"
                >
                  {playing ? (
                    <Pause className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                </button>
                <button
                  type="button"
                  aria-label="Next shot"
                  onClick={() => setShot((s) => Math.min(SHOTS.length, s + 1))}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:text-[var(--text-strong)]"
                >
                  <SkipForward className="h-[15px] w-[15px]" />
                </button>
              </div>
              <span className="whitespace-nowrap font-mono text-[11.5px] tabular-nums text-[var(--text-muted)]">
                Shot {shot} / {SHOTS.length}
              </span>
              <div
                className="relative h-6 flex-1 cursor-pointer"
                role="slider"
                aria-label="Shot scrubber"
                aria-valuemin={1}
                aria-valuemax={SHOTS.length}
                aria-valuenow={shot}
                tabIndex={0}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  const t = Math.max(
                    1,
                    Math.min(
                      SHOTS.length,
                      Math.round(((e.clientX - r.left) / r.width) * SHOTS.length),
                    ),
                  );
                  setShot(t);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft") setShot((s) => Math.max(1, s - 1));
                  if (e.key === "ArrowRight")
                    setShot((s) => Math.min(SHOTS.length, s + 1));
                }}
              >
                <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-sm bg-[#1b2744]" />
                {/* shot tick marks */}
                {SHOTS.map((s) => (
                  <div
                    key={s.n}
                    className="pointer-events-none absolute top-1/2 h-2 w-px -translate-y-1/2 bg-[var(--border)]"
                    style={{ left: `${((s.n - 0.5) / SHOTS.length) * 100}%` }}
                  />
                ))}
                <div
                  className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-sm bg-[linear-gradient(90deg,var(--accent),var(--cyan-500))]"
                  style={{ width: `${(shot / SHOTS.length) * 100}%` }}
                />
                <div
                  className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--cyan-500)] shadow-[0_0_8px_rgba(80,222,255,0.5)]"
                  style={{ left: `${(shot / SHOTS.length) * 100}%` }}
                />
              </div>
              <span className="font-mono text-[11.5px] tabular-nums text-[var(--text-muted)]">
                {SHOTS[shot - 1]?.t ?? "0.0s"}
              </span>
            </div>
          </section>

          {/* Right panel */}
          <aside className="flex w-[320px] shrink-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-edge)]">
            <div className="flex items-center gap-2.5 border-b border-[var(--border-subtle)] px-4 py-3.5">
              <Video className="h-4 w-4 text-[var(--cyan-500)]" aria-hidden />
              <div>
                <div className="font-display text-[15px] font-semibold text-[var(--text-strong)]">
                  Rally {rally}
                </div>
                <div className="font-mono text-[11px] text-[var(--text-muted)]">
                  {SHOTS.length} shots · G3 · {scoreA}–{scoreB}
                </div>
              </div>
            </div>

            <div className="border-b border-[var(--border-subtle)] p-2">
              <div className="mb-1.5 px-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
                Rallies
              </div>
              <div className="max-h-[160px] space-y-1 overflow-y-auto">
                {RALLIES.map((r) => (
                  <button
                    key={r.n}
                    type="button"
                    onClick={() => setRally(r.n)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left",
                      rally === r.n
                        ? "border border-[rgba(80,222,255,0.35)] bg-[rgba(80,222,255,0.1)]"
                        : "border border-transparent hover:bg-[var(--surface-2)]",
                    )}
                  >
                    <span className="font-mono text-[12px] font-semibold tabular-nums text-[var(--text-secondary)]">
                      {r.n}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--text-strong)]">
                      {r.result}
                    </span>
                    <span className="font-mono text-[10px] text-[var(--text-muted)]">
                      {r.shots}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <div className="mb-1.5 px-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
                Shots in rally
              </div>
              <div className="space-y-1" role="listbox" aria-label="Shots in rally">
                {SHOTS.map((s) => (
                  <button
                    key={s.n}
                    type="button"
                    role="option"
                    aria-selected={shot === s.n}
                    onClick={() => setShot(s.n)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left",
                      shot === s.n
                        ? "border border-[var(--border)] bg-[var(--accent-soft)]"
                        : "border border-transparent hover:bg-[var(--surface-2)]",
                    )}
                  >
                    <span className="font-mono text-[12px] tabular-nums text-[var(--text-muted)]">
                      {s.n}
                    </span>
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        s.who === "A" ? "bg-[var(--player-a)]" : "bg-[var(--player-b)]",
                      )}
                    />
                    <span className="flex-1 text-[12.5px] text-[var(--text-strong)]">
                      {s.type}
                    </span>
                    <span className="font-mono text-[10px] text-[var(--text-muted)]">
                      {s.t}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-[var(--border-subtle)] p-3">
              <Link href="/video-analysis" className="block">
                <Button variant="outline" block size="sm">
                  Open match analysis
                </Button>
              </Link>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
