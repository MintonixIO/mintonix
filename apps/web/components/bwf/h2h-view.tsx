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
  FormRating,
} from "@/lib/bwf/types";
import { cn } from "@/lib/utils";

export function H2hView({
  players,
  initialA,
  initialB,
  initialA2 = "",
  initialB2 = "",
  meetings,
  aWins,
  bWins,
  a,
  b,
  pairMode = false,
  pairAName = null,
  pairBName = null,
  pairARating = null,
  pairBRating = null,
}: {
  /** Slim seed options for the picker (not the full directory). */
  players: H2hPickerPlayer[];
  initialA: string;
  initialB: string;
  initialA2?: string;
  initialB2?: string;
  meetings: CatalogMatch[];
  aWins: number;
  bWins: number;
  /** Directory stats for the selected pair (no form/rivals payload). */
  a: DirectoryPlayer | null;
  b: DirectoryPlayer | null;
  pairMode?: boolean;
  pairAName?: string | null;
  pairBName?: string | null;
  pairARating?: FormRating | null;
  pairBRating?: FormRating | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingA, setPendingA] = useState<string | null>(null);
  const [pendingB, setPendingB] = useState<string | null>(null);
  const [pendingA2, setPendingA2] = useState<string | null>(null);
  const [pendingB2, setPendingB2] = useState<string | null>(null);
  const [showPairs, setShowPairs] = useState(pairMode);
  const [extraLabels, setExtraLabels] = useState<
    Record<string, H2hPickerPlayer>
  >({});

  useEffect(() => {
    setPendingA(null);
    setPendingB(null);
    setPendingA2(null);
    setPendingB2(null);
    setShowPairs(pairMode);
  }, [initialA, initialB, initialA2, initialB2, pairMode]);

  const h2hA = pendingA ?? initialA;
  const h2hB = pendingB ?? initialB;
  const h2hA2 = pendingA2 ?? initialA2;
  const h2hB2 = pendingB2 ?? initialB2;
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
        country: pa.country,
      });
    }
    if (pb) {
      map.set(pb.id, {
        id: pb.id,
        name: pb.name,
        matches: pb.matches,
        disc: pb.disc,
        country: pb.country,
      });
    }
    return [...map.values()];
  })();

  const syncUrl = (aid: string, bid: string, a2 = h2hA2, b2 = h2hB2) => {
    setPendingA(aid);
    setPendingB(bid);
    setPendingA2(a2);
    setPendingB2(b2);
    startTransition(() => {
      const q = new URLSearchParams({ a: aid, b: bid });
      if (a2) q.set("a2", a2);
      if (b2) q.set("b2", b2);
      router.replace(`/bwf/h2h?${q.toString()}`, { scroll: false });
    });
  };

  const remember = (player: H2hPickerPlayer) => {
    setExtraLabels((prev) => ({ ...prev, [player.id]: player }));
  };

  if (!pa) {
    return (
      <section className="rounded-[14px] border border-dashed border-[var(--border)] px-6 py-16 text-center text-[13px] text-[var(--text-muted)]">
        No players in the catalog yet.
      </section>
    );
  }

  const MEETING_CAP = 200;
  const shownMeetings = meetings.slice(0, MEETING_CAP);
  const n = meetings.length;
  const truncated = n > MEETING_CAP;
  const displayA =
    allPlayers.find((p) => p.id === h2hA)?.name ?? pa.name;
  const displayB =
    allPlayers.find((p) => p.id === h2hB)?.name ?? pb?.name ?? null;
  const displayA2 =
    allPlayers.find((p) => p.id === h2hA2)?.name ?? pairAName;
  const displayB2 =
    allPlayers.find((p) => p.id === h2hB2)?.name ?? pairBName;
  const labelA = displayA2 ? `${displayA} / ${displayA2}` : displayA;
  const labelB = displayB2 && displayB ? `${displayB} / ${displayB2}` : displayB;

  return (
    <section
      className={cn(
        "transition-opacity duration-150",
        isPending && "opacity-90",
      )}
      aria-busy={isPending}
    >
      <div className="mb-5">
        <h1 className="font-display text-[28px] font-semibold tracking-[-0.025em] text-[var(--text-strong)]">
          Head-to-Head
        </h1>
        <p className="mt-[7px] max-w-[60ch] text-[14.5px] leading-[1.55] text-[var(--text-secondary)]">
          Career meetings from the BWF catalog. Same-name players are split by
          association — country shows on every picker row. Search the full
          directory (type 2+ characters). Doubles: add partners for pair vs pair.
        </p>
      </div>

      <div className="mb-4 grid grid-cols-1 items-start gap-4 md:grid-cols-[1fr_auto_1fr]">
        <div className="space-y-2">
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
                remember(player);
                let nextB = h2hB;
                if (nextB === player.id) {
                  const opp = allPlayers.find((x) => x.id !== player.id);
                  if (opp) nextB = opp.id;
                }
                const nextA2 = h2hA2 === player.id ? "" : h2hA2;
                syncUrl(player.id, nextB, nextA2, h2hB2);
              }}
            />
          </div>
          {showPairs ? (
            <PlayerPicker
              players={allPlayers}
              selectedId={h2hA2}
              accent="a"
              excludeId={h2hA}
              placeholder="Partner (optional)"
              remoteSearch
              disabled={isPending}
              onSelect={(player) => {
                remember(player);
                syncUrl(h2hA, h2hB, player.id, h2hB2);
              }}
            />
          ) : null}
        </div>
        <span className="pt-3 text-center font-mono text-[13px] text-[var(--text-faint)]">
          vs
        </span>
        <div className="space-y-2">
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
                remember(player);
                const nextB2 = h2hB2 === player.id ? "" : h2hB2;
                syncUrl(h2hA, player.id, h2hA2, nextB2);
              }}
            />
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: PB }}
            />
          </div>
          {showPairs ? (
            <PlayerPicker
              players={allPlayers}
              selectedId={h2hB2}
              accent="b"
              excludeId={h2hB}
              placeholder="Partner (optional)"
              remoteSearch
              disabled={isPending}
              onSelect={(player) => {
                remember(player);
                syncUrl(h2hA, h2hB, h2hA2, player.id);
              }}
            />
          ) : null}
        </div>
      </div>
      <div className="mb-4">
        <button
          type="button"
          onClick={() => {
            if (showPairs) {
              setShowPairs(false);
              syncUrl(h2hA, h2hB, "", "");
            } else {
              setShowPairs(true);
            }
          }}
          className="inline-flex min-h-10 items-center rounded-[10px] border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[12.5px] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]"
        >
          {showPairs ? "Person vs person" : "Compare as pairs"}
        </button>
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
                {labelA}
                {pa.country ? (
                  <span className="ml-1.5 font-mono text-[10.5px] font-normal uppercase text-[var(--text-faint)]">
                    {pa.country}
                  </span>
                ) : null}
              </div>
              <div className="mt-1 font-mono text-[10.5px] text-[var(--text-muted)]">
                {h2hA === pa.id
                  ? pairMode
                    ? pairARating?.rankScore != null
                      ? `pair form ${Math.round(pairARating.rankScore)}`
                      : "pair form —"
                    : `${pa.winRate}% career · ${pa.matches} matches${
                        pa.rating?.rankScore != null
                          ? ` · form ${Math.round(pa.rating.rankScore)}`
                          : ""
                      }`
                  : "Loading…"}
              </div>
            </div>
            <div className="text-center">
              <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
                {pairMode ? "Pair H2H" : "Catalog H2H"}
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
                    name={labelB ?? displayB}
                    src={
                      pb && h2hB === pb.id
                        ? (pb.imageUrl ?? undefined)
                        : undefined
                    }
                    size={52}
                    className="mx-auto mb-2.5"
                  />
                  <div className="font-display text-sm font-semibold text-[var(--text-strong)]">
                    {labelB}
                    {pb?.country ? (
                      <span className="ml-1.5 font-mono text-[10.5px] font-normal uppercase text-[var(--text-faint)]">
                        {pb.country}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 font-mono text-[10.5px] text-[var(--text-muted)]">
                    {pb && h2hB === pb.id
                      ? pairMode
                        ? pairBRating?.rankScore != null
                          ? `pair form ${Math.round(pairBRating.rankScore)}`
                          : "pair form —"
                        : `${pb.winRate}% career · ${pb.matches} matches${
                            pb.rating?.rankScore != null
                              ? ` · form ${Math.round(pb.rating.rankScore)}`
                              : ""
                          }`
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
                    ? `Showing latest ${MEETING_CAP} of ${n} · date · event · round · 2–0/2–1`
                    : `All ${n} meeting${n === 1 ? "" : "s"} · date · event · round · score`}
            </div>
          </div>
        {pairMode ? (
          <p className="mb-3 font-mono text-[11px] text-[var(--text-muted)]">
            Pair vs pair
            {pairAName ? ` · ${displayA} / ${pairAName}` : ""}
            {pairBName ? ` vs ${displayB} / ${pairBName}` : ""}
          </p>
        ) : null}
        <div className="max-h-[420px] space-y-2 overflow-y-auto">
            {h2hA !== pa.id || h2hB !== (pb?.id ?? "") ? (
              <div className="rounded-lg border border-dashed border-[var(--border)] px-3 py-8 text-center text-[12.5px] text-[var(--text-muted)]">
                {isPending ? "Updating head-to-head…" : "Select players above."}
              </div>
            ) : n === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--border)] px-3 py-8 text-center text-[12.5px] text-[var(--text-muted)]">
                <p>These two players have not met in the loaded BWF data.</p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                  <a
                    href={`/bwf/players/${h2hA}`}
                    className="inline-flex min-h-10 items-center text-[13px] text-[var(--text-link)] hover:text-[var(--accent)]"
                  >
                    Open {displayA}
                  </a>
                  {displayB ? (
                    <a
                      href={`/bwf/players/${h2hB}`}
                      className="inline-flex min-h-10 items-center text-[13px] text-[var(--text-link)] hover:text-[var(--accent)]"
                    >
                      Open {displayB}
                    </a>
                  ) : null}
                  <a
                    href="/bwf/matches"
                    className="inline-flex min-h-10 items-center text-[13px] text-[var(--text-link)] hover:text-[var(--accent)]"
                  >
                    Browse matches
                  </a>
                </div>
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
            {pairMode ? "pair form + this H2H" : "from match rows"}
          </span>
        </div>
        {pb && h2hA === pa.id && h2hB === pb.id ? (
          <div className="space-y-3">
            {[
              ...(pairMode
                ? [
                    {
                      k: "Pair form",
                      a: pairARating?.rankScore ?? null,
                      b: pairBRating?.rankScore ?? null,
                      unit: "",
                    },
                    { k: "H2H wins", a: aWins, b: bWins, unit: "" },
                  ]
                : [
                    { k: "Win rate", a: pa.winRate, b: pb.winRate, unit: "%" },
                    {
                      k: "Form",
                      a: pa.rating?.rankScore ?? null,
                      b: pb.rating?.rankScore ?? null,
                      unit: "",
                    },
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
                  ]),
            ].map((m) => {
              const aVal = m.a;
              const bVal = m.b;
              const aNum = aVal ?? 0;
              const bNum = bVal ?? 0;
              const aHi = aVal != null && (bVal == null || aNum >= bNum);
              const max = Math.max(aNum, bNum, 1);
              const fmt = (v: number | null) =>
                v == null ? "—" : `${Math.round(v)}${m.unit}`;
              return (
                <div
                  key={m.k}
                  className="grid min-w-0 grid-cols-[minmax(48px,1fr)_minmax(0,1.4fr)_auto_minmax(0,1.4fr)_minmax(48px,1fr)] sm:grid-cols-[72px_1fr_100px_1fr_72px] items-center gap-2"
                >
                  <span
                    className={cn(
                      "text-right font-mono text-sm tabular-nums",
                      aVal != null && aHi
                        ? "font-semibold text-[var(--player-a)]"
                        : "text-[var(--text-secondary)]",
                    )}
                  >
                    {fmt(aVal)}
                  </span>
                  <div className="flex h-2 justify-end overflow-hidden rounded-full bg-[var(--surface-3)]">
                    <div
                      className="h-full rounded-full bg-[var(--player-a)]"
                      style={{
                        width: aVal == null ? "0%" : `${(aNum / max) * 100}%`,
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
                        width: bVal == null ? "0%" : `${(bNum / max) * 100}%`,
                        opacity: !aHi ? 1 : 0.5,
                      }}
                    />
                  </div>
                  <span
                    className={cn(
                      "font-mono text-sm tabular-nums",
                      bVal != null && !aHi
                        ? "font-semibold text-[var(--player-b)]"
                        : "text-[var(--text-secondary)]",
                    )}
                  >
                    {fmt(bVal)}
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
