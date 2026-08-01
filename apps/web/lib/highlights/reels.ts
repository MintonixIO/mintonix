export type ReelStatus = "ready" | "draft" | "rendering";

export type Reel = {
  id: string;
  title: string;
  criteriaLabel: string;
  clips: number;
  dur: string;
  status: ReelStatus;
  progress?: number;
  /** Match / context line shown on dashboard cards */
  match: string;
  /** Thumbnail glow color for card previews */
  glow: string;
};

export const REELS: Reel[] = [
  {
    id: "r1",
    title: "Smash winners",
    criteriaLabel: "Smash · 300+ km/h",
    clips: 6,
    dur: "1:40",
    status: "ready",
    match: "Axelsen vs Momota · Final",
    glow: "rgba(54,147,255,0.14)",
  },
  {
    id: "r2",
    title: "Long rallies won",
    criteriaLabel: "Rally ≥ 12 · won",
    clips: 9,
    dur: "3:24",
    status: "ready",
    match: "An Se-young vs Marín · SF",
    glow: "rgba(45,212,167,0.14)",
  },
  {
    id: "r3",
    title: "Net kills & winners",
    criteriaLabel: "Net · winners",
    clips: 5,
    dur: "1:12",
    status: "draft",
    match: "Tai Tzu-ying vs Sindhu · Group B",
    glow: "rgba(139,156,255,0.12)",
  },
  {
    id: "r5",
    title: "Defensive saves",
    criteriaLabel: "Defense · retrievals",
    clips: 8,
    dur: "2:46",
    status: "rendering",
    progress: 72,
    match: "Christie vs L. Sen · SF",
    glow: "rgba(80,222,255,0.12)",
  },
  {
    id: "r7",
    title: "Match point reel",
    criteriaLabel: "Winners only",
    clips: 3,
    dur: "0:48",
    status: "draft",
    match: "Shi Yu Qi vs Lee ZJ · Final",
    glow: "rgba(176,123,255,0.12)",
  },
];
