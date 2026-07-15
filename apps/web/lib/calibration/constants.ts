import type { StepKey } from "./geometry";

/** Player A accent — maps to design token --player-a */
export const PA = "var(--player-a)";
/** Player B accent — maps to design token --player-b */
export const PB = "var(--player-b)";

export const STEPS: { key: StepKey; label: string }[] = [
  { key: "points", label: "Court" },
  { key: "players", label: "Players" },
  { key: "review", label: "Review" },
];

export const DIR = [
  { id: "axelsen", name: "Viktor Axelsen", handle: "@axelsen", meta: "WR 1 · DEN" },
  { id: "momota", name: "Kento Momota", handle: "@momota", meta: "WR 4 · JPN" },
  { id: "ginting", name: "Anthony Ginting", handle: "@ginting", meta: "WR 6 · INA" },
  { id: "antonsen", name: "Anders Antonsen", handle: "@antonsen", meta: "WR 3 · DEN" },
  { id: "lee", name: "Lee Zii Jia", handle: "@ziijia", meta: "WR 9 · MAS" },
  { id: "naraoka", name: "Kodai Naraoka", handle: "@naraoka", meta: "WR 7 · JPN" },
  { id: "popov", name: "Christo Popov", handle: "@cpopov", meta: "WR 14 · FRA" },
  { id: "you", name: "You (this device)", handle: "@me", meta: "Your profile" },
];
