export type Disc = "MS" | "WS" | "MD" | "WD" | "XD";

export const DISCS: Disc[] = ["MS", "WS", "MD", "WD", "XD"];

export const DISC_LABEL: Record<Disc, string> = {
  MS: "Men's singles",
  WS: "Women's singles",
  MD: "Men's doubles",
  WD: "Women's doubles",
  XD: "Mixed doubles",
};

export type MatchStatus = "pending" | "processing" | "ready" | "failed";

/** Short labels for match cards and compact UI. */
export const BWF_STATUS_LABEL: Record<MatchStatus, string> = {
  pending: "Queued",
  processing: "Analyzing",
  ready: "Ready",
  failed: "Failed",
};

/** Longer labels for match detail / status chips. */
export const BWF_STATUS_LABEL_LONG: Record<MatchStatus, string> = {
  pending: "Queued for analysis",
  processing: "Analysis in progress",
  ready: "Analysis ready",
  failed: "Analysis failed",
};

/**
 * Card/badge presentation for each match status (label + Tailwind className).
 * Exhaustive over MatchStatus so UI cannot special-case only ready/failed.
 */
export const BWF_STATUS_UI: Record<
  MatchStatus,
  { label: string; className: string }
> = {
  pending: {
    label: BWF_STATUS_LABEL.pending,
    className:
      "border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)]",
  },
  processing: {
    label: BWF_STATUS_LABEL.processing,
    className:
      "border-[var(--border)] bg-[var(--brand-subtle)] text-[var(--brand)]",
  },
  ready: {
    label: BWF_STATUS_LABEL.ready,
    className:
      "border-[rgba(45,212,167,0.35)] bg-[rgba(45,212,167,0.12)] text-[var(--success-500)]",
  },
  failed: {
    label: BWF_STATUS_LABEL.failed,
    className:
      "border-[rgba(244,81,92,0.35)] bg-[rgba(244,81,92,0.12)] text-[var(--danger-500)]",
  },
};

/** Shared limit for shell local search + `/api/bwf/search`. */
export const BWF_SEARCH_LIMIT = 8;

/** Max typeahead query length (API route, shell fetch, buildSearchHits). */
export const BWF_SEARCH_MAX_Q = 100;

export type GameScore = { t1: number; t2: number };

/** Wiki match outcome. Ratings ignore walkover / retired / incomplete. */
export type MatchResult = "completed" | "walkover" | "retired" | "incomplete";

/** One finished BWF match from the `matches` table. */
export type CatalogMatch = {
  id: string;
  /** Composite raw column, e.g. `2026 Japan Open · MS · Final`. */
  tournamentRaw: string;
  /** Display event name with Wikipedia noise stripped. */
  event: string;
  year: number | null;
  disc: Disc | null;
  round: string;
  matchDate: string | null;
  team1: string[];
  team2: string[];
  team1Ids: string[];
  team2Ids: string[];
  team1Countries: (string | null)[];
  team2Countries: (string | null)[];
  games: GameScore[];
  /** Winning side 1 or 2, or null if undetermined. */
  winner: 1 | 2 | null;
  /** Wiki outcome; walkover/retired are stored but not rated. */
  result: MatchResult | null;
  threeGames: boolean;
  comeback: boolean;
  status: MatchStatus;
  sourceUrl: string | null;
  durationSec: number | null;
  createdAt: string;
};

/**
 * Slim player row for directory / leaderboard lists.
 * No rivals, form, or recent match ids (those live only on full profiles).
 */
export type DirectoryPlayer = {
  id: string;
  name: string;
  country: string | null;
  disc: Disc | null;
  discs: Disc[];
  matches: number;
  wins: number;
  losses: number;
  winRate: number;
  threeGames: number;
  withVideo: number;
  imageUrl: string | null;
  rating: FormRating | null;
};

export type FormRating = {
  disc: Disc;
  kind: "player" | "pair" | "individual";
  mu: number;
  rd?: number;
  rankScore?: number;
  peakMu?: number;
  exposure?: number;
  matches: number;
};

export type RivalRow = {
  id: string;
  name: string;
  meetings: number;
  wins: number;
  /** Win rate in [0, 1] against this opponent. */
  winRate: number;
};

/** Aggregated player profile derived from catalog matches (detail + H2H). */
export type CatalogPlayer = {
  id: string;
  name: string;
  country: string | null;
  /** Primary discipline by match count. */
  disc: Disc | null;
  discs: Disc[];
  matches: number;
  wins: number;
  losses: number;
  winRate: number;
  threeGames: number;
  withVideo: number;
  form: ("W" | "L")[];
  /** Opponent id → meetings / wins for this player. */
  rivals: RivalRow[];
  owns: RivalRow[];
  struggles: RivalRow[];
  rating: FormRating | null;
  individualRating: FormRating | null;
  /** Glicko boards this person appears on (MS / WS / MD / WD / XD). */
  ratings: FormRating[];
  /** Optional remote image URL (currently rare). */
  imageUrl: string | null;
};

export type CatalogStats = {
  matches: number;
  players: number;
  tournaments: number;
  withVideo: number;
  byDisc: Record<Disc, number>;
  events: { event: string; year: number | null; count: number }[];
  rounds: string[];
  years: number[];
};

/** Home board headline counts + disc chips (not match-filter facets). */
export type HomeStats = Pick<
  CatalogStats,
  "matches" | "players" | "tournaments" | "withVideo" | "byDisc"
>;

export type MatchFilters = {
  q?: string;
  disc?: Disc | "all";
  event?: string;
  round?: string;
  year?: number | "all";
  hasVideo?: boolean;
  threeGames?: boolean;
  comeback?: boolean;
  sort?: "event" | "round" | "created" | "status";
  page?: number;
  pageSize?: number;
};

export type SearchHit =
  | {
      kind: "Player";
      id: string;
      label: string;
      sub: string;
      href: string;
    }
  | {
      kind: "Match";
      id: string;
      label: string;
      sub: string;
      href: string;
    }
  | {
      kind: "Tournament";
      id: string;
      label: string;
      sub: string;
      href: string;
    };

/** Slim roster option for H2H picker (avoids shipping full profiles). */
export type H2hPickerPlayer = {
  id: string;
  name: string;
  matches: number;
  disc: Disc | null;
  country: string | null;
};

/** Same form band: rank-score within this many points. */
export const FORM_BAND = 200;

export const OWNS_MIN_MEETINGS = 4;
export const OWNS_WIN_RATE = 0.7;
export const STRUGGLES_WIN_RATE = 0.3;
