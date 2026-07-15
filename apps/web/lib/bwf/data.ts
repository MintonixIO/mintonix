import { COUNTRY, type Match, type Player } from "./types";

function rng(seed: number) {
  const x = Math.sin(seed * 99.13 + 7.7) * 10000;
  return x - Math.floor(x);
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

function makePlayers(): Player[] {
  const roster: Omit<
    Player,
    | "countryName"
    | "winRate"
    | "matches"
    | "wins"
    | "losses"
    | "titles"
    | "avgRally"
    | "fastestSmash"
    | "movementSpeed"
    | "netWinPct"
    | "enduranceWinPct"
    | "variety"
    | "attackPct"
    | "crossPct"
    | "fhPct"
    | "mix"
    | "dist"
    | "zones"
    | "form"
    | "style"
  >[] = [
    { id: "axelsen", name: "Viktor Axelsen", country: "DEN", disc: "MS", hand: "Right hand", rank: 1 },
    { id: "kunlavut", name: "Kunlavut Vitidsarn", country: "THA", disc: "MS", hand: "Right hand", rank: 2 },
    { id: "antonsen", name: "Anders Antonsen", country: "DEN", disc: "MS", hand: "Right hand", rank: 3 },
    { id: "shiyuqi", name: "Shi Yu Qi", country: "CHN", disc: "MS", hand: "Right hand", rank: 4 },
    { id: "naraoka", name: "Kodai Naraoka", country: "JPN", disc: "MS", hand: "Right hand", rank: 5 },
    { id: "leezii", name: "Lee Zii Jia", country: "MAS", disc: "MS", hand: "Right hand", rank: 6 },
    { id: "christie", name: "Jonatan Christie", country: "INA", disc: "MS", hand: "Right hand", rank: 7 },
    { id: "loh", name: "Loh Kean Yew", country: "SGP", disc: "MS", hand: "Right hand", rank: 8 },
    { id: "anseyoung", name: "An Se-young", country: "KOR", disc: "WS", hand: "Right hand", rank: 1 },
    { id: "taitzu", name: "Tai Tzu-ying", country: "TPE", disc: "WS", hand: "Right hand", rank: 2 },
    { id: "yamaguchi", name: "Akane Yamaguchi", country: "JPN", disc: "WS", hand: "Right hand", rank: 3 },
    { id: "marin", name: "Carolina Marin", country: "ESP", disc: "WS", hand: "Left hand", rank: 4 },
    { id: "chenyufei", name: "Chen Yufei", country: "CHN", disc: "WS", hand: "Right hand", rank: 5 },
    { id: "hebingjiao", name: "He Bingjiao", country: "CHN", disc: "WS", hand: "Left hand", rank: 6 },
    { id: "sindhu", name: "P.V. Sindhu", country: "IND", disc: "WS", hand: "Right hand", rank: 7 },
    { id: "ratchanok", name: "Ratchanok Intanon", country: "THA", disc: "WS", hand: "Right hand", rank: 8 },
  ];
  const types = ["Clear", "Drop", "Net", "Lift", "Drive", "Smash"];
  return roster.map((p) => {
    const sd = hash(p.id);
    const r = (k: number) => rng(sd * 0.001 + k);
    const winRate = 55 + Math.round(r(1) * 23);
    const matches = 52 + Math.round(r(2) * 92);
    const wins = Math.round((matches * winRate) / 100);
    const titles = 3 + Math.round(r(3) * 21);
    const avgRally = +(7.6 + r(4) * 4.2).toFixed(1);
    const fastestSmash =
      p.disc === "WS"
        ? 328 + Math.round(r(5) * 70)
        : 386 + Math.round(r(5) * 58);
    const attackPct = 42 + Math.round(r(6) * 23);
    const crossPct = 31 + Math.round(r(7) * 19);
    const fhPct = 56 + Math.round(r(8) * 18);
    const movementSpeed = +(
      (p.disc === "WS" ? 18.4 : 19.6) +
      r(50) * 4.4
    ).toFixed(1);
    const netWinPct = 38 + Math.round(r(51) * 34);
    const enduranceWinPct = 44 + Math.round(r(52) * 40);
    const variety = 5 + Math.round(r(53) * 3);
    const raw = types.map((_, i) => 6 + r(10 + i) * 22);
    const sum = raw.reduce((a, b) => a + b, 0);
    let mix = types.map((t, i) => ({
      type: t,
      pct: Math.round((raw[i] / sum) * 100),
    }));
    mix[0].pct += 100 - mix.reduce((a, b) => a + b.pct, 0);
    mix = mix.sort((a, b) => b.pct - a.pct);
    const dist = [0, 1, 2, 3, 4].map((i) => 8 + Math.round(r(20 + i) * 30));
    const zones = [0, 1, 2, 3, 4, 5].map(
      (i) => 20 + Math.round(r(30 + i) * 80),
    );
    const form = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) =>
      r(40 + i) < winRate / 100 ? ("W" as const) : ("L" as const),
    );
    const style =
      attackPct >= 56
        ? "Power attacker"
        : attackPct >= 50
          ? "All-court aggressor"
          : attackPct >= 46
            ? "Balanced all-court"
            : "Defensive counter-puncher";
    return {
      ...p,
      countryName: COUNTRY[p.country] || p.country,
      winRate,
      matches,
      wins,
      losses: matches - wins,
      titles,
      avgRally,
      fastestSmash,
      movementSpeed,
      netWinPct,
      enduranceWinPct,
      variety,
      attackPct,
      crossPct,
      fhPct,
      mix,
      dist,
      zones,
      form,
      style,
    };
  });
}

export const PLAYERS = makePlayers();

export function byId(id: string) {
  return PLAYERS.find((p) => p.id === id);
}

function requirePlayer(id: string) {
  const p = byId(id);
  if (!p) throw new Error(`Unknown player id: ${id}`);
  return p;
}

function makeMatches(): Match[] {
  const defs = [
    { a: "axelsen", b: "kunlavut", w: "a" as const, event: "World Championships", round: "Final", date: "25 Aug 2025", games: "21-18, 21-15" },
    { a: "antonsen", b: "shiyuqi", w: "a" as const, event: "All England Open", round: "Final", date: "16 Mar 2025", games: "21-14, 18-21, 21-19" },
    { a: "naraoka", b: "leezii", w: "b" as const, event: "Japan Open", round: "Semifinal", date: "12 Jul 2025", games: "19-21, 21-17, 21-13" },
    { a: "christie", b: "loh", w: "a" as const, event: "Indonesia Open", round: "Quarterfinal", date: "06 Jun 2025", games: "21-16, 21-19" },
    { a: "axelsen", b: "shiyuqi", w: "a" as const, event: "World Tour Finals", round: "Final", date: "15 Dec 2024", games: "21-12, 21-17" },
    { a: "kunlavut", b: "antonsen", w: "b" as const, event: "Denmark Open", round: "Semifinal", date: "19 Oct 2025", games: "21-19, 21-23, 19-21" },
    { a: "leezii", b: "axelsen", w: "b" as const, event: "Malaysia Open", round: "Final", date: "11 Jan 2025", games: "17-21, 16-21" },
    { a: "anseyoung", b: "yamaguchi", w: "a" as const, event: "World Championships", round: "Final", date: "24 Aug 2025", games: "21-14, 21-16" },
    { a: "taitzu", b: "marin", w: "a" as const, event: "All England Open", round: "Final", date: "16 Mar 2025", games: "21-18, 21-19" },
    { a: "chenyufei", b: "sindhu", w: "a" as const, event: "China Open", round: "Semifinal", date: "21 Sep 2025", games: "21-15, 17-21, 21-18" },
    { a: "anseyoung", b: "chenyufei", w: "a" as const, event: "Olympic Games", round: "Final", date: "05 Aug 2024", games: "21-13, 21-16" },
    { a: "hebingjiao", b: "ratchanok", w: "a" as const, event: "Singapore Open", round: "Quarterfinal", date: "30 May 2025", games: "21-12, 21-14" },
    { a: "marin", b: "anseyoung", w: "b" as const, event: "India Open", round: "Final", date: "19 Jan 2025", games: "19-21, 21-15, 18-21" },
    { a: "taitzu", b: "yamaguchi", w: "b" as const, event: "French Open", round: "Semifinal", date: "27 Oct 2024", games: "21-17, 18-21, 19-21" },
  ];
  return defs.map((d, idx) => {
    const sd = hash(d.a + d.b + d.date);
    const r = (k: number) => rng(sd * 0.001 + k);
    const games = d.games.split(",").map((g) => {
      const [x, y] = g.trim().split("-").map(Number);
      return { a: x, b: y };
    });
    const rallies = 30 + Math.round(r(1) * 24);
    const avgRally = +(8.0 + r(2) * 3.6).toFixed(1);
    const fastestSmash = 360 + Math.round(r(3) * 80);
    const longest = 22 + Math.round(r(4) * 16);
    const dur = 38 + Math.round(r(5) * 36);
    const pa = requirePlayer(d.a);
    const pb = requirePlayer(d.b);
    const rallyLens: number[] = [];
    const momentum: ("a" | "b")[] = [];
    const wbias = d.w === "a" ? 0.57 : 0.43;
    for (let i = 0; i < rallies; i++) {
      rallyLens.push(
        4 + Math.round(rng(sd * 0.07 + i) * Math.max(6, longest - 4)),
      );
      momentum.push(rng(sd * 0.05 + i * 1.7) < wbias ? "a" : "b");
    }
    const mixTypes = ["Smash", "Clear", "Drop", "Net", "Drive", "Lift"];
    const rawMix = mixTypes.map(
      (_, i) => 7 + rng(sd * 0.11 + i * 2.3) * 22,
    );
    const mixSum = rawMix.reduce((a, b) => a + b, 0);
    const shotMix = mixTypes.map((t, i) => ({
      type: t,
      pct: Math.round((rawMix[i] / mixSum) * 100),
    }));
    shotMix[0].pct += 100 - shotMix.reduce((a, b) => a + b.pct, 0);
    const attackPct = 44 + Math.round(rng(sd * 0.21) * 22);
    const smashes300 = 7 + Math.round(rng(sd * 0.31) * 23);
    const netWinners = 2 + Math.round(rng(sd * 0.41) * 7);
    const threeGames = games.length === 3;
    const lostG1 =
      (d.w === "a" && games[0].a < games[0].b) ||
      (d.w === "b" && games[0].b < games[0].a);
    const comeback = threeGames && lostG1;
    return {
      id: String(idx + 1),
      a: d.a,
      b: d.b,
      w: d.w,
      event: d.event,
      round: d.round,
      date: d.date,
      games,
      disc: pa.disc,
      pa,
      pb,
      rallies,
      avgRally,
      fastestSmash,
      longest,
      dur,
      rallyLens,
      momentum,
      shotMix,
      attackPct,
      smashes300,
      netWinners,
      threeGames,
      comeback,
    };
  });
}

export const MATCHES = makeMatches();

export function parseDate(d: string) {
  return new Date(d).getTime();
}

export function h2hRecord(aId: string, bId: string) {
  const lo = aId < bId ? aId : bId;
  const hi = aId < bId ? bId : aId;
  const sd = hash(lo + "|" + hi);
  const n = 5 + (sd % 9);
  const loWins = 1 + Math.floor(rng(sd * 0.001) * (n - 1));
  const aWins = aId === lo ? loWins : n - loWins;
  return { n, aWins, bWins: n - aWins };
}

/** Lens filter metadata (icons mapped in the matches view). */
export const LENS = [
  { id: "all", label: "All matches" },
  { id: "long", label: "Long rallies" },
  { id: "fast", label: "Fastest smashes" },
  { id: "marathon", label: "Marathons" },
  { id: "attacking", label: "Attacking battles" },
  { id: "comeback", label: "Comebacks" },
  { id: "close", label: "Three-game wars" },
] as const;

export type LensId = (typeof LENS)[number]["id"];


