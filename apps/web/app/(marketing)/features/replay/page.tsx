"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Box,
  Eye,
  Grid2x2,
  Minus,
  MoveDown,
  Orbit,
  Search,
  Share2,
  Tv,
  Video,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/marketing/reveal";

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

const STEPS = [
  {
    n: "01",
    icon: Video,
    title: "Upload single-camera footage",
    body: "Any fixed full-court angle — broadcast, a tripod in the stands, a phone on a clamp. One camera is enough.",
  },
  {
    n: "02",
    icon: Box,
    title: "Mintonix rebuilds it in 3D",
    body: "Court geometry, both players, and the shuttle are reconstructed into a true spatial model of the rally.",
  },
  {
    n: "03",
    icon: Orbit,
    title: "Fly the camera anywhere",
    body: "Pick a preset viewpoint or orbit freely. Scrub the rally and the whole scene moves with you.",
  },
];

const USE_CASES = [
  {
    icon: Orbit,
    title: "Coach from the baseline",
    body: "See the court the way the player did — spacing, recovery, and the openings they missed.",
  },
  {
    icon: Minus,
    title: "Settle the net",
    body: "Drop to tape height to judge whether a net shot really tumbled over, no broadcast guesswork.",
  },
  {
    icon: Search,
    title: "Scout an opponent",
    body: "Watch from overhead to map a rival's patterns and the corners they leave exposed.",
  },
  {
    icon: Share2,
    title: "Make it shareable",
    body: "Export the angle you chose as a clip and send it with a single link — the view travels with it.",
  },
];

export default function FeatureReplayPage() {
  const [view, setView] = useState(0);
  const current = VIEWS[view];

  return (
    <div className="overflow-x-clip">
      <section className="relative">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 70% at 70% -10%, rgba(80,222,255,0.14), transparent 56%)",
          }}
        />
        <div className="relative mx-auto max-w-[1320px] px-8 pt-[88px]">
          <div className="grid items-center gap-12 lg:grid-cols-[0.82fr_1.18fr] lg:gap-12">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[rgba(80,222,255,0.16)] px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--cyan-500,#50deff)]">
                <Orbit className="h-3.5 w-3.5" />
                Replay
              </div>
              <h1 className="mt-[22px] font-display text-[clamp(34px,4.6vw,56px)] font-semibold leading-[1.04] tracking-[-0.03em] text-[var(--text-strong)] text-balance">
                Filmed from one angle. Watch from any.
              </h1>
              <p className="mt-5 max-w-[46ch] text-[clamp(15px,1.5vw,18px)] leading-[1.62] text-[var(--text-secondary)]">
                Mintonix reconstructs the court and both players in 3D from a
                single camera. Once it&apos;s rebuilt, you fly the camera anywhere
                — baseline, overhead, the net, even a player&apos;s eyeline.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/auth">
                  <Button size="lg">Replay a match</Button>
                </Link>
                <Link href="/replay">
                  <Button variant="outline" size="lg">
                    Try it on a BWF match
                  </Button>
                </Link>
              </div>
            </div>

            <div className="overflow-hidden rounded-[18px] border border-[var(--border)] bg-[linear-gradient(160deg,#0c1426,#070d1a)] shadow-[var(--shadow-xl),0_0_0_1px_rgba(80,222,255,0.1)]">
              <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
                <span className="h-2 w-2 rounded-full bg-[var(--cyan-500,#50deff)] shadow-[0_0_8px_rgba(80,222,255,0.8)]" />
                <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                  3D replay · rally 22
                </span>
                <div className="flex-1" />
                <span className="font-mono text-[11px] text-[var(--cyan-500,#50deff)]">
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
                          ? "shrink-0 rounded-full bg-[var(--cyan-500,#50deff)] px-2.5 py-1 text-[11px] font-medium text-[#04141b]"
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
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1180px] px-8 pt-[120px]">
        <Reveal className="mb-12 max-w-[640px]">
          <div className="mb-3.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--cyan-500,#50deff)]">
            How it works
          </div>
          <h2 className="font-display text-[clamp(28px,3.4vw,42px)] font-semibold leading-[1.1] tracking-[-0.025em] text-[var(--text-strong)] text-balance">
            One camera in. A whole arena of views out.
          </h2>
        </Reveal>
        <div className="grid gap-4 md:grid-cols-3">
          {STEPS.map((s) => (
            <Reveal
              key={s.n}
              className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-6"
            >
              <div className="flex items-center gap-3">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border)] bg-[rgba(80,222,255,0.16)] text-[var(--cyan-500,#50deff)]">
                  <s.icon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <span className="font-mono text-[12px] text-[var(--cyan-500,#50deff)]">
                  {s.n}
                </span>
              </div>
              <h3 className="mt-4 font-display text-[17px] font-semibold text-[var(--text-strong)]">
                {s.title}
              </h3>
              <p className="mt-2 text-[14px] leading-[1.6] text-[var(--text-secondary)]">
                {s.body}
              </p>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1180px] px-8 pt-[116px]">
        <Reveal className="mb-10 max-w-[640px]">
          <div className="mb-3.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--cyan-500,#50deff)]">
            Use cases
          </div>
          <h2 className="font-display text-[clamp(28px,3.4vw,42px)] font-semibold leading-[1.1] tracking-[-0.025em] text-[var(--text-strong)] text-balance">
            The angle the broadcast never gave you.
          </h2>
        </Reveal>
        <div className="grid gap-4 sm:grid-cols-2">
          {USE_CASES.map((u) => (
            <Reveal
              key={u.title}
              className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-[22px] transition-transform hover:-translate-y-0.5"
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-[11px] border border-[var(--border)] bg-[rgba(80,222,255,0.16)] text-[var(--cyan-500,#50deff)]">
                <u.icon className="h-[19px] w-[19px]" strokeWidth={1.75} />
              </span>
              <h3 className="mt-4 font-display text-base font-semibold text-[var(--text-strong)]">
                {u.title}
              </h3>
              <p className="mt-1.5 text-[13.5px] leading-[1.55] text-[var(--text-secondary)]">
                {u.body}
              </p>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1180px] px-8 pb-[140px] pt-[116px]">
        <Reveal
          className="relative rounded-[20px] border border-[var(--border)] px-8 py-[72px] text-center"
          style={{
            background:
              "radial-gradient(120% 140% at 50% -20%, rgba(80,222,255,0.14), transparent 60%), var(--surface-1)",
          }}
        >
          <h2 className="mx-auto max-w-[18ch] font-display text-[clamp(28px,3.6vw,44px)] font-semibold leading-[1.08] tracking-[-0.03em] text-[var(--text-strong)] text-balance">
            Move the camera. The match stays put.
          </h2>
          <p className="mx-auto mt-4 max-w-[46ch] text-[16px] leading-[1.6] text-[var(--text-secondary)]">
            Open any analyzed match and switch to Replay. Free camera included on
            every plan.
          </p>
          <div className="mt-[30px] flex flex-wrap items-center justify-center gap-3">
            <Link href="/auth">
              <Button size="lg">Start free</Button>
            </Link>
            <Link href="/replay">
              <Button variant="outline" size="lg">
                Open a demo rally
              </Button>
            </Link>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
