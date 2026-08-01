"use client";

import { useState } from "react";
import {
  Eye,
  Grid2x2,
  Minus,
  MoveDown,
  Orbit,
  Tv,
  type LucideIcon,
} from "lucide-react";

const VIEWS: {
  label: string;
  icon: LucideIcon;
  name: string;
  desc: string;
  t: string;
}[] = [
  {
    label: "Broadcast",
    icon: Tv,
    name: "Broadcast",
    desc: "The familiar elevated side view — where the footage started.",
    t: "scale(0.95) rotateX(56deg)",
  },
  {
    label: "Baseline",
    icon: MoveDown,
    name: "Baseline",
    desc: "Down the court from behind a player — read length and depth.",
    t: "scale(1.12) rotateX(76deg) translateY(6px)",
  },
  {
    label: "Overhead",
    icon: Grid2x2,
    name: "Overhead",
    desc: "A flat top-down map of court coverage and positioning.",
    t: "scale(1.04) rotateX(2deg)",
  },
  {
    label: "Net cam",
    icon: Minus,
    name: "Net cam",
    desc: "Eye-level at the tape — see exactly how tight a net shot lands.",
    t: "scale(1.18) rotateX(83deg) translateY(2px)",
  },
  {
    label: "Player POV",
    icon: Eye,
    name: "Player POV",
    desc: "The view from a player's eyeline as the rally unfolds.",
    t: "scale(1.22) rotateX(80deg) rotateZ(180deg) translateY(8px)",
  },
  {
    label: "Free orbit",
    icon: Orbit,
    name: "Free orbit",
    desc: "Spin to any corner — drag the camera wherever you want.",
    t: "scale(1.02) rotateX(58deg) rotateZ(-22deg)",
  },
];

export function ReplayCameraDemo() {
  const [view, setView] = useState(0);
  const current = VIEWS[view];

  return (
    <div aria-label="Product illustration — not the live product" className="overflow-hidden rounded-[18px] border border-[var(--border)] bg-[linear-gradient(160deg,#0c1426,#070d1a)] shadow-[var(--shadow-xl),0_0_0_1px_rgba(80,222,255,0.1)]">
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
        <span className="h-2 w-2 rounded-full bg-[var(--live)] shadow-[0_0_8px_rgba(80,222,255,0.8)]" />
        <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
          3D replay · rally 22
        </span>
        <div className="flex-1" />
        <span className="font-mono text-[11px] text-[var(--live)]">
          {current.name}
        </span>
      </div>
      <div
        className="relative h-[360px] overflow-hidden"
        style={{
          perspective: 1100,
          background:
            "radial-gradient(120% 90% at 50% 120%, rgba(80,222,255,0.08), transparent 60%)",
        }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(rgba(80,222,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(80,222,255,0.05) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
            maskImage:
              "radial-gradient(70% 70% at 50% 50%, #000, transparent 80%)",
          }}
        />
        <div
          className="absolute left-1/2 top-1/2 h-[330px] w-[196px] transition-transform duration-500"
          style={{
            margin: "-165px 0 0 -98px",
            transform: current.t,
            transformStyle: "preserve-3d",
          }}
        >
          <div className="absolute inset-0 rounded border-2 border-[rgba(80,222,255,0.55)] bg-[linear-gradient(180deg,rgba(80,222,255,0.1),rgba(54,147,255,0.05))] shadow-[inset_0_0_30px_rgba(80,222,255,0.12)]" />
          <div className="absolute left-[8%] right-[8%] top-1/2 border-t border-dashed border-white/30" />
          <div className="absolute left-0 right-0 top-[26%] border-t border-[rgba(80,222,255,0.3)]" />
          <div className="absolute left-0 right-0 top-[74%] border-t border-[rgba(80,222,255,0.3)]" />
          <div className="absolute bottom-0 left-1/2 top-0 border-l border-[rgba(80,222,255,0.3)]" />
          <div className="absolute left-[40%] top-[24%] h-0 w-0">
            <div className="absolute left-1/2 top-1/2 h-3 w-[30px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-[rgba(54,147,255,0.8)] shadow-[0_0_14px_rgba(54,147,255,0.5)]" />
          </div>
          <div className="absolute left-[60%] top-[76%] h-0 w-0">
            <div className="absolute left-1/2 top-1/2 h-3 w-[30px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-[rgba(244,81,92,0.8)] shadow-[0_0_14px_rgba(244,81,92,0.5)]" />
          </div>
          <div className="absolute left-[55%] top-[55%] h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.9),0_0_20px_rgba(80,222,255,0.5)]" />
        </div>
        <div className="absolute bottom-3 left-1/2 flex max-w-[calc(100%-24px)] -translate-x-1/2 gap-1 overflow-x-auto rounded-full border border-[var(--border)] bg-[rgba(10,16,32,0.72)] p-1 backdrop-blur">
          {VIEWS.map((p, i) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setView(i)}
              className={
                i === view
                  ? "shrink-0 rounded-full bg-[var(--live)] px-2.5 py-1 text-[11px] font-medium text-[var(--ink-950)]"
                  : "shrink-0 rounded-full px-2.5 py-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-strong)]"
              }
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="border-t border-[var(--border-subtle)] px-4 py-3">
        <div className="font-display text-[14px] font-semibold text-[var(--text-strong)]">
          {current.name}
        </div>
        <p className="mt-1 text-[12.5px] leading-[1.5] text-[var(--text-muted)]">
          {current.desc}
        </p>
      </div>
    </div>
  );
}
