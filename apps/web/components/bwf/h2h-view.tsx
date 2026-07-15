"use client";

import { useRouter } from "next/navigation";
import { ChevronsUpDown, Search } from "lucide-react";
import { useState } from "react";
import { byId, h2hRecord, PLAYERS } from "@/lib/bwf/data";
import { PA, PB } from "@/lib/bwf/types";
import { cn } from "@/lib/utils";

function shortStyle(style: string) {
  return style
    .replace("All-court aggressor", "All-court")
    .replace("Defensive counter-puncher", "Counter-puncher")
    .replace("Balanced all-court", "Balanced");
}

export function H2hView({
  initialA = "axelsen",
  initialB = "antonsen",
}: {
  initialA?: string;
  initialB?: string;
}) {
  const router = useRouter();
  const [h2hA, setH2hA] = useState(
    PLAYERS.some((p) => p.id === initialA) ? initialA : "axelsen",
  );
  const [h2hB, setH2hB] = useState(
    PLAYERS.some((p) => p.id === initialB) ? initialB : "antonsen",
  );
  const [pickAOpen, setPickAOpen] = useState(false);
  const [pickBOpen, setPickBOpen] = useState(false);
  const [pickAQuery, setPickAQuery] = useState("");
  const [pickBQuery, setPickBQuery] = useState("");

  const syncUrl = (a: string, b: string) => {
    router.replace(`/bwf/h2h?a=${a}&b=${b}`, { scroll: false });
  };

  const pa = byId(h2hA) ?? PLAYERS[0];
  if (!pa) return null;
  const pbCandidate = PLAYERS.find(
    (p) => p.id === h2hB && p.disc === pa.disc && p.id !== pa.id,
  );
  const pb =
    pbCandidate ||
    PLAYERS.find((p) => p.disc === pa.disc && p.id !== pa.id);
  if (!pb) return null;
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

  return (
    <section>
      <div className="mb-5">
        <h1 className="font-display text-[28px] font-semibold tracking-[-0.025em] text-[var(--text-strong)]">
          Head-to-Head
        </h1>
        <p className="mt-[7px] max-w-[60ch] text-[14.5px] leading-[1.55] text-[var(--text-secondary)]">
          Put two players side by side on the same metrics the engine pulls from
          every match — the record, the styles, and the gap between them.
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
                    onBlur={() => setTimeout(() => setPickAOpen(false), 150)}
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
                        let nextB = h2hB;
                        if (pb.disc !== p.disc || pb.id === p.id) {
                          const opp = PLAYERS.find(
                            (x) => x.disc === p.disc && x.id !== p.id,
                          );
                          if (opp) {
                            setH2hB(opp.id);
                            nextB = opp.id;
                          }
                        }
                        syncUrl(p.id, nextB);
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
                    onBlur={() => setTimeout(() => setPickBOpen(false), 150)}
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
                        syncUrl(h2hA, p.id);
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
                {shortStyle(pa.style)} ·{" "}
                {pa.hand.toLowerCase().startsWith("left") ? "LH" : "RH"}
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
                {shortStyle(pb.style)} ·{" "}
                {pb.hand.toLowerCase().startsWith("left") ? "LH" : "RH"}
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
          {["Smash", "Clear", "Drop", "Net", "Drive", "Lift"].map((type) => {
            const aPct = pa.mix.find((m) => m.type === type)?.pct ?? 0;
            const bPct = pb.mix.find((m) => m.type === type)?.pct ?? 0;
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
          })}
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
  );
}
