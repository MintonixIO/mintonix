import type { Metadata } from "next";
import {
  Box,
  Minus,
  Orbit,
  Search,
  Share2,
  Video,
  type LucideIcon,
} from "lucide-react";
import {
  FeatureCTA,
  FeatureHero,
  FeatureSection,
  FeatureValueGrid,
} from "@/components/marketing/feature-page";
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
      <FeatureHero
        EyebrowIcon={Orbit}
        eyebrow="Replay"
        eyebrowClassName="bg-[rgba(80,222,255,0.16)] text-[var(--cyan-500,#50deff)]"
        titleClassName="text-[clamp(34px,4.6vw,56px)]"
        title="Filmed from one angle. Watch from any."
        body="Mintonix reconstructs the court and both players in 3D from a single camera. Once it's rebuilt, you fly the camera anywhere — baseline, overhead, the net, even a player's eyeline."
        ctas={[
          { href: "/bwf/matches", label: "Browse BWF matches" },
          {
            href: "/replay",
            label: "Try it on a BWF match",
            variant: "outline",
          },
        ]}
        glow="radial-gradient(120% 70% at 70% -10%, rgba(80,222,255,0.14), transparent 56%)"
        contentClassName="pt-[88px]"
        gridClassName="grid items-center gap-12 lg:grid-cols-[0.82fr_1.18fr] lg:gap-12"
      >
        <ReplayCameraDemo />
      </FeatureHero>

      <FeatureSection
        className="pt-[120px]"
        eyebrow="How it works"
        eyebrowClassName="text-[var(--cyan-500,#50deff)]"
        title="One camera in. A whole arena of views out."
        headerClassName="mb-12 max-w-[640px]"
      >
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
      </FeatureSection>

      <FeatureSection
        className="pt-[116px]"
        eyebrow="Use cases"
        eyebrowClassName="text-[var(--cyan-500,#50deff)]"
        title="The angle the broadcast never gave you."
      >
        <FeatureValueGrid
          columns={2}
          iconWrapClassName="bg-[rgba(80,222,255,0.16)] text-[var(--cyan-500,#50deff)]"
          items={USE_CASES}
        />
      </FeatureSection>

      <FeatureCTA
        className="pt-[116px]"
        title="Move the camera. The match stays put."
        body="Open any analyzed match and switch to Replay. Free camera included on every plan."
        ctas={[
          { href: "/bwf", label: "Open BWF catalog" },
          {
            href: "/replay",
            label: "Open a demo rally",
            variant: "outline",
          },
        ]}
        glow="radial-gradient(120% 140% at 50% -20%, rgba(80,222,255,0.14), transparent 60%), var(--surface-1)"
      />
    </div>
  );
}
