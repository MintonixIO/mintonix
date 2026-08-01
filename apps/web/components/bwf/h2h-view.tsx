"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { MatchRow } from "@/components/bwf/match-card";
import { PlayerPicker } from "@/components/bwf/player-picker";
import { PA, PB } from "@/components/bwf/tokens";
import type {
  CatalogMatch,
  DirectoryPlayer,
  H2hPickerPlayer,
} from "@/lib/bwf/types";
import { cn } from "@/lib/utils";

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
  /** Slim seed options for the picker (not the full directory). */
  players: H2hPickerPlayer[];
  initialA: string;
  initialB: string;
  meetings: CatalogMatch[];
  aWins: number;
  bWins: number;
  /** Directory stats for the selected pair (no form/rivals payload). */
  a: DirectoryPlayer | null;
  b: DirectoryPlayer | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingA, setPendingA] = useState<string | null>(null);
  const [pendingB, setPendingB] = useState<string | null>(null);
  const [extraLabels, setExtraLabels] = useState<
    Record<string, H2hPickerPlayer>
  >({});

  useEffect(() => {
    setPendingA(null);
    setPendingB(null);
  }, [initialA, initialB]);

  const h2hA = pendingA ?? initialA;
  const h2hB = pendingB ?? initialB;
  const pa = a;
  const pb = b;

  const allPlayers = (() => {
    const map = new Map<string, H2hPickerPlayer>();
    for (const p of players) map.set(p.id, p);
    for (const p of Object.values(extraLabels)) map.set(p.id, p);
    if (pa) {
      map.set(pa.id, {
        id: pa.id,
        name: pa.name,
        matches: pa.matches,
        disc: pa.disc,
      });
    }
    if (pb) {
      map.set(pb.id, {
        id: pb.id,
        name: pb.name,
        matches: pb.matches,
        disc: pb.disc,
      });
    }
    return [...map.values()];
  })();

  const syncUrl = (aid: string, bid: string) => {
    setPendingA(aid);
    setPendingB(bid);
    startTransition(() => {
      router.replace(`/bwf/h2h?a=${aid}&b=${bid}`, { scroll: false });
    });
  };

  if (!pa) {
    return (
      <section className="rounded-[14px] border border-dashed border-[var(--border)] px-6 py-16 text-center text-[13px] text-[var(--text-muted)]">
        No players in the catalog yet.
      </section>
    );
  }

  const MEETING_CAP = 50;
  const shownMeetings = meetings.slice(0, MEETING_CAP);
  const n = meetings.length;
  const truncated = n > MEETING_CAP;
  const displayA =
    allPlayers.find((p) => p.id === h2hA)?.name ?? pa.name;
  const displayB =
    allPlayers.find((p) => p.id === h2hB)?.name ?? pb?.name ?? null;

  return (
    <section
      className={cn(
        "transition-opacity duration-150",
        isPending && "opacity-60",
      )}
      aria-busy={isPending}
    >
      <div className="mb-5">
        <h1 className="font-display text-[28px] font-semibold tracking-[-0.025em] text-[var(--text-strong)]">
          Head-to-Head
        </h1>
        <p className="mt-[7px] max-w-[60ch] text-[14.5px] leading-[1.55] text-[var(--text-secondary)]">
          Career meetings computed from the BWF match catalog — not simulated
          records. Search the full directory from the pickers (type 2+
          characters).
        </p>
      </div>

      <div className="mb-4 grid grid-cols-1 items-center gap-4 md:grid-cols-[1fr_auto_1fr]">
        <div className="flex items-center gap-2.5">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: PA }}
          />
          <PlayerPicker
            players={allPlayers}
            selectedId={h2hA}
            accent="a"
            remoteSearch
            disabled={isPending}
            onSelect={(player) => {
              setExtraLabels((prev) => ({ ...prev, [player.id]: player }));
              let nextB = h2hB;
              if (nextB === player.id) {
                const opp = allPlayers.find((x) => x.id !== player.id);
                if (opp) nextB = opp.id;
              }
              syncUrl(player.id, nextB);
            }}
          />
        </div>
        <span className="text-center font-mono text-[13px] text-[var(--text-faint)]">
          vs
        </span>
        <div className="flex items-center gap-2.5">
          <PlayerPicker
            players={allPlayers}
            selectedId={h2hB}
            accent="b"
            excludeId={h2hA}
            placeholder="Select opponent"
            remoteSearch
            disabled={isPending}
            onSelect={(player) => {
              setExtraLabels((prev) => ({ ...prev, [player.id]: player }));
              syncUrl(h2hA, player.id);
            }}
          />
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
                name={displayA}
                src={
                  h2hA === pa.id ? (pa.imageUrl ?? undefined) : undefined
                }
                size={52}
                className="mx-auto mb-2.5"
              />
              <div className="font-display text-sm font-semibold text-[var(--text-strong)]">
                {displayA}
              </div>
              <div className="mt-1 font-mono text-[10.5px] text-[var(--text-muted)]">
                {h2hA === pa.id
                  ? `${pa.winRate}% career · ${pa.matches} matches`
                  : "Loading…"}
              </div>
            </div>
            <div className="text-center">
              <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
                Catalog H2H
              </div>
              <div className="mt-1 font-display text-[32px] font-semibold tabular-nums text-[var(--text-strong)]">
                {h2hA === pa.id && h2hB === (pb?.id ?? "")
                  ? `${aWins}–${bWins}`
                  : "–"}
              </div>
              <div className="mt-1 font-mono text-[10.5px] text-[var(--text-muted)]">
                {h2hA === pa.id && h2hB === (pb?.id ?? "")
                  ? `${n} meeting${n === 1 ? "" : "s"}`
                  : isPending
                    ? "Updating…"
                    : "—"}
              </div>
            </div>
            <div className="text-center">
              {displayB ? (
                <>
                  <Avatar
                    name={displayB}
                    src={
                      pb && h2hB === pb.id
                        ? (pb.imageUrl ?? undefined)
                        : undefined
                    }
                    size={52}
                    className="mx-auto mb-2.5"
                  />
                  <div className="font-display text-sm font-semibold text-[var(--text-strong)]">
                    {displayB}
                  </div>
                  <div className="mt-1 font-mono text-[10.5px] text-[var(--text-muted)]">
                    {pb && h2hB === pb.id
                      ? `${pb.winRate}% career · ${pb.matches} matches`
                      : "Loading…"}
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
              {h2hA !== pa.id || h2hB !== (pb?.id ?? "")
                ? isPending
                  ? "Loading meetings…"
                  : "—"
                : n === 0
                  ? "No shared matches in the catalog"
                  : truncated
                    ? `Showing latest ${MEETING_CAP} of ${n} meetings · scoreline + event`
                    : `All ${n} meeting${n === 1 ? "" : "s"} · scoreline + event`}
            </div>
          </div>
          <div className="max-h-[280px] space-y-2 overflow-y-auto">
            {h2hA !== pa.id || h2hB !== (pb?.id ?? "") ? (
              <div className="rounded-lg border border-dashed border-[var(--border)] px-3 py-8 text-center text-[12.5px] text-[var(--text-muted)]">
                {isPending ? "Updating head-to-head…" : "Select players above."}
              </div>
            ) : n === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--border)] px-3 py-8 text-center text-[12.5px] text-[var(--text-muted)]">
                These two players have not met in the loaded BWF data.
              </div>
            ) : (
              shownMeetings.map((m) => (
                <MatchRow
                  key={m.id}
                  m={m}
                  highlightPlayerId={pa.id}
                  outcomeMode="ab"
                />
              ))
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
        {pb && h2hA === pa.id && h2hB === pb.id ? (
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
                        ? "font-semibold text-[var(--player-b)]"
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
            {isPending
              ? "Updating catalog comparison…"
              : "Select a second player to compare catalog stats."}
          </div>
        )}
      </div>
    </section>
  );
}
