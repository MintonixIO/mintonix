/** Court coords in meters. Origin = court center. +Y = near baseline (player A). +Z = up. */
export type Vec3 = { x: number; y: number; z: number };

export type PlayerId = "A" | "B";

export type ShotType =
  | "Serve"
  | "Clear"
  | "Drop"
  | "Smash"
  | "Drive"
  | "Net"
  | "Lift"
  | "Block"
  | "Net kill";

export type RallyTag =
  | "fast-smash"
  | "long-rally"
  | "net-play"
  | "winner"
  | "unforced"
  | "high-intensity"
  | "short";

export type Shot = {
  id: string;
  index: number;
  type: ShotType;
  player: PlayerId;
  side: "FH" | "BH";
  t0: number;
  t1: number;
  speedKmh: number;
  contactHeight: number;
  target: { x: number; y: number };
  analysis: string;
};

export type Frame = {
  t: number;
  a: Vec3;
  b: Vec3;
  shuttle: Vec3;
  shotIndex: number;
};

export type Rally = {
  id: string;
  n: number;
  set: number;
  scoreA: number;
  scoreB: number;
  /** Absolute match clock (seconds) at rally start */
  matchT0: number;
  duration: number;
  winner: PlayerId;
  endReason: string;
  tags: RallyTag[];
  shots: Shot[];
  frames: Frame[];
  maxSmashKmh: number;
  intensity: number;
};

export type MatchMeta = {
  id: string;
  title: string;
  event: string;
  playerA: { name: string; country: string };
  playerB: { name: string; country: string };
  finalScore: string;
  sets: number;
  fps: number;
  /**
   * YouTube video id for broadcast feed, or null when none.
   * Never invent a video for catalog matches that lack a source.
   */
  youtubeId: string | null;
  /** Honest label for the analysis stream (demo vs future pipeline). */
  broadcastLabel: string;
  /** Added to matchT when seeking YouTube (0 for synthetic demos). */
  broadcastOffset: number;
};

export type MatchData = {
  meta: MatchMeta;
  rallies: Rally[];
  totalDuration: number;
  setBounds: Array<{ set: number; t0: number; t1: number; score: string }>;
};

/** UI moment filters = tags except "short" (short still tags rallies). */
export type MomentFilter = "all" | Exclude<RallyTag, "short">;

export const FILTER_LABELS: Record<MomentFilter, string> = {
  all: "All",
  "fast-smash": "Smash",
  "long-rally": "Long",
  "net-play": "Net",
  winner: "Winners",
  unforced: "Errors",
  "high-intensity": "Intense",
};

/**
 * Three viewing modes:
 * - broadcast: official camera (YouTube embed)
 * - corner: low corner 3D, free orbit
 * - player: first-person what that player sees
 */
export type ViewMode = "broadcast" | "corner" | "player";

export type PlayerPov = PlayerId;

export const VIEW_MODES: Array<{
  id: ViewMode;
  label: string;
  hint: string;
}> = [
  { id: "broadcast", label: "Broadcast", hint: "Official YouTube camera feed" },
  { id: "corner", label: "Corner", hint: "Low corner · drag to orbit" },
  { id: "player", label: "Player POV", hint: "See what the player sees" },
];

/** Drill-down scope for the match navigator + transport scrubber. */
export type TimelineScope =
  | { level: "match" }
  | { level: "set"; set: number }
  | { level: "rally"; rallyId: string };
