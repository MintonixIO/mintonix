import Link from "next/link";
import {
  ArrowRight,
  Check,
  Clapperboard,
  ExternalLink,
  Flame,
  Video,
} from "lucide-react";
import {
  BWF_STATUS_UI,
  displayDate,
  formatScoreLine,
  formatTeam,
  isAllowlistedYoutubeUrl,
  playerImageUrl,
  playerWon,
  type CatalogMatch,
} from "@/lib/bwf/data";
import { PA, PB } from "@/components/bwf/tokens";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";

export function MatchCard({
  m,
  highlight,
}: {
  m: CatalogMatch;
  /** Optional filter badge context. */
  highlight?: "video" | "three" | "comeback" | null;
}) {
  const t1Won = m.winner === 1;
  const t2Won = m.winner === 2;
  const score = formatScoreLine(m.games);

  const row = (
    names: string[],
    ids: string[],
    color: string,
    won: boolean,
    sideScores: number[],
  ) => (
    <div className="flex items-center gap-2.5">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: color }}
      />
      <Avatar
        name={formatTeam(names)}
        src={ids[0] ? playerImageUrl(ids[0], names[0]) ?? undefined : undefined}
        size={28}
        className="shrink-0"
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate font-display text-[15px]",
          won
            ? "font-semibold text-[var(--text-strong)]"
            : "font-medium text-[var(--text-secondary)]",
        )}
      >
        {formatTeam(names)}
      </span>
      {sideScores.map((s, i) => (
        <span
          key={i}
          className={cn(
            "w-6 text-center font-mono text-sm tabular-nums",
            won ? "text-[var(--text-strong)]" : "text-[var(--text-muted)]",
          )}
        >
          {s}
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
      href={`/bwf/matches/${m.id}`}
      className="group flex flex-col overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-edge)] transition-[transform,border-color] duration-160 hover:-translate-y-0.5 hover:border-[var(--border-strong)]"
    >
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-[13px]">
        {m.disc ? (
          <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-[var(--accent)]">
            {m.disc}
          </span>
        ) : null}
        {m.disc ? (
          <span className="h-[3px] w-[3px] rounded-full bg-[var(--text-faint)]" />
        ) : null}
        <span className="min-w-0 truncate text-[12.5px] text-[var(--text-secondary)]">
          {m.event}
          {m.round ? ` · ${m.round}` : ""}
        </span>
        <div className="flex-1" />
        <span className="shrink-0 font-mono text-[11px] text-[var(--text-muted)]">
          {displayDate(m)}
        </span>
      </div>

      <div className="flex flex-col gap-[9px] px-4 pb-3 pt-3.5">
        {row(
          m.team1,
          m.team1Ids,
          PA,
          t1Won,
          m.games.map((g) => g.t1),
        )}
        {row(
          m.team2,
          m.team2Ids,
          PB,
          t2Won,
          m.games.map((g) => g.t2),
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 pb-3.5">
        <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
          {score}
        </span>
        <div className="flex-1" />
        <span
          className={cn(
            "rounded-full border px-2 py-[2px] font-mono text-[10px] uppercase tracking-wide",
            BWF_STATUS_UI[m.status]?.className ??
              "border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)]",
          )}
        >
          {BWF_STATUS_UI[m.status]?.label ?? m.status}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] px-4 py-3">
        {isAllowlistedYoutubeUrl(m.sourceUrl) ? (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[5px] text-xs text-[var(--text-secondary)]",
              highlight === "video"
                ? "border-[var(--border-strong)] bg-[var(--surface-3)]"
                : "border-[var(--border-subtle)] bg-[var(--surface-2)]",
            )}
          >
            <Video className="h-[13px] w-[13px] text-[var(--danger-500)]" />
            Video
          </span>
        ) : null}
        {m.threeGames ? (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[5px] text-xs text-[var(--text-secondary)]",
              highlight === "three"
                ? "border-[var(--border-strong)] bg-[var(--surface-3)]"
                : "border-[var(--border-subtle)] bg-[var(--surface-2)]",
            )}
          >
            <Clapperboard className="h-[13px] w-[13px] text-[var(--accent)]" />
            3 games
          </span>
        ) : null}
        {m.comeback ? (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[5px] text-xs text-[var(--text-secondary)]",
              highlight === "comeback"
                ? "border-[var(--border-strong)] bg-[var(--surface-3)]"
                : "border-[var(--border-subtle)] bg-[var(--surface-2)]",
            )}
          >
            <Flame className="h-[13px] w-[13px] text-[var(--warning-400,var(--accent))]" />
            Comeback
          </span>
        ) : null}
        <div className="min-w-2 flex-1" />
        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-[var(--text-link)] group-hover:text-[var(--accent)]">
          Match details
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </Link>
  );
}

/**
 * Shared compact match row for player history and H2H meeting lists.
 * When `highlightPlayerId` is set, shows W/L (or A/B for H2H) vs opponent.
 */
export function MatchRow({
  m,
  highlightPlayerId,
  outcomeMode = "wl",
}: {
  m: CatalogMatch;
  /** When set, row is player-centric (W/L or A/B vs opponent). */
  highlightPlayerId?: string;
  /** `wl` for player profile; `ab` for H2H where A is highlightPlayerId. */
  outcomeMode?: "wl" | "ab";
}) {
  const wonSide = m.winner;
  const hasPlayer = Boolean(highlightPlayerId);
  const won = highlightPlayerId
    ? playerWon(m, highlightPlayerId)
    : null;
  const opp = highlightPlayerId
    ? m.team1Ids.includes(highlightPlayerId)
      ? formatTeam(m.team2)
      : formatTeam(m.team1)
    : null;

  const badgeLabel =
    outcomeMode === "ab"
      ? won === true
        ? "A"
        : won === false
          ? "B"
          : "—"
      : won === true
        ? "W"
        : won === false
          ? "L"
          : "—";

  return (
    <Link
      href={`/bwf/matches/${m.id}`}
      className="flex min-h-10 flex-wrap items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2.5 hover:border-[var(--border)]"
    >
      {hasPlayer ? (
        <span
          className={cn(
            "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md font-mono text-[10px] font-semibold",
            outcomeMode === "ab"
              ? won === true
                ? "bg-[var(--player-a-soft)] text-[var(--player-a)]"
                : won === false
                  ? "bg-[var(--player-b-soft)] text-[var(--player-b)]"
                  : "bg-[var(--surface-3)] text-[var(--text-muted)]"
              : won === true
                ? "bg-[var(--success-bg)] text-[var(--success-500)]"
                : won === false
                  ? "bg-[rgba(244,81,92,0.14)] text-[var(--danger-500)]"
                  : "bg-[var(--surface-3)] text-[var(--text-muted)]",
          )}
        >
          {badgeLabel}
        </span>
      ) : m.disc ? (
        <span className="w-8 font-mono text-[10px] text-[var(--accent)]">
          {m.disc}
        </span>
      ) : null}

      <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-strong)]">
        {hasPlayer && opp ? (
          <>
            <span className="text-[var(--text-muted)]">vs </span>
            {opp}
            <span className="hidden text-[var(--text-faint)] sm:inline">
              {" · "}
              {m.event}
              {m.round ? ` · ${m.round}` : ""}
            </span>
          </>
        ) : (
          <>
            <span className={wonSide === 1 ? "font-semibold" : ""}>
              {formatTeam(m.team1)}
            </span>
            <span className="text-[var(--text-muted)]"> vs </span>
            <span className={wonSide === 2 ? "font-semibold" : ""}>
              {formatTeam(m.team2)}
            </span>
          </>
        )}
      </span>

      <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
        {formatScoreLine(m.games)}
      </span>

      {!hasPlayer ? (
        <span className="hidden font-mono text-[11px] text-[var(--text-faint)] sm:inline">
          {m.event}
          {m.round ? ` · ${m.round}` : ""}
        </span>
      ) : (
        <span className="hidden font-mono text-[11px] text-[var(--text-faint)] sm:inline">
          {displayDate(m) || m.round}
        </span>
      )}

      {isAllowlistedYoutubeUrl(m.sourceUrl) ? (
        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
      ) : null}
    </Link>
  );
}
