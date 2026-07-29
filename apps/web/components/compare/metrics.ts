import type { PlayerStats } from "@/lib/matches";

export type MetricKey = keyof Pick<
  PlayerStats,
  "winRate" | "rally" | "smash" | "net" | "attack" | "errors"
>;

export type MetricConfig = {
  key: MetricKey;
  label: string;
  unit: string;
  hint: string;
  dir: "hi" | "lo";
};

export const METRICS: MetricConfig[] = [
  {
    key: "winRate",
    label: "Win rate",
    unit: "%",
    hint: "higher is better",
    dir: "hi",
  },
  {
    key: "rally",
    label: "Avg rally length",
    unit: "",
    hint: "patience index",
    dir: "hi",
  },
  {
    key: "smash",
    label: "Top smash",
    unit: " km/h",
    hint: "peak shuttle speed",
    dir: "hi",
  },
  {
    key: "net",
    label: "Net points won",
    unit: "%",
    hint: "forecourt control",
    dir: "hi",
  },
  {
    key: "attack",
    label: "Attacking share",
    unit: "%",
    hint: "aggression",
    dir: "hi",
  },
  {
    key: "errors",
    label: "Unforced errors",
    unit: " /match",
    hint: "lower is better",
    dir: "lo",
  },
];

export const SHOT_TYPES = [
  { t: "Clear", c: "var(--viz-1, #3693ff)" },
  { t: "Drop", c: "var(--viz-2, #50deff)" },
  { t: "Smash", c: "var(--viz-6, #f4515c)" },
  { t: "Net", c: "var(--viz-3, #2dd4a7)" },
];
