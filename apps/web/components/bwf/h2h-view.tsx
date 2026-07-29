"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, Search } from "lucide-react";
import { useMemo, useState } from "react";
import {
  displayDate,
  formatScoreLine,
  formatTeam,
  playerWon,
} from "@/lib/bwf/data";
import {
  PA,
  PB,
  type CatalogMatch,
  type CatalogPlayer,
  type H2hPickerPlayer,
} from "@/lib/bwf/types";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";

export function H2hView({
  players,
  initialA,
  initialB,
  meetings,
  aWins,
  bWins,
  a,
  b,
}: {
  /** Slim options for the picker only. */
  players: H2hPickerPlayer[];
  initialA: string;
  initialB: string;
  meetings: CatalogMatch[];
  aWins: number;
  bWins: number;
  a: CatalogPlayer | null;
  b: CatalogPlayer | null;
}) {
  const router = useRouter();
  const [h2hA, setH2hA] = useState(initialA);
  const [h2hB, setH2hB] = useState(initialB);
  const [pickAOpen, setPickAOpen] = useState(false);
  const [pickBOpen, setPickBOpen] = useState(false);
  const [pickAQuery, setPickAQuery] = useState("");
  const [pickBQuery, setPickBQuery] = useState("");

  const pickerA = players.find((p) => p.id === h2hA) ?? players[0] ?? null;
  const pickerB = players.find((p) => p.id === h2hB) ?? null;
  const pa = a ?? (pickerA
    ? {
        id: pickerA.id,
        name: pickerA.name,
        disc: pickerA.disc,
        discs: pickerA.disc ? [pickerA.disc] : [],
        matches: pickerA.matches,
        wins: 0,
        losses: 0,
        winRate: 0,
        threeGames: 0,
        withVideo: 0,
        form: [],
        rivals: [],
        recentMatchIds: [],
        imageUrl: null,
      }
    : null);
  const pb = b ?? (pickerB
    ? {
        id: pickerB.id,
        name: pickerB.name,
        disc: pickerB.disc,
        discs: pickerB.disc ? [pickerB.disc] : [],
        matches: pickerB.matches,
        wins: 0,
        losses: 0,
        winRate: 0,
        threeGames: 0,
        withVideo: 0,
        form: [],
        rivals: [],
        recentMatchIds: [],
        imageUrl: null,
      }
    : null);

  const syncUrl = (aid: string, bid: string) => {
    router.replace(`/bwf/h2h?a=${aid}&b=${bid}`, { scroll: false });
  };

  const h2hAOptions = useMemo(() => {
    const q = pickAQuery.trim().toLowerCase();
    return players
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .slice(0, 40);
  }, [players, pickAQuery]);

  const h2hBOptions = useMemo(() => {
    const q = pickBQuery.trim().toLowerCase();
    return players
      .filter((p) => p.id !== h2hA)
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .slice(0, 40);
  }, [players, pickBQuery, h2hA]);

  if (!pa) {
    return (
      <section className="rounded-[14px] border border-dashed border-[var(--border)] px-6 py-16 text-center text-[13px] text-[var(--text-muted)]">
        No players in the catalog yet.
      </section>
    );
  }

  const n = meetings.length;

  return (
    <section>
      <div className="mb-5">
        <h1 className="font-display text-[28px] font-semibold tracking-[-0.025em] text-[var(--text-strong)]">
          Head-to-Head
        </h1>
        <p className="mt-[7px] max-w-[60ch] text-[14.5px] leading-[1.55] text-[var(--text-secondary)]">
          Career meetings computed from the BWF match catalog — not simulated
          records.
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
                  {pa.disc ?? "—"} · {pa.matches}
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
                        if (nextB === p.id) {
                          const opp = players.find((x) => x.id !== p.id);
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
                        {p.disc ?? "—"} · {p.matches}
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
                  {pb?.name ?? "Select opponent"}
                </span>
                {pb ? (
                  <span className="shrink-0 font-mono text-[11px] text-[var(--text-muted)]">
                    {pb.disc ?? "—"} · {pb.matches}
                  </span>
                ) : null}
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
                        {p.disc ?? "—"} · {p.matches}
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
              <Avatar
                name={pa.name}
                src={pa.imageUrl ?? undefined}
                size={52}
                className="mx-auto mb-2.5"
              />
              <div className="font-display text-sm font-semibold text-[var(--text-strong)]">
                {pa.name}
              </div>
              <div className="mt-1 font-mono text-[10.5px] text-[var(--text-muted)]">
                {pa.winRate}% career · {pa.matches} matches
              </div>
            </div>
            <div className="text-center">
              <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
                Catalog H2H
              </div>
              <div className="mt-1 font-display text-[32px] font-semibold tabular-nums text-[var(--text-strong)]">
                {aWins}–{bWins}
              </div>
              <div className="mt-1 font-mono text-[10.5px] text-[var(--text-muted)]">
                {n} meeting{n === 1 ? "" : "s"}
              </div>
            </div>
            <div className="text-center">
              {pb ? (
                <>
                  <Avatar
                    name={pb.name}
                    src={pb.imageUrl ?? undefined}
                    size={52}
                    className="mx-auto mb-2.5"
                  />
                  <div className="font-display text-sm font-semibold text-[var(--text-strong)]">
                    {pb.name}
                  </div>
                  <div className="mt-1 font-mono text-[10.5px] text-[var(--text-muted)]">
                    {pb.winRate}% career · {pb.matches} matches
                  </div>
                </>
              ) : (
                <div className="text-[13px] text-[var(--text-muted)]">
                  Pick an opponent
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] px-[18px] py-4">
          <div className="mb-2.5">
            <div className="text-[13px] font-medium text-[var(--text-strong)]">
              Meeting history
            </div>
            <div className="mt-[3px] font-mono text-[10.5px] text-[var(--text-muted)]">
              {n === 0
                ? "No shared matches in the catalog"
                : `All ${n} meeting${n === 1 ? "" : "s"}`}
            </div>
          </div>
          <div className="max-h-[280px] space-y-2 overflow-y-auto">
            {n === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--border)] px-3 py-8 text-center text-[12.5px] text-[var(--text-muted)]">
                These two players have not met in the loaded BWF data.
              </div>
            ) : (
              meetings.map((m) => {
                const aWon = playerWon(m, pa.id);
                return (
                  <Link
                    key={m.id}
                    href={`/bwf/matches/${m.id}`}
                    className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2 hover:border-[var(--border)]"
                  >
                    <span
                      className={cn(
                        "inline-flex h-6 w-6 items-center justify-center rounded-md font-mono text-[10px] font-semibold",
                        aWon === true
                          ? "bg-[rgba(54,147,255,0.16)] text-[var(--player-a)]"
                          : aWon === false
                            ? "bg-[rgba(251,191,36,0.16)] text-[#d99a1a]"
                            : "bg-[var(--surface-3)] text-[var(--text-muted)]",
                      )}
                    >
                      {aWon === true ? "A" : aWon === false ? "B" : "—"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--text-strong)]">
                      {m.event}
                      {m.round ? ` · ${m.round}` : ""}
                    </span>
                    <span className="font-mono text-[10.5px] tabular-nums text-[var(--text-muted)]">
                      {formatScoreLine(m.games)}
                    </span>
                    <span className="hidden font-mono text-[10.5px] text-[var(--text-faint)] sm:inline">
                      {displayDate(m)}
                    </span>
                  </Link>
                );
              })
            )}
          </div>
        </div>
      </div>

      <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] px-5 py-[18px]">
        <div className="mb-[18px] flex items-center justify-between">
          <span className="text-[13px] font-medium text-[var(--text-strong)]">
            Catalog comparison
          </span>
          <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
            from match rows
          </span>
        </div>
        {pb ? (
          <div className="space-y-3">
            {[
              { k: "Win rate", a: pa.winRate, b: pb.winRate, unit: "%" },
              { k: "Wins", a: pa.wins, b: pb.wins, unit: "" },
              { k: "Matches", a: pa.matches, b: pb.matches, unit: "" },
              {
                k: "Three-game",
                a: pa.threeGames,
                b: pb.threeGames,
                unit: "",
              },
              {
                k: "With video",
                a: pa.withVideo,
                b: pb.withVideo,
                unit: "",
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
        ) : (
          <div className="text-[13px] text-[var(--text-muted)]">
            Select a second player to compare catalog stats.
          </div>
        )}
      </div>

      {n > 0 && pb ? (
        <div className="mt-3.5 rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] px-5 py-4">
          <div className="mb-3 text-[13px] font-medium text-[var(--text-strong)]">
            Scorelines
          </div>
          <div className="space-y-2">
            {meetings.map((m) => (
              <div
                key={`score-${m.id}`}
                className="flex flex-wrap items-center gap-2 font-mono text-[12px] text-[var(--text-secondary)]"
              >
                <span className="text-[var(--text-strong)]">
                  {formatTeam(m.team1)} {formatScoreLine(m.games)}{" "}
                  {formatTeam(m.team2)}
                </span>
                <span className="text-[var(--text-faint)]">
                  · {m.event}
                  {m.round ? ` · ${m.round}` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
