export type Disc = "MS" | "WS" | "MD" | "WD" | "XD";
export type DirMode = "profiles" | "boards";

export const DISCS: Disc[] = ["MS", "WS", "MD", "WD", "XD"];

export const DISC_LABEL: Record<Disc, string> = {
  MS: "Men's singles",
  WS: "Women's singles",
  MD: "Men's doubles",
  WD: "Women's doubles",
  XD: "Mixed doubles",
};

export const PA = "var(--player-a)";
export const PB = "var(--player-b)";

export type MatchStatus = "pending" | "processing" | "ready" | "failed";

export type GameScore = { t1: number; t2: number };

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
  games: GameScore[];
  /** Winning side 1 or 2, or null if undetermined. */
  winner: 1 | 2 | null;
  threeGames: boolean;
  comeback: boolean;
  status: MatchStatus;
  sourceUrl: string | null;
  durationSec: number | null;
  createdAt: string;
};

/** Aggregated player profile derived from catalog matches. */
export type CatalogPlayer = {
  id: string;
  name: string;
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
  rivals: { id: string; name: string; meetings: number; wins: number }[];
  recentMatchIds: string[];
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

export type MatchFilters = {
  q?: string;
  disc?: Disc | "all";
  event?: string;
  round?: string;
  year?: number | "all";
  player?: string;
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
};
