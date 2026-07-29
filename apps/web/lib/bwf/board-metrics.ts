import {
  Clapperboard,
  Percent,
  Swords,
  Trophy,
  Video,
} from "lucide-react";
import type { CatalogPlayer } from "./types";

export const BOARD_METRICS = [
  {
    key: "winRate",
    label: "Win rate",
    short: "Win rate",
    unit: "%",
    icon: Percent,
    color: "var(--success-500)",
    get: (p: CatalogPlayer) => p.winRate,
  },
  {
    key: "wins",
    label: "Wins",
    short: "Wins",
    unit: "",
    icon: Trophy,
    color: "var(--warning-400, #fcd34d)",
    get: (p: CatalogPlayer) => p.wins,
  },
  {
    key: "matches",
    label: "Matches played",
    short: "Matches",
    unit: "",
    icon: Swords,
    color: "var(--accent)",
    get: (p: CatalogPlayer) => p.matches,
  },
  {
    key: "threeGames",
    label: "Three-game matches",
    short: "3-game",
    unit: "",
    icon: Clapperboard,
    color: "var(--viz-5, #b07bff)",
    get: (p: CatalogPlayer) => p.threeGames,
  },
  {
    key: "withVideo",
    label: "Matches with video",
    short: "Video",
    unit: "",
    icon: Video,
    color: "var(--danger-500)",
    get: (p: CatalogPlayer) => p.withVideo,
  },
] as const;

export type BoardMetricKey = (typeof BOARD_METRICS)[number]["key"];
