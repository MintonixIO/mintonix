"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  ChevronsUpDown,
  Clock,
  Flame,
  Footprints,
  LayoutGrid,
  Repeat,
  Search,
  ShieldAlert,
  Swords,
  Target,
  Trophy,
  User,
  X,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Tabs } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type Disc = "MS" | "WS";
type View = "home" | "matches" | "players" | "h2h";
type DirMode = "profiles" | "boards";

const PA = "#3693ff";
const PB = "#fbbf24";

const TYPE_COLORS: Record<string, string> = {
  Clear: "#3693ff",
  Drop: "#50deff",
  Net: "#2dd4a7",
  Lift: "#b07bff",
  Drive: "#fbbf24",
  Smash: "#f4515c",
};

const COUNTRY: Record<string, string> = {
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

type Player = {
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

type GameScore = { a: number; b: number };

type Match = {
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

const PLAYERS = makePlayers();
const byId = (id: string) => PLAYERS.find((p) => p.id === id)!;

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
    const pa = byId(d.a);
    const pb = byId(d.b);
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

const MATCHES = makeMatches();

function parseDate(d: string) {
  return new Date(d).getTime();
}

function h2hRecord(aId: string, bId: string) {
  const lo = aId < bId ? aId : bId;
  const hi = aId < bId ? bId : aId;
  const sd = hash(lo + "|" + hi);
  const n = 5 + (sd % 9);
  const loWins = 1 + Math.floor(rng(sd * 0.001) * (n - 1));
  const aWins = aId === lo ? loWins : n - loWins;
  return { n, aWins, bWins: n - aWins };
}

const LENS = [
  { id: "all", label: "All matches", icon: LayoutGrid },
  { id: "long", label: "Long rallies", icon: Repeat },
  { id: "fast", label: "Fastest smashes", icon: Zap },
  { id: "marathon", label: "Marathons", icon: Clock },
  { id: "attacking", label: "Attacking battles", icon: Swords },
  { id: "comeback", label: "Comebacks", icon: Flame },
  { id: "close", label: "Three-game wars", icon: Flame },
] as const;

const BOARD_METRICS = [
  {
    key: "fastestSmash",
    label: "Fastest smash",
    short: "Smash speed",
    unit: " km/h",
    icon: Zap,
    color: "var(--danger-500)",
    get: (p: Player) => p.fastestSmash,
  },
  {
    key: "movementSpeed",
    label: "Top court speed",
    short: "Court speed",
    unit: " km/h",
    icon: Footprints,
    color: "var(--cyan-500, #50deff)",
    get: (p: Player) => p.movementSpeed,
  },
  {
    key: "attackPct",
    label: "Attack rate",
    short: "Attack rate",
    unit: "%",
    icon: Swords,
    color: "var(--accent)",
    get: (p: Player) => p.attackPct,
  },
  {
    key: "netWinPct",
    label: "Net winners",
    short: "Net play",
    unit: "%",
    icon: Target,
    color: "var(--success-500)",
    get: (p: Player) => p.netWinPct,
  },
  {
    key: "enduranceWinPct",
    label: "Rally endurance",
    short: "Endurance",
    unit: "%",
    icon: Repeat,
    color: "var(--viz-5, #b07bff)",
    get: (p: Player) => p.enduranceWinPct,
  },
  {
    key: "winRate",
    label: "Win rate",
    short: "Win rate",
    unit: "%",
    icon: Trophy,
    color: "var(--warning-400, #fcd34d)",
    get: (p: Player) => p.winRate,
  },
] as const;

function MatchCard({ m, lens = "all" }: { m: Match; lens?: string }) {
  const top = [...m.shotMix].sort((a, b) => b.pct - a.pct);
  const badge =
    lens === "long"
      ? { label: "Longest rally", value: `${m.longest} shots`, color: "var(--accent)" }
      : lens === "fast"
        ? { label: "Top smash", value: `${m.fastestSmash} km/h`, color: "var(--danger-500)" }
        : lens === "marathon"
          ? { label: "Duration", value: `${m.dur} min`, color: "var(--text-strong)" }
          : lens === "attacking"
            ? { label: "Attacking", value: `${m.attackPct}%`, color: "var(--accent)" }
            : null;

  const row = (player: Player, color: string, won: boolean, side: "a" | "b") => (
    <div className="flex items-center gap-2.5">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: color }}
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate font-display text-base",
          won
            ? "font-semibold text-[var(--text-strong)]"
            : "font-medium text-[var(--text-secondary)]",
        )}
      >
        {player.name}
      </span>
      {m.games.map((g, i) => (
        <span
          key={i}
          className={cn(
            "w-6 text-center font-mono text-sm tabular-nums",
            won ? "text-[var(--text-strong)]" : "text-[var(--text-muted)]",
          )}
        >
          {side === "a" ? g.a : g.b}
        </span>
      ))}
      {won ? (
        <span className="ml-1 inline-flex text-[var(--success-500)]">
          <Check className="h-[15px] w-[15px]" />
        </span>
      ) : (
        <span className="ml-1 w-[15px]" />
      )}
    </div>
  );

  return (
    <Link
      href="/video-analysis"
      className="group flex flex-col overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-edge)] transition-[transform,border-color] duration-160 hover:-translate-y-0.5 hover:border-[var(--border-strong)]"
    >
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-[13px]">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-[var(--accent)]">
          {m.disc}
        </span>
        <span className="h-[3px] w-[3px] rounded-full bg-[var(--text-faint)]" />
        <span className="min-w-0 truncate text-[12.5px] text-[var(--text-secondary)]">
          {m.event} · {m.round}
        </span>
        <div className="flex-1" />
        <span className="shrink-0 font-mono text-[11px] text-[var(--text-muted)]">
          {m.date}
        </span>
      </div>

      <div className="flex flex-col gap-[9px] px-4 pb-3 pt-3.5">
        {row(m.pa, PA, m.w === "a", "a")}
        {row(m.pb, PB, m.w === "b", "b")}
      </div>

      <div className="flex flex-col gap-3 px-4 pb-3.5">
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
            {m.rallies} rallies · {m.avgRally} avg · {m.dur} min
          </span>
          <div className="flex-1" />
          {badge ? (
            <span className="inline-flex items-baseline gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-3)] px-2.5 py-[3px]">
              <span className="font-mono text-[8.5px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
                {badge.label}
              </span>
              <span
                className="font-mono text-xs tabular-nums"
                style={{ color: badge.color }}
              >
                {badge.value}
              </span>
            </span>
          ) : null}
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
              Momentum
            </span>
            <span className="font-mono text-[9.5px] text-[var(--text-faint)]">
              who won each rally
            </span>
          </div>
          <div className="flex h-[9px] gap-0.5 overflow-hidden rounded">
            {m.momentum.map((w, i) => (
              <div
                key={i}
                title={`Rally ${i + 1} · ${m.rallyLens[i]} shots`}
                className="h-full opacity-85"
                style={{
                  flexGrow: m.rallyLens[i],
                  flexBasis: 0,
                  background: w === "a" ? PA : PB,
                }}
              />
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
              Shot mix
            </span>
            <span className="font-mono text-[9.5px] text-[var(--text-muted)]">
              {top[0].type} {top[0].pct}% · {top[1].type} {top[1].pct}%
            </span>
          </div>
          <div className="flex h-[7px] overflow-hidden rounded bg-[var(--surface-3)]">
            {m.shotMix.map((s) => (
              <div
                key={s.type}
                title={`${s.type} ${s.pct}%`}
                style={{
                  width: `${s.pct}%`,
                  background: TYPE_COLORS[s.type] || "var(--accent)",
                }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] px-4 py-3">
        {(
          [
            {
              key: "fast",
              icon: Zap,
              text: `${m.smashes300} smashes 300+`,
              color: "var(--danger-500)",
            },
            {
              key: "long",
              icon: Repeat,
              text: `Longest ${m.longest}`,
              color: "var(--accent)",
            },
            {
              key: "net",
              icon: Target,
              text: `${m.netWinners} net winners`,
              color: "var(--success-500)",
            },
          ] as const
        ).map((c) => {
          const Icon = c.icon;
          const emph =
            (lens === "fast" && c.key === "fast") ||
            (lens === "long" && c.key === "long") ||
            (lens === "attacking" && c.key === "fast");
          return (
            <span
              key={c.key}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[5px] text-xs text-[var(--text-secondary)]",
                emph
                  ? "border-[var(--border-strong)] bg-[var(--surface-3)]"
                  : "border-[var(--border-subtle)] bg-[var(--surface-2)]",
              )}
            >
              <Icon className="h-[13px] w-[13px]" style={{ color: c.color }} />
              {c.text}
            </span>
          );
        })}
        <div className="min-w-2 flex-1" />
        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-[var(--text-link)] group-hover:text-[var(--accent)]">
          Open full analysis
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </Link>
  );
}

export default function BwfPage() {
  const [view, setView] = useState<View>("home");
  const [disc, setDisc] = useState<"all" | Disc>("all");
  const [lens, setLens] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [dirMode, setDirMode] = useState<DirMode>("profiles");
  const [boardMetric, setBoardMetric] = useState<string>("fastestSmash");
  const [h2hA, setH2hA] = useState("axelsen");
  const [h2hB, setH2hB] = useState("antonsen");
  const [pickAOpen, setPickAOpen] = useState(false);
  const [pickBOpen, setPickBOpen] = useState(false);
  const [pickAQuery, setPickAQuery] = useState("");
  const [pickBQuery, setPickBQuery] = useState("");

  const recentMatches = useMemo(
    () =>
      [...MATCHES]
        .sort((a, b) => parseDate(b.date) - parseDate(a.date))
        .slice(0, 6),
    [],
  );

  const filteredMatches = useMemo(() => {
    let list = MATCHES.filter((m) => disc === "all" || m.disc === disc);
    if (lens === "comeback") list = list.filter((m) => m.comeback);
    if (lens === "close") list = list.filter((m) => m.threeGames);
    const sortFns: Record<string, (a: Match, b: Match) => number> = {
      all: (a, b) => parseDate(b.date) - parseDate(a.date),
      long: (a, b) => b.longest - a.longest,
      fast: (a, b) => b.fastestSmash - a.fastestSmash,
      marathon: (a, b) => b.dur - a.dur,
      attacking: (a, b) => b.attackPct - a.attackPct,
      comeback: (a, b) => parseDate(b.date) - parseDate(a.date),
      close: (a, b) => b.dur - a.dur,
    };
    return list.slice().sort(sortFns[lens] || sortFns.all);
  }, [disc, lens]);

  const topGroups = useMemo(
    () =>
      (["MS", "WS"] as Disc[]).map((code) => ({
        title: code === "MS" ? "Men's singles" : "Women's singles",
        players: PLAYERS.filter((p) => p.disc === code).sort(
          (a, b) => a.rank - b.rank,
        ),
      })),
    [],
  );

  const dirPlayers = useMemo(
    () => PLAYERS.filter((p) => disc === "all" || p.disc === disc),
    [disc],
  );

  const boardMetricDef =
    BOARD_METRICS.find((m) => m.key === boardMetric) || BOARD_METRICS[0];
  const boardRows = useMemo(() => {
    const max = Math.max(...dirPlayers.map((p) => boardMetricDef.get(p)), 1);
    return dirPlayers
      .slice()
      .sort((a, b) => boardMetricDef.get(b) - boardMetricDef.get(a))
      .map((p, i) => ({
        p,
        rank: i + 1,
        value: boardMetricDef.get(p),
        pct: (boardMetricDef.get(p) / max) * 100,
      }));
  }, [dirPlayers, boardMetricDef]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const players = PLAYERS.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.countryName.toLowerCase().includes(q) ||
        p.country.toLowerCase().includes(q),
    ).map((p) => ({
      kind: "Player" as const,
      icon: User,
      label: p.name,
      sub: `${p.countryName} · #${p.rank} ${p.disc}`,
      onClick: () => {
        setView("players");
        setPlayerId(p.id);
        setQuery("");
        setSearchFocused(false);
      },
    }));
    const matches = MATCHES.filter(
      (m) =>
        m.pa.name.toLowerCase().includes(q) ||
        m.pb.name.toLowerCase().includes(q) ||
        m.event.toLowerCase().includes(q),
    ).map((m) => ({
      kind: "Match" as const,
      icon: Trophy,
      label: `${m.pa.name} vs ${m.pb.name}`,
      sub: `${m.event} · ${m.round}`,
      onClick: () => {
        window.location.href = "/video-analysis";
      },
    }));
    return [...players, ...matches].slice(0, 8);
  }, [query]);

  const profile = playerId ? byId(playerId) : null;
  const pa = byId(h2hA);
  const pbCandidate = PLAYERS.find(
    (p) => p.id === h2hB && p.disc === pa.disc && p.id !== pa.id,
  );
  const pb =
    pbCandidate ||
    PLAYERS.find((p) => p.disc === pa.disc && p.id !== pa.id)!;
  const rec = h2hRecord(pa.id, pb.id);

  const h2hAOptions = PLAYERS.filter(
    (p) =>
      !pickAQuery.trim() ||
      p.name.toLowerCase().includes(pickAQuery.toLowerCase()) ||
      p.country.toLowerCase().includes(pickAQuery.toLowerCase()),
  );
  const h2hBOptions = PLAYERS.filter(
    (p) =>
      p.disc === pa.disc &&
      p.id !== pa.id &&
      (!pickBQuery.trim() ||
        p.name.toLowerCase().includes(pickBQuery.toLowerCase()) ||
        p.country.toLowerCase().includes(pickBQuery.toLowerCase())),
  );

  const lensNote =
    lens === "long"
      ? "Sorted by longest rally"
      : lens === "fast"
        ? "Sorted by peak smash speed"
        : lens === "marathon"
          ? "Sorted by match duration"
          : lens === "attacking"
            ? "Sorted by attack share"
            : lens === "comeback"
              ? "Only matches with a lost first game and a three-game win"
              : lens === "close"
                ? "Only three-game matches"
                : null;

  const openPlayer = (id: string) => {
    setView("players");
    setPlayerId(id);
  };

  return (
    <div className="min-h-screen bg-[var(--bg-base)] font-sans text-[var(--text-primary)] antialiased">
      <header className="sticky top-0 z-50 flex h-[60px] items-center gap-3.5 border-b border-[var(--border-subtle)] bg-[rgba(10,16,32,0.82)] px-6 backdrop-blur-[14px]">
        <Link
          href="/"
          aria-label="Back to Mintonix"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]"
        >
          <ArrowLeft className="h-[18px] w-[18px]" />
        </Link>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/assets/logomark.png"
          alt="Mintonix"
          className="block h-[22px] w-auto"
        />
        <div className="hidden items-center gap-2 font-mono text-xs text-[var(--text-muted)] sm:flex">
          <span>Mintonix</span>
          <ChevronRight className="h-[13px] w-[13px]" />
          <span className="text-[var(--text-secondary)]">
            BWF singles library
          </span>
        </div>
        <div className="flex-1" />

        <div className="relative w-[min(360px,40vw)]">
          <div className="flex h-9 items-center gap-2 rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] px-3">
            <Search className="h-[15px] w-[15px] shrink-0 text-[var(--text-faint)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
              placeholder="Search players, matches, tournaments…"
              className="min-w-0 flex-1 border-none bg-transparent text-[13px] text-[var(--text-strong)] outline-none placeholder:text-[var(--text-faint)]"
            />
            {query ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery("")}
                className="text-[var(--text-muted)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          {searchFocused && query.trim().length >= 1 ? (
            <div className="absolute left-0 right-0 top-11 z-60 max-h-96 overflow-y-auto rounded-xl border border-[var(--border-strong)] bg-[var(--surface-1)] p-1.5 shadow-[var(--shadow-xl)]">
              {searchResults.length ? (
                searchResults.map((r, i) => {
                  const Icon = r.icon;
                  return (
                    <button
                      key={i}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={r.onClick}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--surface-2)]"
                    >
                      <span className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--accent)]">
                        <Icon className="h-[15px] w-[15px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] text-[var(--text-strong)]">
                          {r.label}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[10.5px] text-[var(--text-muted)]">
                          {r.sub}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-wide text-[var(--text-faint)]">
                        {r.kind}
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="px-3 py-4 text-[13px] text-[var(--text-muted)]">
                  No players, matches, or tournaments match that search.
                </div>
              )}
            </div>
          ) : null}
        </div>

        <Tabs
          variant="pill"
          value={view}
          onChange={(v) => {
            setView(v as View);
            if (v !== "players") setPlayerId(null);
          }}
          items={[
            { value: "home", label: "Home" },
            { value: "matches", label: "Matches" },
            { value: "players", label: "Players" },
            { value: "h2h", label: "Head-to-Head" },
          ]}
        />
      </header>

      <div className="mx-auto max-w-[1320px] px-6 pb-0 pt-[26px]">
        {view === "home" && (
          <section>
            <div className="mb-5">
              <h1 className="font-display text-[28px] font-semibold tracking-[-0.025em] text-[var(--text-strong)]">
                Every singles match, analyzed.
              </h1>
              <p className="mt-[7px] max-w-[62ch] text-[14.5px] leading-[1.55] text-[var(--text-secondary)]">
                Every broadcast BWF singles match, run through the Mintonix
                engine. Browse the insight first — rallies, shot mix, and pace —
                then open any match to replay it stroke by stroke.
              </p>
            </div>

            <div className="mb-[22px] grid grid-cols-2 gap-px overflow-hidden rounded-[13px] border border-[var(--border-subtle)] bg-[var(--border-subtle)] sm:grid-cols-4">
              {[
                { label: "Tournaments", value: "186", unit: "BWF events" },
                { label: "Players profiled", value: "412", unit: "MS + WS" },
                {
                  label: "Matches covered",
                  value: "2,140",
                  unit: "broadcast feeds",
                },
                { label: "Frames analyzed", value: "184M", unit: "frames" },
              ].map((ls) => (
                <div
                  key={ls.label}
                  className="bg-[var(--surface-1)] px-[18px] py-4"
                >
                  <div className="font-mono text-[10px] uppercase tracking-[0.13em] text-[var(--text-faint)]">
                    {ls.label}
                  </div>
                  <div className="mt-[9px] flex items-baseline gap-1.5">
                    <span className="font-display text-[26px] font-semibold tracking-[-0.02em] tabular-nums text-[var(--text-strong)]">
                      {ls.value}
                    </span>
                    <span className="font-mono text-[11.5px] text-[var(--text-muted)]">
                      {ls.unit}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="mb-7">
              <div className="mb-3.5 flex items-baseline gap-2.5">
                <h2 className="font-display text-lg font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
                  Top players
                </h2>
                <span className="font-mono text-[11px] text-[var(--text-muted)]">
                  by world ranking
                </span>
              </div>
              <div className="grid gap-3.5 lg:grid-cols-2">
                {topGroups.map((g) => (
                  <div
                    key={g.title}
                    className="overflow-hidden rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-edge)]"
                  >
                    <div className="px-4 py-3 font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--accent)]">
                      {g.title}
                    </div>
                    <div className="max-h-[284px] overflow-y-auto">
                      {g.players.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => openPlayer(p.id)}
                          className="flex w-full items-center gap-3 border-t border-[var(--border-subtle)] px-4 py-[11px] text-left hover:bg-[var(--surface-2)]"
                        >
                          <span className="w-5 text-right font-mono text-xs tabular-nums text-[var(--text-faint)]">
                            {p.rank}
                          </span>
                          <Avatar name={p.name} size={34} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-display text-sm font-semibold text-[var(--text-strong)]">
                              {p.name}
                            </span>
                            <span className="mt-0.5 block font-mono text-[10.5px] text-[var(--text-muted)]">
                              {p.countryName}
                            </span>
                          </span>
                          <span className="flex shrink-0 flex-col items-end">
                            <span className="font-mono text-[13px] tabular-nums text-[var(--success-500)]">
                              {p.winRate}%
                            </span>
                            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
                              win rate
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mb-3.5 flex items-baseline gap-2.5">
              <h2 className="font-display text-lg font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
                Recent matches
              </h2>
              <span className="font-mono text-[11px] text-[var(--text-muted)]">
                newest first
              </span>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setView("matches")}
                className="inline-flex items-center gap-1.5 text-[13px] text-[var(--text-link)] hover:text-[var(--accent)]"
              >
                Browse all matches
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-4 pb-2 md:grid-cols-2 xl:grid-cols-3">
              {recentMatches.map((m) => (
                <MatchCard key={m.id} m={m} />
              ))}
            </div>
          </section>
        )}

        {view === "matches" && (
          <section>
            <div className="mb-5">
              <h1 className="font-display text-[28px] font-semibold tracking-[-0.025em] text-[var(--text-strong)]">
                Match library
              </h1>
              <p className="mt-[7px] max-w-[62ch] text-[14.5px] leading-[1.55] text-[var(--text-secondary)]">
                Every broadcast BWF singles match in one place. Filter by
                discipline or tournament, then open any match to replay it stroke
                by stroke.
              </p>
            </div>

            <div className="mb-[18px] flex flex-wrap items-center gap-3">
              <Tabs
                variant="pill"
                value={disc}
                onChange={(v) => setDisc(v as "all" | Disc)}
                items={[
                  { value: "all", label: "All" },
                  { value: "MS", label: "Men's singles" },
                  { value: "WS", label: "Women's singles" },
                ]}
              />
              <div className="flex-1" />
              <span className="font-mono text-xs text-[var(--text-muted)]">
                {filteredMatches.length} matches
              </span>
            </div>

            <div className="mb-[18px]">
              <div className="flex flex-wrap gap-2">
                {LENS.map((l) => {
                  const Icon = l.icon;
                  const on = lens === l.id;
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => setLens(l.id)}
                      className={cn(
                        "inline-flex h-[34px] items-center gap-1.5 rounded-full border px-[13px] text-[13px]",
                        on
                          ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text-strong)]"
                          : "border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]",
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-3.5 w-3.5",
                          on ? "text-[var(--accent)]" : "text-[var(--text-muted)]",
                        )}
                      />
                      {l.label}
                    </button>
                  );
                })}
              </div>
              {lensNote ? (
                <div className="mt-[11px] font-mono text-[11.5px] text-[var(--text-muted)]">
                  {lensNote}
                </div>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-4 pb-2 md:grid-cols-2 xl:grid-cols-3">
              {filteredMatches.map((m) => (
                <MatchCard key={m.id} m={m} lens={lens} />
              ))}
            </div>
          </section>
        )}

        {view === "players" && !profile && (
          <section>
            <div className="mb-5">
              <h1 className="font-display text-[28px] font-semibold tracking-[-0.025em] text-[var(--text-strong)]">
                Player profiles
              </h1>
              <p className="mt-[7px] max-w-[60ch] text-[14.5px] leading-[1.55] text-[var(--text-secondary)]">
                Every player&apos;s matches rolled up into one analytical profile
                — win rate, shot mix, court coverage, and form, all from the same
                engine that reads each match.
              </p>
            </div>

            <div className="mb-[18px] flex flex-wrap items-center gap-3">
              <Tabs
                variant="pill"
                value={disc}
                onChange={(v) => setDisc(v as "all" | Disc)}
                items={[
                  { value: "all", label: "All" },
                  { value: "MS", label: "Men's singles" },
                  { value: "WS", label: "Women's singles" },
                ]}
              />
              <Tabs
                variant="pill"
                value={dirMode}
                onChange={(v) => setDirMode(v as DirMode)}
                items={[
                  { value: "profiles", label: "Profiles" },
                  { value: "boards", label: "Leaderboards" },
                ]}
              />
              <div className="flex-1" />
              <span className="font-mono text-xs text-[var(--text-muted)]">
                {dirPlayers.length} players
              </span>
            </div>

            {dirMode === "profiles" ? (
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                {dirPlayers.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPlayerId(p.id)}
                    className="flex items-center gap-3.5 rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-[15px] text-left shadow-[var(--shadow-edge)] transition-[transform,border-color] hover:-translate-y-0.5 hover:border-[var(--border-strong)]"
                  >
                    <Avatar name={p.name} size={46} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-display text-[15px] font-semibold text-[var(--text-strong)]">
                        {p.name}
                      </div>
                      <div className="mt-[3px] flex items-center gap-[7px] font-mono text-[11px] text-[var(--text-muted)]">
                        <span>{p.countryName}</span>
                        <span className="h-[3px] w-[3px] rounded-full bg-[var(--text-faint)]" />
                        <span>
                          {p.disc} · #{p.rank}
                        </span>
                      </div>
                      <div className="mt-2.5 flex items-center gap-3.5">
                        <span className="inline-flex flex-col">
                          <span className="font-mono text-sm tabular-nums text-[var(--success-500)]">
                            {p.winRate}%
                          </span>
                          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
                            win rate
                          </span>
                        </span>
                        <span className="inline-flex flex-col">
                          <span className="font-mono text-sm tabular-nums text-[var(--text-strong)]">
                            {p.matches}
                          </span>
                          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
                            matches
                          </span>
                        </span>
                        <span className="inline-flex flex-col">
                          <span className="font-mono text-sm tabular-nums text-[var(--danger-500)]">
                            {p.fastestSmash}
                          </span>
                          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
                            top smash
                          </span>
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="h-[17px] w-[17px] shrink-0 text-[var(--text-muted)]" />
                  </button>
                ))}
              </div>
            ) : (
              <>
                <div className="mb-4">
                  <div className="flex flex-wrap gap-2">
                    {BOARD_METRICS.map((m) => {
                      const Icon = m.icon;
                      const on = boardMetric === m.key;
                      return (
                        <button
                          key={m.key}
                          type="button"
                          onClick={() => setBoardMetric(m.key)}
                          className={cn(
                            "inline-flex h-[34px] items-center gap-1.5 rounded-full border px-[13px] text-[13px]",
                            on
                              ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text-strong)]"
                              : "border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]",
                          )}
                        >
                          <Icon
                            className={cn(
                              "h-3.5 w-3.5",
                              on
                                ? "text-[var(--accent)]"
                                : "text-[var(--text-muted)]",
                            )}
                          />
                          {m.short}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-[11px] font-mono text-[11.5px] text-[var(--text-muted)]">
                    Ranked by {boardMetricDef.label.toLowerCase()} across the
                    profiled field
                  </div>
                </div>
                <div className="overflow-hidden rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-edge)]">
                  <div className="flex items-center gap-2.5 border-b border-[var(--border-subtle)] px-4 py-[13px]">
                    <span className="font-display text-[15px] font-semibold text-[var(--text-strong)]">
                      {boardMetricDef.label}
                    </span>
                    <div className="flex-1" />
                    <span className="font-mono text-[11px] text-[var(--text-muted)]">
                      {dirPlayers.length} ranked
                    </span>
                  </div>
                  {boardRows.map((r) => (
                    <button
                      key={r.p.id}
                      type="button"
                      onClick={() => setPlayerId(r.p.id)}
                      className="flex w-full items-center gap-[13px] border-t border-[var(--border-subtle)] px-4 py-[11px] text-left hover:bg-[var(--surface-2)]"
                    >
                      <span className="w-6 text-right font-mono text-xs tabular-nums text-[var(--text-faint)]">
                        {r.rank}
                      </span>
                      <Avatar name={r.p.name} size={34} />
                      <span className="w-[168px] shrink-0 min-w-0">
                        <span className="block truncate font-display text-sm font-semibold text-[var(--text-strong)]">
                          {r.p.name}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[10.5px] text-[var(--text-muted)]">
                          {r.p.countryName}
                        </span>
                      </span>
                      <span className="min-w-[60px] flex-1">
                        <span className="block h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
                          <span
                            className="block h-full rounded-full"
                            style={{
                              width: `${r.pct}%`,
                              background: boardMetricDef.color,
                            }}
                          />
                        </span>
                      </span>
                      <span className="w-24 shrink-0 text-right font-mono text-sm tabular-nums text-[var(--text-strong)]">
                        {r.value}
                        {boardMetricDef.unit}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        {view === "players" && profile && (
          <section>
            <button
              type="button"
              onClick={() => setPlayerId(null)}
              className="mb-[18px] inline-flex items-center gap-[7px] rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-[7px] text-[13px] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]"
            >
              <ArrowLeft className="h-[15px] w-[15px]" />
              All players
            </button>

            <div className="relative mb-4 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-[22px] shadow-[var(--shadow-edge)]">
              <div
                className="pointer-events-none absolute inset-0 opacity-80"
                style={{
                  background:
                    "radial-gradient(80% 130% at 0% 0%, rgba(54,147,255,0.10), transparent 55%)",
                }}
              />
              <div className="relative flex flex-wrap items-center gap-5">
                <Avatar name={profile.name} size={76} />
                <div className="min-w-[220px] flex-1">
                  <h1 className="font-display text-[27px] font-semibold tracking-[-0.025em] text-[var(--text-strong)]">
                    {profile.name}
                  </h1>
                  <div className="mt-2 flex flex-wrap items-center gap-[9px] font-mono text-xs text-[var(--text-secondary)]">
                    <span>{profile.countryName}</span>
                    <span className="text-[var(--text-faint)]">·</span>
                    <span>
                      {profile.disc === "MS"
                        ? "Men's singles"
                        : "Women's singles"}
                    </span>
                    <span className="text-[var(--text-faint)]">·</span>
                    <span>{profile.hand}</span>
                    <span className="text-[var(--text-faint)]">·</span>
                    <span>World #{profile.rank}</span>
                  </div>
                  <div className="mt-[11px]">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--accent-soft)] px-2.5 py-1 text-xs text-[var(--text-strong)]">
                      <Zap className="h-[13px] w-[13px] text-[var(--accent)]" />
                      {profile.style}
                    </span>
                  </div>
                </div>
                <div className="relative flex items-center gap-[22px]">
                  <div className="text-right">
                    <div className="font-display text-[30px] font-semibold tracking-[-0.02em] tabular-nums text-[var(--text-strong)]">
                      {profile.wins}–{profile.losses}
                    </div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
                      career W–L
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-display text-[30px] font-semibold tracking-[-0.02em] tabular-nums text-[var(--warning-400,#fcd34d)]">
                      {profile.titles}
                    </div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
                      titles
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {[
                {
                  k: "Win rate",
                  v: `${profile.winRate}%`,
                  c: "text-[var(--success-500)]",
                },
                { k: "Matches", v: String(profile.matches) },
                {
                  k: "Max smash",
                  v: `${profile.fastestSmash}`,
                  c: "text-[var(--danger-500)]",
                },
                {
                  k: "Attack %",
                  v: `${profile.attackPct}%`,
                  c: "text-[var(--accent)]",
                },
                { k: "Avg rally", v: String(profile.avgRally) },
              ].map((t) => (
                <div
                  key={t.k}
                  className="rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[var(--shadow-edge)]"
                >
                  <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
                    {t.k}
                  </div>
                  <div
                    className={cn(
                      "mt-2 font-display text-[26px] font-semibold tabular-nums text-[var(--text-strong)]",
                      t.c,
                    )}
                  >
                    {t.v}
                  </div>
                </div>
              ))}
            </div>

            <div className="mb-3.5 grid gap-3.5 lg:grid-cols-3">
              <div className="rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-4">
                <div className="mb-[15px] text-[13px] font-medium text-[var(--text-strong)]">
                  Shot type mix
                </div>
                <div className="space-y-2.5">
                  {profile.mix.map((s) => (
                    <div key={s.type} className="flex items-center gap-2.5">
                      <span
                        className="h-2 w-2 shrink-0 rounded-sm"
                        style={{
                          background: TYPE_COLORS[s.type] || "var(--accent)",
                        }}
                      />
                      <span className="w-14 font-mono text-[11px] text-[var(--text-muted)]">
                        {s.type}
                      </span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${s.pct}%`,
                            background: TYPE_COLORS[s.type] || "var(--accent)",
                          }}
                        />
                      </div>
                      <span className="w-8 text-right font-mono text-[11px] tabular-nums text-[var(--text-secondary)]">
                        {s.pct}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-4">
                <div className="mb-4 text-[13px] font-medium text-[var(--text-strong)]">
                  Rally length distribution
                </div>
                <div className="flex h-[120px] items-end gap-2">
                  {profile.dist.map((v, i) => {
                    const labels = ["1–4", "5–8", "9–12", "13–18", "19+"];
                    const max = Math.max(...profile.dist);
                    return (
                      <div
                        key={labels[i]}
                        className="flex flex-1 flex-col items-center gap-1.5"
                      >
                        <div
                          className="w-full rounded-t bg-[var(--accent)] opacity-80"
                          style={{ height: `${(v / max) * 90}px` }}
                        />
                        <span className="font-mono text-[9px] text-[var(--text-faint)]">
                          {labels[i]}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-4">
                <div className="mb-[15px] text-[13px] font-medium text-[var(--text-strong)]">
                  Tactical profile
                </div>
                <div className="space-y-3">
                  {[
                    {
                      k: "Attack rate",
                      v: profile.attackPct,
                      c: "var(--accent)",
                    },
                    {
                      k: "Cross-court",
                      v: profile.crossPct,
                      c: "var(--viz-5, #b07bff)",
                    },
                    {
                      k: "Forehand share",
                      v: profile.fhPct,
                      c: "var(--success-500)",
                    },
                    {
                      k: "Net winners",
                      v: profile.netWinPct,
                      c: "var(--cyan-500, #50deff)",
                    },
                  ].map((row) => (
                    <div key={row.k}>
                      <div className="mb-1 flex justify-between font-mono text-[11px]">
                        <span className="text-[var(--text-muted)]">{row.k}</span>
                        <span className="tabular-nums text-[var(--text-strong)]">
                          {row.v}%
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${row.v}%`, background: row.c }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mb-3.5 grid gap-3.5 lg:grid-cols-[0.9fr_1.1fr_1fr]">
              <div className="rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[13px] font-medium text-[var(--text-strong)]">
                    Court coverage
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
                    shot volume
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {profile.zones.map((z, i) => {
                    const max = Math.max(...profile.zones);
                    const opacity = 0.25 + (z / max) * 0.75;
                    return (
                      <div
                        key={i}
                        className="flex aspect-[4/3] items-center justify-center rounded-md border border-[var(--border-subtle)] font-mono text-[11px] tabular-nums text-[var(--text-strong)]"
                        style={{
                          background: `rgba(54,147,255,${opacity * 0.35})`,
                        }}
                      >
                        {z}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-4">
                <div className="mb-3.5 text-[13px] font-medium text-[var(--text-strong)]">
                  Recent form{" "}
                  <span className="font-mono text-[11px] font-normal text-[var(--text-muted)]">
                    — last 10
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {profile.form.map((f, i) => (
                    <span
                      key={i}
                      className={cn(
                        "inline-flex h-8 w-8 items-center justify-center rounded-lg font-mono text-xs font-semibold",
                        f === "W"
                          ? "bg-[rgba(45,212,167,0.16)] text-[var(--success-500)]"
                          : "bg-[rgba(244,81,92,0.14)] text-[var(--danger-500)]",
                      )}
                    >
                      {f}
                    </span>
                  ))}
                </div>
              </div>
              <div className="rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-4">
                <div className="mb-3.5 flex items-center justify-between">
                  <span className="text-[13px] font-medium text-[var(--text-strong)]">
                    Top rivalries
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setH2hA(profile.id);
                      const opp = PLAYERS.find(
                        (p) => p.disc === profile.disc && p.id !== profile.id,
                      );
                      if (opp) setH2hB(opp.id);
                      setView("h2h");
                      setPlayerId(null);
                    }}
                    className="text-xs text-[var(--text-link)] hover:text-[var(--accent)]"
                  >
                    Compare
                  </button>
                </div>
                <div className="space-y-2">
                  {PLAYERS.filter(
                    (p) => p.disc === profile.disc && p.id !== profile.id,
                  )
                    .slice(0, 4)
                    .map((opp) => {
                      const r = h2hRecord(profile.id, opp.id);
                      return (
                        <button
                          key={opp.id}
                          type="button"
                          onClick={() => {
                            setH2hA(profile.id);
                            setH2hB(opp.id);
                            setView("h2h");
                            setPlayerId(null);
                          }}
                          className="flex w-full items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2 text-left hover:border-[var(--border)]"
                        >
                          <span className="text-[13px] text-[var(--text-strong)]">
                            {opp.name}
                          </span>
                          <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                            {r.aWins}–{r.bWins}
                          </span>
                        </button>
                      );
                    })}
                </div>
              </div>
            </div>

            <div className="rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] px-[18px] py-4">
              <div className="mb-1 text-[13px] font-medium text-[var(--text-strong)]">
                Recent matches
              </div>
              <div className="mt-3 space-y-2">
                {MATCHES.filter(
                  (m) => m.a === profile.id || m.b === profile.id,
                )
                  .slice(0, 5)
                  .map((m) => {
                    const isA = m.a === profile.id;
                    const opp = isA ? m.pb : m.pa;
                    const won = (isA && m.w === "a") || (!isA && m.w === "b");
                    return (
                      <Link
                        key={m.id}
                        href="/video-analysis"
                        className="flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2.5 hover:border-[var(--border)]"
                      >
                        <span
                          className={cn(
                            "inline-flex h-6 w-6 items-center justify-center rounded-md font-mono text-[10px] font-semibold",
                            won
                              ? "bg-[rgba(45,212,167,0.16)] text-[var(--success-500)]"
                              : "bg-[rgba(244,81,92,0.14)] text-[var(--danger-500)]",
                          )}
                        >
                          {won ? "W" : "L"}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-strong)]">
                          vs {opp.name}
                        </span>
                        <span className="font-mono text-[11px] text-[var(--text-muted)]">
                          {m.event}
                        </span>
                        <span className="font-mono text-[11px] text-[var(--text-faint)]">
                          {m.date}
                        </span>
                      </Link>
                    );
                  })}
              </div>
            </div>
          </section>
        )}

        {view === "h2h" && (
          <section>
            <div className="mb-5">
              <h1 className="font-display text-[28px] font-semibold tracking-[-0.025em] text-[var(--text-strong)]">
                Head-to-Head
              </h1>
              <p className="mt-[7px] max-w-[60ch] text-[14.5px] leading-[1.55] text-[var(--text-secondary)]">
                Put two players side by side on the same metrics the engine pulls
                from every match — the record, the styles, and the gap between
                them.
              </p>
            </div>

            <div className="mb-4 grid grid-cols-1 items-center gap-4 md:grid-cols-[1fr_auto_1fr]">
              <div className="flex items-center gap-2.5">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: PA }}
                />
                <div className="relative min-w-0 flex-1">
                  {!pickAOpen ? (
                    <button
                      type="button"
                      onClick={() => {
                        setPickAOpen(true);
                        setPickAQuery("");
                      }}
                      className="flex h-[38px] w-full items-center gap-2.5 rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] px-3 text-left hover:border-[var(--border-strong)]"
                    >
                      <span className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--text-strong)]">
                        {pa.name}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-[var(--text-muted)]">
                        {pa.country} · #{pa.rank}
                      </span>
                      <ChevronsUpDown className="h-[15px] w-[15px] shrink-0 text-[var(--text-muted)]" />
                    </button>
                  ) : (
                    <div className="relative">
                      <div className="flex h-[38px] items-center gap-2 rounded-[9px] border border-[var(--player-a)] bg-[var(--surface-1)] px-3 shadow-[var(--ring)]">
                        <Search className="h-[15px] w-[15px] shrink-0 text-[var(--text-faint)]" />
                        <input
                          autoFocus
                          value={pickAQuery}
                          onChange={(e) => setPickAQuery(e.target.value)}
                          onBlur={() =>
                            setTimeout(() => setPickAOpen(false), 150)
                          }
                          placeholder="Search players…"
                          className="min-w-0 flex-1 border-none bg-transparent text-[13px] text-[var(--text-strong)] outline-none"
                        />
                      </div>
                      <div className="absolute left-0 right-0 top-11 z-60 max-h-[300px] overflow-y-auto rounded-[11px] border border-[var(--border-strong)] bg-[var(--surface-1)] p-1.5 shadow-[var(--shadow-xl)]">
                        {h2hAOptions.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setH2hA(p.id);
                              if (pb.disc !== p.disc || pb.id === p.id) {
                                const opp = PLAYERS.find(
                                  (x) => x.disc === p.disc && x.id !== p.id,
                                );
                                if (opp) setH2hB(opp.id);
                              }
                              setPickAOpen(false);
                            }}
                            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--surface-2)]"
                          >
                            <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-strong)]">
                              {p.name}
                            </span>
                            <span className="shrink-0 font-mono text-[10.5px] text-[var(--text-muted)]">
                              {p.country} · {p.disc} #{p.rank}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <span className="text-center font-mono text-[13px] text-[var(--text-faint)]">
                vs
              </span>
              <div className="flex items-center gap-2.5">
                <div className="relative min-w-0 flex-1">
                  {!pickBOpen ? (
                    <button
                      type="button"
                      onClick={() => {
                        setPickBOpen(true);
                        setPickBQuery("");
                      }}
                      className="flex h-[38px] w-full items-center gap-2.5 rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] px-3 text-left hover:border-[var(--border-strong)]"
                    >
                      <span className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--text-strong)]">
                        {pb.name}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-[var(--text-muted)]">
                        {pb.country} · #{pb.rank}
                      </span>
                      <ChevronsUpDown className="h-[15px] w-[15px] shrink-0 text-[var(--text-muted)]" />
                    </button>
                  ) : (
                    <div className="relative">
                      <div
                        className="flex h-[38px] items-center gap-2 rounded-[9px] border bg-[var(--surface-1)] px-3"
                        style={{
                          borderColor: PB,
                          boxShadow: "0 0 0 3px rgba(251,191,36,0.22)",
                        }}
                      >
                        <Search className="h-[15px] w-[15px] shrink-0 text-[var(--text-faint)]" />
                        <input
                          autoFocus
                          value={pickBQuery}
                          onChange={(e) => setPickBQuery(e.target.value)}
                          onBlur={() =>
                            setTimeout(() => setPickBOpen(false), 150)
                          }
                          placeholder="Search players…"
                          className="min-w-0 flex-1 border-none bg-transparent text-[13px] text-[var(--text-strong)] outline-none"
                        />
                      </div>
                      <div className="absolute left-0 right-0 top-11 z-60 max-h-[300px] overflow-y-auto rounded-[11px] border border-[var(--border-strong)] bg-[var(--surface-1)] p-1.5 shadow-[var(--shadow-xl)]">
                        {h2hBOptions.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setH2hB(p.id);
                              setPickBOpen(false);
                            }}
                            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--surface-2)]"
                          >
                            <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-strong)]">
                              {p.name}
                            </span>
                            <span className="shrink-0 font-mono text-[10.5px] text-[var(--text-muted)]">
                              {p.country} · {p.disc} #{p.rank}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: PB }}
                />
              </div>
            </div>

            <div className="mb-3.5 grid gap-3.5 md:grid-cols-2">
              <div className="relative overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-[22px] shadow-[var(--shadow-edge)]">
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <div className="text-center">
                    <div
                      className="mx-auto mb-2.5 flex h-[52px] w-[52px] items-center justify-center rounded-full font-display text-lg font-semibold text-[#0a1426]"
                      style={{ background: PA }}
                    >
                      {pa.name
                        .split(" ")
                        .map((s) => s[0])
                        .slice(0, 2)
                        .join("")}
                    </div>
                    <div className="font-display text-sm font-semibold text-[var(--text-strong)]">
                      {pa.name}
                    </div>
                    <div className="mt-1 font-mono text-[10.5px] text-[var(--text-muted)]">
                      {pa.style
                        .replace("All-court aggressor", "All-court")
                        .replace("Defensive counter-puncher", "Counter-puncher")
                        .replace("Balanced all-court", "Balanced")}{" "}
                      · {pa.hand.toLowerCase().startsWith("left") ? "LH" : "RH"}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
                      Career H2H
                    </div>
                    <div className="mt-1 font-display text-[32px] font-semibold tabular-nums text-[var(--text-strong)]">
                      {rec.aWins}–{rec.bWins}
                    </div>
                    <div className="mt-1 font-mono text-[10.5px] text-[var(--text-muted)]">
                      {rec.n} meetings
                    </div>
                  </div>
                  <div className="text-center">
                    <div
                      className="mx-auto mb-2.5 flex h-[52px] w-[52px] items-center justify-center rounded-full font-display text-lg font-semibold text-[#0a1426]"
                      style={{ background: PB }}
                    >
                      {pb.name
                        .split(" ")
                        .map((s) => s[0])
                        .slice(0, 2)
                        .join("")}
                    </div>
                    <div className="font-display text-sm font-semibold text-[var(--text-strong)]">
                      {pb.name}
                    </div>
                    <div className="mt-1 font-mono text-[10.5px] text-[var(--text-muted)]">
                      {pb.style
                        .replace("All-court aggressor", "All-court")
                        .replace("Defensive counter-puncher", "Counter-puncher")
                        .replace("Balanced all-court", "Balanced")}{" "}
                      · {pb.hand.toLowerCase().startsWith("left") ? "LH" : "RH"}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] px-[18px] py-4">
                <div className="mb-2.5">
                  <div className="text-[13px] font-medium text-[var(--text-strong)]">
                    Meeting history
                  </div>
                  <div className="mt-[3px] font-mono text-[10.5px] text-[var(--text-muted)]">
                    Last {Math.min(rec.n, 5)} of {rec.n} meetings
                  </div>
                </div>
                <div className="space-y-2">
                  {Array.from({ length: Math.min(rec.n, 5) }).map((_, i) => {
                    const events = [
                      "All England Open",
                      "World Championships",
                      "World Tour Finals",
                      "China Open",
                      "Japan Open",
                    ];
                    const rounds = [
                      "Final",
                      "Semifinal",
                      "Quarterfinal",
                      "Final",
                      "Semifinal",
                    ];
                    const years = ["2025", "2025", "2024", "2024", "2023"];
                    const aWon = i < rec.aWins;
                    return (
                      <div
                        key={i}
                        className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2"
                      >
                        <span
                          className={cn(
                            "inline-flex h-6 w-6 items-center justify-center rounded-md font-mono text-[10px] font-semibold",
                            aWon
                              ? "bg-[rgba(54,147,255,0.16)] text-[var(--player-a)]"
                              : "bg-[rgba(251,191,36,0.16)] text-[#d99a1a]",
                          )}
                        >
                          {aWon ? "A" : "B"}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--text-strong)]">
                          {events[i % events.length]} · {rounds[i % rounds.length]}
                        </span>
                        <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
                          {years[i % years.length]}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mb-3.5 rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] px-5 py-[18px]">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-[13px] font-medium text-[var(--text-strong)]">
                  Shot selection
                </span>
                <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
                  share of shots played
                </span>
              </div>
              <div className="space-y-3">
                {["Smash", "Clear", "Drop", "Net", "Drive", "Lift"].map(
                  (type) => {
                    const aPct =
                      pa.mix.find((m) => m.type === type)?.pct ?? 0;
                    const bPct =
                      pb.mix.find((m) => m.type === type)?.pct ?? 0;
                    const max = Math.max(aPct, bPct, 1);
                    return (
                      <div
                        key={type}
                        className="grid grid-cols-[64px_1fr_56px_1fr_64px] items-center gap-2"
                      >
                        <span className="text-right font-mono text-xs tabular-nums text-[var(--player-a)]">
                          {aPct}%
                        </span>
                        <div className="flex h-2 justify-end overflow-hidden rounded-full bg-[var(--surface-3)]">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${(aPct / max) * 100}%`,
                              background: PA,
                            }}
                          />
                        </div>
                        <span className="text-center font-mono text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
                          {type}
                        </span>
                        <div className="flex h-2 justify-start overflow-hidden rounded-full bg-[var(--surface-3)]">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${(bPct / max) * 100}%`,
                              background: PB,
                            }}
                          />
                        </div>
                        <span className="font-mono text-xs tabular-nums text-[#d99a1a]">
                          {bPct}%
                        </span>
                      </div>
                    );
                  },
                )}
              </div>
            </div>

            <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] px-5 py-[18px]">
              <div className="mb-[18px] flex items-center justify-between">
                <span className="text-[13px] font-medium text-[var(--text-strong)]">
                  Stat comparison
                </span>
                <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
                  career averages
                </span>
              </div>
              <div className="space-y-3">
                {[
                  { k: "Win rate", a: pa.winRate, b: pb.winRate, unit: "%" },
                  {
                    k: "Fastest smash",
                    a: pa.fastestSmash,
                    b: pb.fastestSmash,
                    unit: " km/h",
                  },
                  {
                    k: "Attack rate",
                    a: pa.attackPct,
                    b: pb.attackPct,
                    unit: "%",
                  },
                  { k: "Avg rally", a: pa.avgRally, b: pb.avgRally, unit: "" },
                  {
                    k: "Net winners",
                    a: pa.netWinPct,
                    b: pb.netWinPct,
                    unit: "%",
                  },
                  {
                    k: "Court speed",
                    a: pa.movementSpeed,
                    b: pb.movementSpeed,
                    unit: " km/h",
                  },
                ].map((m) => {
                  const aHi = m.a >= m.b;
                  const max = Math.max(m.a, m.b, 1);
                  return (
                    <div
                      key={m.k}
                      className="grid grid-cols-[72px_1fr_100px_1fr_72px] items-center gap-2"
                    >
                      <span
                        className={cn(
                          "text-right font-mono text-sm tabular-nums",
                          aHi
                            ? "font-semibold text-[var(--player-a)]"
                            : "text-[var(--text-secondary)]",
                        )}
                      >
                        {m.a}
                        {m.unit}
                      </span>
                      <div className="flex h-2 justify-end overflow-hidden rounded-full bg-[var(--surface-3)]">
                        <div
                          className="h-full rounded-full bg-[var(--player-a)]"
                          style={{
                            width: `${(m.a / max) * 100}%`,
                            opacity: aHi ? 1 : 0.5,
                          }}
                        />
                      </div>
                      <span className="text-center font-mono text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
                        {m.k}
                      </span>
                      <div className="flex h-2 justify-start overflow-hidden rounded-full bg-[var(--surface-3)]">
                        <div
                          className="h-full rounded-full bg-[var(--player-b)]"
                          style={{
                            width: `${(m.b / max) * 100}%`,
                            opacity: !aHi ? 1 : 0.5,
                          }}
                        />
                      </div>
                      <span
                        className={cn(
                          "font-mono text-sm tabular-nums",
                          !aHi
                            ? "font-semibold text-[#d99a1a]"
                            : "text-[var(--text-secondary)]",
                        )}
                      >
                        {m.b}
                        {m.unit}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        <footer className="mt-14 border-t border-[var(--border-subtle)] pb-10 pt-[26px]">
          <div className="mb-[18px] flex items-start gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] px-[18px] py-4">
            <ShieldAlert className="mt-0.5 h-[17px] w-[17px] shrink-0 text-[var(--text-muted)]" />
            <div>
              <div className="mb-[5px] text-[13px] font-medium text-[var(--text-strong)]">
                Not affiliated with the Badminton World Federation
              </div>
              <p className="m-0 max-w-[96ch] text-[12.5px] leading-[1.6] text-[var(--text-muted)]">
                Mintonix is an independent project and is not affiliated with,
                endorsed by, sponsored by, or in any way officially connected to
                the Badminton World Federation (BWF) or any of its events.
                &quot;BWF&quot;, &quot;BWF World Tour&quot;, event names, and all
                associated marks are the property of their respective owners and
                are used here for identification and descriptive purposes only.
                Player names are used factually to identify public sporting
                figures. All statistics, charts, and insights shown are
                illustrative demonstrations of the Mintonix analysis engine and
                do not represent official records or real match data.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <span className="font-mono text-[11.5px] text-[var(--text-faint)]">
              © 2026 Mintonix · Independent badminton analytics
            </span>
            <div className="flex-1" />
            <div className="flex gap-[22px]">
              <span className="text-xs text-[var(--text-muted)]">
                Data sources
              </span>
              <span className="text-xs text-[var(--text-muted)]">
                Trademark notice
              </span>
              <Link
                href="/terms"
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              >
                Terms
              </Link>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
