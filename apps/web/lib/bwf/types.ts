export type Disc = "MS" | "WS";
export type DirMode = "profiles" | "boards";

export const PA = "var(--player-a)";
export const PB = "var(--player-b)";

export type ShotType = "Clear" | "Drop" | "Net" | "Lift" | "Drive" | "Smash";

export const TYPE_COLORS: Record<ShotType, string> = {
  Clear: "#3693ff",
  Drop: "#50deff",
  Net: "#2dd4a7",
  Lift: "#b07bff",
  Drive: "#fbbf24",
  Smash: "#f4515c",
};

export function typeColor(type: string, fallback = "var(--accent)"): string {
  const base = type.split(" ")[0] as ShotType;
  return TYPE_COLORS[base] ?? fallback;
}

export const COUNTRY: Record<string, string> = {
  DEN: "Denmark",
  THA: "Thailand",
  CHN: "China",
  JPN: "Japan",
  MAS: "Malaysia",
  INA: "Indonesia",
  SGP: "Singapore",
  KOR: "South Korea",
  TPE: "Chinese Taipei",
  ESP: "Spain",
  IND: "India",
};

export type Player = {
  id: string;
  name: string;
  country: string;
  countryName: string;
  disc: Disc;
  hand: string;
  rank: number;
  winRate: number;
  matches: number;
  wins: number;
  losses: number;
  titles: number;
  avgRally: number;
  fastestSmash: number;
  movementSpeed: number;
  netWinPct: number;
  enduranceWinPct: number;
  variety: number;
  attackPct: number;
  crossPct: number;
  fhPct: number;
  mix: { type: string; pct: number }[];
  dist: number[];
  zones: number[];
  form: ("W" | "L")[];
  style: string;
};

export type GameScore = { a: number; b: number };

export type Match = {
  id: string;
  a: string;
  b: string;
  w: "a" | "b";
  event: string;
  round: string;
  date: string;
  games: GameScore[];
  disc: Disc;
  pa: Player;
  pb: Player;
  rallies: number;
  avgRally: number;
  fastestSmash: number;
  longest: number;
  dur: number;
  rallyLens: number[];
  momentum: ("a" | "b")[];
  shotMix: { type: string; pct: number }[];
  attackPct: number;
  smashes300: number;
  netWinners: number;
  threeGames: boolean;
  comeback: boolean;
};
