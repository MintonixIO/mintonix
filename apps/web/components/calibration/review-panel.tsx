import {
  CheckCircle2,
  Crosshair,
  Film,
  Gauge,
  Minus,
  Sparkles,
  User,
} from "lucide-react";
import type { RefObject } from "react";
import {
  PBOX,
  POLE,
  computeQuality,
  timecodeOf,
  type Marks,
} from "@/lib/calibration/geometry";
import { DIR, PA, PB } from "@/lib/calibration/constants";

type Quality = ReturnType<typeof computeQuality>;

export type ReviewPanelProps = {
  reviewVidRef: RefObject<HTMLVideoElement | null>;
  marks: Marks;
  Q: Quality;
  activeCorners: [number, number][];
  identify: Record<"a" | "b", { q: string; id: string | null }>;
  calibFrame: number;
};

export function ReviewPanel({
  reviewVidRef,
  marks,
  Q,
  activeCorners,
  identify,
  calibFrame,
}: ReviewPanelProps) {
  return (
    <div className="flex flex-col gap-[15px]">
      {/* Review thumb */}
      <div className="relative aspect-video w-full overflow-hidden rounded-[11px] border border-[var(--border)]">
        <video
          ref={reviewVidRef}
          src="/media/clip.mp4"
          muted
          playsInline
          preload="auto"
          tabIndex={-1}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <svg
          viewBox="0 0 1600 900"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
        >
          {Q.n >= 4 ? (
            <polygon
              points={activeCorners.map((p) => p.join(",")).join(" ")}
              fill="rgba(54,147,255,0.12)"
              stroke={PA}
              strokeWidth={3}
            />
          ) : null}
          {Q.netReady ? (
            <line
              x1={(marks["net-l"] || POLE[0])[0]}
              y1={(marks["net-l"] || POLE[0])[1]}
              x2={(marks["net-r"] || POLE[1])[0]}
              y2={(marks["net-r"] || POLE[1])[1]}
              stroke={PA}
              strokeWidth={3}
              strokeDasharray="8 6"
            />
          ) : null}
          {Object.entries(marks).map(([id, p]) => (
            <circle
              key={id}
              cx={p[0]}
              cy={p[1]}
              r={8}
              fill={PA}
              stroke="#fff"
              strokeWidth={2}
            />
          ))}
          {(["a", "b"] as const).map((k) => {
            const c = k === "a" ? PA : PB;
            const b = PBOX[k];
            return (
              <rect
                key={k}
                x={b.x}
                y={b.y}
                width={b.w}
                height={b.h}
                rx={8}
                fill={c}
                fillOpacity={0.14}
                stroke={c}
                strokeWidth={3}
              />
            );
          })}
        </svg>
        <div className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1.5 rounded-[7px] bg-[rgba(7,8,9,0.78)] px-2 py-1 font-mono text-[11px] text-[var(--success-500)]">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Court rectified
        </div>
      </div>

      <div className="overflow-hidden rounded-[13px] border border-[var(--border)] bg-[var(--surface-2)]">
        {(
          [
            {
              icon: Crosshair,
              label: "Reference points",
              value: `${Q.n} marked`,
              ok: true,
            },
            {
              icon: Minus,
              label: "Net plane",
              value: Q.netReady ? "Posts marked" : "Inferred",
              ok: Q.netReady,
            },
            {
              icon: Gauge,
              label: "Fit quality",
              value: `${Q.label} · ${Q.err}px`,
              qcolor: Q.color,
            },
            {
              icon: User,
              label: "Player A",
              value:
                DIR.find((u) => u.id === identify.a.id)?.name || "Unnamed",
              color: PA,
            },
            {
              icon: User,
              label: "Player B",
              value:
                DIR.find((u) => u.id === identify.b.id)?.name || "Unnamed",
              color: PB,
            },
            {
              icon: Film,
              label: "Calibration frame",
              value: timecodeOf(calibFrame),
            },
          ] as const
        ).map((r) => {
          const Icon = r.icon;
          const iconBg =
            "color" in r && r.color
              ? r.color === PB
                ? "rgba(251,191,36,0.14)"
                : "rgba(54,147,255,0.14)"
              : "ok" in r && r.ok
                ? "var(--success-bg,rgba(45,212,167,0.12))"
                : "var(--surface-3)";
          const iconColor =
            "color" in r && r.color
              ? r.color
              : "ok" in r && r.ok
                ? "var(--success-500)"
                : "var(--text-secondary)";
          const valueColor =
            "qcolor" in r && r.qcolor
              ? r.qcolor
              : "color" in r && r.color
                ? r.color
                : "var(--text-strong)";
          return (
            <div
              key={r.label}
              className="flex items-center gap-2.5 border-b border-[var(--border-subtle)] px-3.5 py-3 last:border-b-0"
            >
              <span
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                style={{ background: iconBg, color: iconColor }}
              >
                <Icon className="h-[15px] w-[15px]" />
              </span>
              <span className="flex-1 text-[13px] text-[var(--text-secondary)]">
                {r.label}
              </span>
              <span
                className="text-right font-mono text-[12.5px] tabular-nums"
                style={{ color: valueColor }}
              >
                {r.value}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex items-start gap-2 rounded-[11px] border border-[rgba(54,147,255,0.2)] bg-[var(--brand-subtle,rgba(54,147,255,0.12))] px-3 py-3">
        <Sparkles className="mt-px h-[15px] w-[15px] shrink-0 text-[var(--brand)]" />
        <span className="text-[12.5px] leading-[1.5] text-[var(--text-primary)]">
          Mintonix will rectify the court from your reference points, track the
          shuttle, and break the match into rallies. This usually takes a few
          minutes.
        </span>
      </div>
    </div>
  );
}
