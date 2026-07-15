"use client";

import { ArrowLeftRight, Award, ChevronUp } from "lucide-react";
import { useMemo, useState } from "react";
import { AppTopbar } from "@/components/app/app-topbar";
import { Avatar } from "@/components/ui/avatar";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Player = {
  name: string;
  record: string;
  winRate: number;
  rally: number;
  smash: number;
  net: number;
  attack: number;
  errors: number;
  mix: [number, number, number, number];
};

const PLAYERS: Record<string, Player> = {
  viktor: {
    name: "Viktor Koster",
    record: "24–9",
    winRate: 66,
    rally: 9.4,
    smash: 372,
    net: 71,
    attack: 58,
    errors: 7,
    mix: [24, 16, 15, 14],
  },
  momota: {
    name: "Kento Momota",
    record: "31–6",
    winRate: 71,
    rally: 11.2,
    smash: 348,
    net: 74,
    attack: 49,
    errors: 6,
    mix: [29, 14, 11, 12],
  },
  axelsen: {
    name: "Viktor Axelsen",
    record: "29–7",
    winRate: 69,
    rally: 8.6,
    smash: 388,
    net: 66,
    attack: 64,
    errors: 9,
    mix: [21, 17, 22, 10],
  },
  ansy: {
    name: "An Se-young",
    record: "33–4",
    winRate: 78,
    rally: 10.4,
    smash: 332,
    net: 76,
    attack: 55,
    errors: 5,
    mix: [26, 18, 12, 15],
  },
  ginting: {
    name: "Anthony Ginting",
    record: "22–12",
    winRate: 61,
    rally: 8.1,
    smash: 369,
    net: 63,
    attack: 67,
    errors: 11,
    mix: [19, 15, 25, 13],
  },
  sindhu: {
    name: "P.V. Sindhu",
    record: "20–13",
    winRate: 58,
    rally: 9.7,
    smash: 351,
    net: 60,
    attack: 61,
    errors: 12,
    mix: [23, 16, 19, 11],
  },
};

const METRICS = [
  {
    key: "winRate" as const,
    label: "Win rate",
    unit: "%",
    hint: "higher is better",
    dir: "hi" as const,
  },
  {
    key: "rally" as const,
    label: "Avg rally length",
    unit: "",
    hint: "patience index",
    dir: "hi" as const,
  },
  {
    key: "smash" as const,
    label: "Top smash",
    unit: " km/h",
    hint: "peak shuttle speed",
    dir: "hi" as const,
  },
  {
    key: "net" as const,
    label: "Net points won",
    unit: "%",
    hint: "forecourt control",
    dir: "hi" as const,
  },
  {
    key: "attack" as const,
    label: "Attacking share",
    unit: "%",
    hint: "aggression",
    dir: "hi" as const,
  },
  {
    key: "errors" as const,
    label: "Unforced errors",
    unit: " /match",
    hint: "lower is better",
    dir: "lo" as const,
  },
];

const SHOT_TYPES = [
  { t: "Clear", c: "var(--viz-1, #3693ff)" },
  { t: "Drop", c: "var(--viz-2, #50deff)" },
  { t: "Smash", c: "var(--viz-6, #f4515c)" },
  { t: "Net", c: "var(--viz-3, #2dd4a7)" },
];

const ROSTER = Object.keys(PLAYERS).map((id) => ({
  value: id,
  label: PLAYERS[id].name,
}));

export function CompareApp() {
  const [aId, setAId] = useState("viktor");
  const [bId, setBId] = useState("momota");

  const A = PLAYERS[aId];
  const B = PLAYERS[bId];

  const metrics = useMemo(
    () =>
      METRICS.map((m) => {
        const av = A[m.key];
        const bv = B[m.key];
        const aLeads = m.dir === "hi" ? av > bv : av < bv;
        const bLeads = m.dir === "hi" ? bv > av : bv < av;
        return {
          label: m.label,
          hint: m.hint,
          aVal: `${av}${m.unit}`,
          bVal: `${bv}${m.unit}`,
          aLeads,
          bLeads,
          cmp: { a: av, b: bv },
        };
      }),
    [A, B],
  );

  const aLeadCount = metrics.filter((m) => m.aLeads).length;
  const bLeadCount = metrics.filter((m) => m.bLeads).length;
  const verdictWinner =
    aLeadCount === bLeadCount ? null : aLeadCount > bLeadCount ? A : B;
  const verdict = verdictWinner
    ? `${verdictWinner.name} leads ${Math.max(aLeadCount, bLeadCount)} of ${metrics.length} tracked metrics — strongest edge on ${aLeadCount > bLeadCount ? "win rate & control" : "pace & attack"}.`
    : `Dead even — ${A.name} and ${B.name} split the tracked metrics ${aLeadCount}–${bLeadCount}.`;

  const meetings = 5;
  const aWins = Math.max(
    0,
    Math.min(
      meetings,
      Math.round((meetings * A.winRate) / (A.winRate + B.winRate)),
    ),
  );
  const bWins = meetings - aWins;
  const aPct = Math.round((aWins / meetings) * 100);
  const bPct = 100 - aPct;

  const lastMeetings = [
    {
      ev: "All England · Final",
      score: "21–18, 21–16",
      aWon: A.winRate >= B.winRate,
    },
    {
      ev: "Indonesia Open · SF",
      score: "19–21, 21–17, 21–15",
      aWon: A.attack >= B.attack,
    },
    {
      ev: "Asia Champ. · QF",
      score: "21–14, 18–21, 21–19",
      aWon: A.smash >= B.smash,
    },
    {
      ev: "World Tour Finals · RR",
      score: "21–23, 21–18, 19–21",
      aWon: A.net >= B.net,
    },
    {
      ev: "Malaysia Masters · R16",
      score: "21–12, 21–19",
      aWon: A.winRate >= B.winRate,
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <AppTopbar
        title="Compare"
        subtitle={`Head-to-head · ${METRICS.length} metrics tracked`}
        showSearch={false}
        showBell={false}
        showAccount={false}
        actions={
          <button
            type="button"
            onClick={() => {
              setAId(bId);
              setBId(aId);
            }}
            className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface-1)] px-3.5 text-[13px] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]"
          >
            <ArrowLeftRight className="h-[15px] w-[15px]" />
            Swap
          </button>
        }
      />

      <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-5 px-7 pt-6 pb-11">
        {/* Player headers */}
        <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-[1fr_auto_1fr]">
          <div className="relative rounded-[13px] border border-[var(--border)] border-l-[3px] border-l-[var(--player-a)] bg-[var(--surface-1)] p-[18px] shadow-[var(--shadow-edge)]">
            <div className="flex items-center gap-3.5">
              <Avatar name={A.name} size={56} ring />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[10px] tracking-[0.14em] text-[var(--player-a)] uppercase">
                  Player A
                </div>
                <div className="mt-0.5 truncate font-display text-[19px] font-semibold tracking-[-0.01em] text-[var(--text-strong)]">
                  {A.name}
                </div>
                <div className="mt-0.5 font-mono text-[11.5px] text-[var(--text-muted)]">
                  {A.record} · win rate {A.winRate}%
                </div>
              </div>
            </div>
            <div className="mt-3.5">
              <Select
                size="sm"
                value={aId}
                onChange={(e) => setAId(e.target.value)}
                options={ROSTER}
              />
            </div>
          </div>

          <div className="hidden flex-col items-center justify-center gap-2 px-1 md:flex">
            <span className="font-display text-[13px] font-semibold tracking-[0.1em] text-[var(--text-faint)]">
              VS
            </span>
            <div className="min-h-10 w-px flex-1 bg-[linear-gradient(180deg,var(--player-a),var(--player-b))] opacity-50" />
          </div>

          <div className="relative rounded-[13px] border border-[var(--border)] border-r-[3px] border-r-[var(--player-b)] bg-[var(--surface-1)] p-[18px] text-right shadow-[var(--shadow-edge)]">
            <div className="flex flex-row-reverse items-center gap-3.5">
              <Avatar name={B.name} size={56} />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[10px] tracking-[0.14em] text-[var(--player-b)] uppercase">
                  Player B
                </div>
                <div className="mt-0.5 truncate font-display text-[19px] font-semibold tracking-[-0.01em] text-[var(--text-strong)]">
                  {B.name}
                </div>
                <div className="mt-0.5 font-mono text-[11.5px] text-[var(--text-muted)]">
                  {B.record} · win rate {B.winRate}%
                </div>
              </div>
            </div>
            <div className="mt-3.5">
              <Select
                size="sm"
                value={bId}
                onChange={(e) => setBId(e.target.value)}
                options={ROSTER}
              />
            </div>
          </div>
        </div>

        {/* Verdict */}
        <div className="flex items-center gap-3 rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] px-[18px] py-3.5">
          <span className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-[var(--accent-soft)] text-[var(--accent)]">
            <Award className="h-[18px] w-[18px]" />
          </span>
          <div className="text-sm text-[var(--text-primary)]">{verdict}</div>
        </div>

        {/* Metric compare */}
        <section className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] px-[18px] pt-1.5 pb-[18px] shadow-[var(--shadow-edge)]">
          {metrics.map((m) => (
            <div
              key={m.label}
              className="border-b border-[var(--border-subtle)] py-4 last:border-b-0"
            >
              <div className="mb-2.5 flex items-center gap-3">
                <span className="flex flex-1 items-center justify-end gap-2 font-mono text-base font-semibold tabular-nums text-[var(--player-a)]">
                  {m.aLeads ? <ChevronUp className="h-3.5 w-3.5" /> : null}
                  {m.aVal}
                </span>
                <span className="min-w-[200px] shrink-0 text-center text-[12.5px] text-[var(--text-secondary)]">
                  {m.label}
                  <span className="mt-px block font-mono text-[10px] text-[var(--text-faint)]">
                    {m.hint}
                  </span>
                </span>
                <span className="flex flex-1 items-center gap-2 font-mono text-base font-semibold tabular-nums text-[var(--player-b)]">
                  {m.bVal}
                  {m.bLeads ? <ChevronUp className="h-3.5 w-3.5" /> : null}
                </span>
              </div>
              <ProgressBar compare={m.cmp} size="md" />
            </div>
          ))}
        </section>

        {/* Series + shot mix */}
        <div className="grid gap-[18px] lg:grid-cols-2">
          <section className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-[18px] shadow-[var(--shadow-edge)]">
            <div className="mb-1 font-display text-[15px] font-semibold text-[var(--text-strong)]">
              Season series
            </div>
            <div className="mb-4 text-[12.5px] text-[var(--text-secondary)]">
              {meetings} tracked meetings this season.
            </div>
            <div className="mb-3.5 flex items-baseline justify-center gap-[18px]">
              <span className="font-display text-[40px] font-semibold tracking-[-0.02em] tabular-nums text-[var(--player-a)]">
                {aWins}
              </span>
              <span className="font-mono text-[13px] text-[var(--text-faint)]">
                —
              </span>
              <span className="font-display text-[40px] font-semibold tracking-[-0.02em] tabular-nums text-[var(--player-b)]">
                {bWins}
              </span>
            </div>
            <div className="mb-4 flex h-2 overflow-hidden rounded-full bg-[var(--surface-3)]">
              <div
                className="bg-[var(--player-a)]"
                style={{ width: `${aPct}%` }}
              />
              <div
                className="bg-[var(--player-b)]"
                style={{ width: `${bPct}%` }}
              />
            </div>
            <div className="mb-2.5 font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)] uppercase">
              Last meetings
            </div>
            <div className="flex flex-col gap-1.5">
              {lastMeetings.map((r) => (
                <div
                  key={r.ev}
                  className="flex items-center gap-[11px] rounded-[9px] border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2.5 py-2"
                >
                  <span
                    className={cn(
                      "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] font-mono text-[10px] font-semibold text-[#0a1426]",
                      r.aWon ? "bg-[var(--player-a)]" : "bg-[var(--player-b)]",
                    )}
                  >
                    {r.aWon ? "A" : "B"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--text-secondary)]">
                    {r.ev}
                  </span>
                  <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                    {r.score}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-[18px] shadow-[var(--shadow-edge)]">
            <div className="mb-4 font-display text-[15px] font-semibold text-[var(--text-strong)]">
              Shot mix — who plays what
            </div>
            <div className="flex flex-col gap-4">
              {SHOT_TYPES.map((ty, i) => (
                <div key={ty.t}>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="w-10 font-mono text-[11.5px] tabular-nums text-[var(--player-a)]">
                      {A.mix[i]}%
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-[var(--text-secondary)]">
                      <span
                        className="h-2 w-2 rounded-sm"
                        style={{ background: ty.c }}
                      />
                      {ty.t}
                    </span>
                    <span className="w-10 text-right font-mono text-[11.5px] tabular-nums text-[var(--player-b)]">
                      {B.mix[i]}%
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="flex h-2 flex-1 justify-end overflow-hidden rounded-full bg-[var(--surface-3)]">
                      <div
                        className="h-full rounded-full bg-[var(--player-a)]"
                        style={{ width: `${(A.mix[i] / 30) * 100}%` }}
                      />
                    </div>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
                      <div
                        className="h-full rounded-full bg-[var(--player-b)]"
                        style={{ width: `${(B.mix[i] / 30) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
