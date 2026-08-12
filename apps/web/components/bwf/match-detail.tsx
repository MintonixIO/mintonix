import Link from "next/link";
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Flame,
  Clapperboard,
  Play,
  Video,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import {
  BWF_STATUS_LABEL_LONG,
  DISC_LABEL,
  displayDate,
  formatDuration,
  formatScoreLine,
  formatTeam,
  parseYoutubeUrl,
  playerImageUrl,
  type CatalogMatch,
} from "@/lib/bwf/data";
import { PA, PB } from "@/components/bwf/tokens";
import { cn } from "@/lib/utils";

export function MatchDetail({ m }: { m: CatalogMatch }) {
  const duration = formatDuration(m.durationSec);
  const youtube = parseYoutubeUrl(m.sourceUrl);
  /** Only allowlisted YouTube URLs render; other sources are hidden. */

  const side = (
    names: string[],
    ids: string[],
    color: string,
    won: boolean,
    scores: number[],
  ) => (
    <div className="flex items-center gap-3 rounded-[12px] border border-[var(--border-subtle)] bg-[var(--surface-2)] px-4 py-3">
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ background: color }}
      />
      <Avatar
        name={formatTeam(names)}
        src={ids[0] ? playerImageUrl(ids[0], names[0]) ?? undefined : undefined}
        size={44}
      />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate font-display text-[17px]",
            won
              ? "font-semibold text-[var(--text-strong)]"
              : "font-medium text-[var(--text-secondary)]",
          )}
        >
          {names.map((n, i) => (
            <span key={ids[i] || n}>
              {i > 0 ? " / " : null}
              <Link
                href={`/bwf/players/${ids[i]}`}
                className="hover:text-[var(--brand)]"
              >
                {n}
              </Link>
            </span>
          ))}
        </div>
        <div className="mt-1 flex flex-wrap gap-2">
          {ids.map((id, i) => (
            <Link
              key={id}
              href={`/bwf/players/${id}`}
              className="font-mono text-[10.5px] text-[var(--text-link)] hover:text-[var(--brand)]"
            >
              Profile · {names[i]?.split(" ").slice(-1)[0]}
            </Link>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {scores.map((s, i) => (
          <span
            key={i}
            className={cn(
              "min-w-8 text-center font-mono text-lg tabular-nums",
              won ? "text-[var(--text-strong)]" : "text-[var(--text-muted)]",
            )}
          >
            {s}
          </span>
        ))}
        {won ? (
          <Check className="h-5 w-5 text-[var(--success-500)]" />
        ) : (
          <span className="w-5" />
        )}
      </div>
    </div>
  );

  return (
    <section>
      <Link
        href="/bwf/matches"
        className="mb-[18px] inline-flex items-center gap-[7px] rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2.5 min-h-10 text-[13px] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]"
      >
        <ArrowLeft className="h-[15px] w-[15px]" />
        All matches
      </Link>

      <div className="mb-4 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-edge)]">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-5 py-4">
          {m.disc ? (
            <span className="rounded-full border border-[var(--border)] bg-[var(--brand-subtle)] px-2.5 py-1 font-mono text-[11px] text-[var(--brand)]">
              {m.disc}
              {DISC_LABEL[m.disc] ? ` · ${DISC_LABEL[m.disc]}` : ""}
            </span>
          ) : null}
          <span className="font-mono text-[12px] text-[var(--text-secondary)]">
            {m.event}
            {m.round ? ` · ${m.round}` : ""}
          </span>
          <div className="flex-1" />
          <span className="font-mono text-[12px] text-[var(--text-muted)]">
            {displayDate(m)}
          </span>
        </div>

        <div className="space-y-2.5 px-5 py-5">
          {side(
            m.team1,
            m.team1Ids,
            PA,
            m.winner === 1,
            m.games.map((g) => g.t1),
          )}
          {side(
            m.team2,
            m.team2Ids,
            PB,
            m.winner === 2,
            m.games.map((g) => g.t2),
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] px-5 py-4">
          <span className="font-display text-lg font-semibold tabular-nums text-[var(--text-strong)]">
            {formatScoreLine(m.games)}
          </span>
          {m.threeGames ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2.5 py-1 text-xs text-[var(--text-secondary)]">
              <Clapperboard className="h-3.5 w-3.5 text-[var(--brand)]" />
              Three games
            </span>
          ) : null}
          {m.comeback ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2.5 py-1 text-xs text-[var(--text-secondary)]">
              <Flame className="h-3.5 w-3.5 text-[var(--warning-400)]" />
              Comeback win
            </span>
          ) : null}
          <div className="flex-1" />
          <Link
            href={`/match-viewer/${m.id}`}
            className="inline-flex min-h-10 items-center gap-2 rounded-[10px] bg-[var(--brand)] px-3.5 py-2 text-[13px] font-medium text-[var(--text-on-blue)] shadow-[0_4px_14px_rgba(54,147,255,0.22)] hover:bg-[var(--brand-hover)]"
            title="Synthetic demo analysis — not pipeline output"
          >
            <Play className="h-4 w-4 fill-current" />
            Demo match viewer
          </Link>
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { k: "Status", v: BWF_STATUS_LABEL_LONG[m.status] ?? m.status },
          { k: "Duration", v: duration ?? "—" },
          {
            k: "Video",
            v: youtube ? "YouTube" : m.sourceUrl ? "Unrecognized" : "None",
          },
          {
            k: "Match id",
            v: m.id.slice(0, 12) + "…",
          },
        ].map((t) => (
          <div
            key={t.k}
            className="rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-4"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
              {t.k}
            </div>
            <div className="mt-2 truncate font-mono text-[13px] text-[var(--text-strong)]">
              {t.v}
            </div>
          </div>
        ))}
      </div>

      {youtube ? (
        <div className="mb-4 overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)]">
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
            <Video className="h-4 w-4 text-[var(--danger-500)]" />
            <span className="text-[13px] font-medium text-[var(--text-strong)]">
              Broadcast video
            </span>
            <div className="flex-1" />
            <Link
              href={`/match-viewer/${m.id}`}
              className="inline-flex items-center gap-1.5 text-xs text-[var(--text-link)] hover:text-[var(--brand)]"
              title="Synthetic demo analysis — not pipeline output"
            >
              <Play className="h-3.5 w-3.5" />
              Demo match viewer
            </Link>
            <a
              href={youtube.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-[var(--text-link)] hover:text-[var(--brand)]"
            >
              Open on YouTube
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
          <div className="aspect-video w-full bg-[var(--bg-sunken,#05070c)]">
            <iframe
              title="Match video (YouTube when allowlisted)"
              src={`https://www.youtube-nocookie.com/embed/${youtube.id}`}
              className="h-full w-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          </div>
        </div>
      ) : m.sourceUrl ? (
        <div className="mb-4 rounded-[14px] border border-dashed border-[var(--border)] bg-[var(--surface-1)] px-5 py-8 text-center text-[13px] text-[var(--text-muted)]">
          <p>Video source on file is not a recognized YouTube URL (link omitted).</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <Link
              href={`/match-viewer/${m.id}`}
              className="inline-flex min-h-10 items-center text-[13px] text-[var(--text-link)] hover:text-[var(--brand)]"
            >
              Demo match viewer (3D only)
            </Link>
            <Link
              href="/bwf/matches?lens=video"
              className="inline-flex min-h-10 items-center text-[13px] text-[var(--text-link)] hover:text-[var(--brand)]"
            >
              Browse matches with video
            </Link>
          </div>
        </div>
      ) : (
        <div className="mb-4 rounded-[14px] border border-dashed border-[var(--border)] bg-[var(--surface-1)] px-5 py-8 text-center text-[13px] text-[var(--text-muted)]">
          <p>No YouTube source linked for this match yet.</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <Link
              href={`/match-viewer/${m.id}`}
              className="inline-flex min-h-10 items-center text-[13px] text-[var(--text-link)] hover:text-[var(--brand)]"
            >
              Demo match viewer (3D only)
            </Link>
            <Link
              href="/bwf/matches?lens=video"
              className="inline-flex min-h-10 items-center text-[13px] text-[var(--text-link)] hover:text-[var(--brand)]"
            >
              Browse matches with video
            </Link>
          </div>
        </div>
      )}

      <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] px-5 py-4">
        <div className="mb-2 text-[13px] font-medium text-[var(--text-strong)]">
          Catalog metadata
        </div>
        <dl className="grid gap-2 text-[12.5px] sm:grid-cols-2">
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
              Tournament raw
            </dt>
            <dd className="mt-0.5 text-[var(--text-secondary)]">
              {m.tournamentRaw || "—"}
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
              Ingested
            </dt>
            <dd className="mt-0.5 text-[var(--text-secondary)]">
              {new Date(m.createdAt).toLocaleString()}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="font-mono text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
              Full id
            </dt>
            <dd className="mt-0.5 break-all font-mono text-[11px] text-[var(--text-muted)]">
              {m.id}
            </dd>
          </div>
        </dl>
        {m.team1Ids[0] && m.team2Ids[0] ? (
          <div className="mt-4">
            <Link
              href={`/bwf/h2h?a=${m.team1Ids[0]}&b=${m.team2Ids[0]}`}
              className="inline-flex min-h-10 items-center text-[13px] text-[var(--text-link)] hover:text-[var(--brand)]"
            >
              Head-to-head · {m.team1[0]} vs {m.team2[0]}
            </Link>
            {(m.team1.length > 1 || m.team2.length > 1) ? (
              <p className="mt-1 font-mono text-[10.5px] text-[var(--text-faint)]">
                Primary names only (first player each side). Full-team H2H is
                not supported yet for doubles.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
