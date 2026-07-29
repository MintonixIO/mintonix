export type CameraPreset = {
  id: string;
  label: string;
  az: number;
  el: number;
  zoom: number;
};

export const PRESETS: readonly CameraPreset[] = [
  { id: "broadcast", label: "Broadcast", az: 0, el: 52, zoom: 0.95 },
  { id: "baseline", label: "Baseline", az: 0, el: 18, zoom: 1.05 },
  { id: "overhead", label: "Overhead", az: 0, el: 88, zoom: 0.85 },
  { id: "player", label: "Player POV", az: -28, el: 12, zoom: 1.15 },
  { id: "side", label: "Side line", az: 90, el: 22, zoom: 1.0 },
];

export type ReplayRally = {
  n: number;
  shots: number;
  result: string;
  score: string;
};

export const RALLIES: ReplayRally[] = [
  { n: 84, shots: 11, result: "Winner · smash", score: "18–16" },
  { n: 85, shots: 6, result: "Error · net", score: "18–17" },
  { n: 86, shots: 14, result: "Winner · drop", score: "19–17" },
  { n: 87, shots: 9, result: "Forced · drive", score: "20–17" },
  { n: 88, shots: 7, result: "Winner · smash", score: "21–17" },
];

export type ReplayShot = {
  n: number;
  type: string;
  who: "A" | "B";
  t: string;
};

export const SHOTS: ReplayShot[] = [
  { n: 1, type: "Serve", who: "A", t: "0.0s" },
  { n: 2, type: "Clear", who: "B", t: "0.8s" },
  { n: 3, type: "Drop", who: "A", t: "1.6s" },
  { n: 4, type: "Net", who: "B", t: "2.3s" },
  { n: 5, type: "Lift", who: "A", t: "2.9s" },
  { n: 6, type: "Smash", who: "B", t: "3.7s" },
  { n: 7, type: "Block", who: "A", t: "4.1s" },
  { n: 8, type: "Drive", who: "B", t: "4.5s" },
  { n: 9, type: "Smash winner", who: "A", t: "5.2s" },
];
