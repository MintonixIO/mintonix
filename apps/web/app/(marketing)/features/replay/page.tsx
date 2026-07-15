import type { Metadata } from "next";
import Link from "next/link";
import {
  Box,
  Minus,
  Orbit,
  Search,
  Share2,
  Video,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/marketing/reveal";
import { ReplayCameraDemo } from "@/components/marketing/replay-camera-demo";

export const metadata: Metadata = {
  title: "Replay",
  description:
    "Watch any match from any angle with Mintonix Replay — reconstructed rallies, free camera placement.",
};

const STEPS: {
  n: string;
  icon: LucideIcon;
  title: string;
  body: string;
}[] = [
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

const USE_CASES: {
  icon: LucideIcon;
  title: string;
  body: string;
}[] = [
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

            <ReplayCameraDemo />
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
