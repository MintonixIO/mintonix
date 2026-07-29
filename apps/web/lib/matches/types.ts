/**
 * Canonical match / video domain types for the web app.
 * Pipeline statuses are the source of truth; UI labels map at the edge.
 */

export type MatchStatus = "queued" | "analyzing" | "ready" | "failed";

export type MatchOutcome = "win" | "loss" | "draw" | null;

/** Lightweight card used on dashboard / library / uploads. */
export type MatchSummary = {
  id: string;
  title: string;
  /** Primary display line (players or opponent). */
  players: string;
  event?: string;
  /** Formatted duration label (e.g. "41:20"). */
  duration: string;
  status: MatchStatus;
  progress?: number;
  href?: string;
  date?: string;
  tags?: string[];
};

/** Richer library row with sort keys and result metadata. */
export type LibraryMatch = MatchSummary & {
  opponent: string;
  tournament: string;
  /** Numeric recency key (higher = newer). */
  ord: number;
  win: boolean | null;
  score: string;
  shots: number;
  size: string;
  /** Null while duration is unknown (e.g. processing). */
  dur: string | null;
  durMin: number;
};

export type RallyTone = "success" | "danger" | "warn";

export type ShotSide = "FH" | "BH";

export type Shot = {
  i: number;
  type: string;
  side: ShotSide;
  color: string;
  speed?: number;
  who?: "A" | "B";
  t?: string;
};

export type Rally = {
  n: number;
  shots: number;
  dur: number;
  end: string;
  tone?: RallyTone;
  result?: string;
  score?: string;
  sequence: Shot[];
};

export type PlayerStats = {
  id: string;
  name: string;
  record: string;
  winRate: number;
  rally: number;
  smash: number;
  net: number;
  attack: number;
  errors: number;
  /** Shot mix percentages (Clear, Drop, Net, Smash-ish buckets). */
  mix: [number, number, number, number];
};
