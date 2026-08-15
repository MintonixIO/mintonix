import Link from "next/link";
import { ArrowLeft, Swords } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { MatchRow } from "@/components/bwf/match-card";
import type {
  CatalogMatch,
  CatalogPlayer,
  DirectoryPlayer,
  FormRating,
  RivalRow,
} from "@/lib/bwf/types";
import { DISC_LABEL } from "@/lib/bwf/types";
import { formOrderCaption } from "@/lib/bwf/query";
import { cn } from "@/lib/utils";

function CountryBadge({ cc }: { cc: string | null }) {
  if (!cc) return null;
  return (
    <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
      {cc.toUpperCase()}
    </span>
  );
}

function formatMu(n: number): string {
  return Math.round(n).toLocaleString();
}

function RatingCard({
  title,
  rating,
  kind,
}: {
  title: string;
  rating: FormRating | null;
  kind: "glicko" | "trueskill";
}) {
  return (
    <div className="rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[var(--shadow-edge)]">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
        {title}
      </div>
      {rating ? (
        <>
          <div className="mt-2 font-display text-[26px] font-semibold tabular-nums text-[var(--text-strong)]">
            {kind === "glicko"
              ? formatMu(rating.rankScore ?? rating.mu)
              : (rating.exposure ?? rating.mu).toFixed(1)}
          </div>
          <div className="mt-1 font-mono text-[11px] text-[var(--text-muted)]">
            {kind === "glicko" ? (
              <>
                μ {formatMu(rating.mu)}
                {rating.rd != null ? ` · RD ${Math.round(rating.rd)}` : ""}
                {rating.peakMu != null
                  ? ` · peak ${formatMu(rating.peakMu)}`
                  : ""}
              </>
            ) : (
              <>
                μ {rating.mu.toFixed(1)}
                {rating.exposure != null
                  ? ` · exp ${rating.exposure.toFixed(1)}`
                  : ""}
              </>
            )}
            {` · ${rating.matches} rated`}
            {rating.disc ? ` · ${rating.disc}` : ""}
          </div>
        </>
      ) : (
        <div className="mt-2 text-[13px] text-[var(--text-muted)]">
          Not enough rated matches yet.
        </div>
      )}
    </div>
  );
}

function RivalList({
  title,
  rows,
  selfId,
  empty,
}: {
  title: string;
  rows: RivalRow[];
  selfId: string;
  empty: string;
}) {
  return (
    <div className="rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-4">
      <div className="mb-3 text-[13px] font-medium text-[var(--text-strong)]">
        {title}
      </div>
      <div className="space-y-2">
        {rows.length === 0 ? (
          <div className="text-[13px] text-[var(--text-muted)]">{empty}</div>
        ) : (
          rows.map((opp) => (
            <Link
              key={opp.id}
              href={`/bwf/h2h?a=${selfId}&b=${opp.id}`}
              className="flex min-h-10 w-full items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2.5 text-left hover:border-[var(--border)]"
            >
              <span className="min-w-0 truncate text-[13px] text-[var(--text-strong)]">
                {opp.name}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                {opp.wins}–{opp.meetings - opp.wins}
                <span className="ml-1.5 text-[var(--text-faint)]">
                  ({opp.meetings})
                </span>
              </span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

export function HomonymDisambiguation({
  queryId,
  candidates,
}: {
  queryId: string;
  candidates: DirectoryPlayer[];
}) {
  return (
    <section>
      <Link
        href="/bwf/players"
        className="mb-[18px] inline-flex items-center gap-[7px] rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2.5 min-h-10 text-[13px] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]"
      >
        <ArrowLeft className="h-[15px] w-[15px]" />
        All players
      </Link>
      <h1 className="font-display text-[27px] font-semibold tracking-[-0.025em] text-[var(--text-strong)]">
        Which player?
      </h1>
      <p className="mt-2 max-w-[56ch] text-[14px] leading-relaxed text-[var(--text-secondary)]">
        More than one player matches{" "}
        <span className="font-mono text-[13px] text-[var(--text-strong)]">
          {queryId}
        </span>
        . Same display name, different association — pick one.
      </p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {candidates.map((p) => (
          <Link
            key={p.id}
            href={`/bwf/players/${p.id}`}
            className="flex items-center gap-3.5 rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-[15px] hover:border-[var(--border-strong)]"
          >
            <Avatar name={p.name} src={p.imageUrl ?? undefined} size={46} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-display text-[15px] font-semibold text-[var(--text-strong)]">
                  {p.name}
                </span>
                <CountryBadge cc={p.country} />
              </div>
              <div className="mt-1 font-mono text-[11px] text-[var(--text-muted)]">
                {p.disc ?? "—"} · {p.wins}–{p.losses} · {p.matches} matches
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function PlayerProfile({
  profile,
  matches,
}: {
  profile: CatalogPlayer;
  matches: CatalogMatch[];
}) {
  const defaultOpp = profile.rivals[0];

  return (
    <section>
      <Link
        href="/bwf/players"
        className="mb-[18px] inline-flex items-center gap-[7px] rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2.5 min-h-10 text-[13px] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]"
      >
        <ArrowLeft className="h-[15px] w-[15px]" />
        All players
      </Link>

      <div className="relative mb-4 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-[22px] shadow-[var(--shadow-edge)]">
        <div
          className="pointer-events-none absolute inset-0 opacity-80"
          style={{
            background: "var(--hero-wash)",
          }}
        />
        <div className="relative flex flex-wrap items-center gap-5">
          <Avatar
            name={profile.name}
            src={profile.imageUrl ?? undefined}
            size={76}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-display text-[27px] font-semibold tracking-[-0.025em] text-[var(--text-strong)]">
                {profile.name}
              </h1>
              <CountryBadge cc={profile.country} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-[9px] font-mono text-xs text-[var(--text-secondary)]">
              {profile.disc ? (
                <span>{DISC_LABEL[profile.disc] ?? profile.disc}</span>
              ) : (
                <span>Multi-discipline</span>
              )}
              {profile.discs.length > 1 ? (
                <>
                  <span className="text-[var(--text-faint)]">·</span>
                  <span>{profile.discs.join(", ")}</span>
                </>
              ) : null}
            </div>
          </div>
          <div className="relative flex items-center gap-[22px]">
            <div className="text-right">
              <div className="font-display text-[30px] font-semibold tracking-[-0.02em] tabular-nums text-[var(--text-strong)]">
                {profile.wins}–{profile.losses}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
                catalog W–L
              </div>
            </div>
            <div className="text-right">
              <div className="font-display text-[30px] font-semibold tracking-[-0.02em] tabular-nums text-[var(--success-500)]">
                {profile.winRate}%
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
                win rate
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(profile.ratings.length > 0
          ? profile.ratings
          : profile.rating
            ? [profile.rating]
            : []
        ).map((r) => (
          <RatingCard
            key={`${r.disc}-${r.kind}`}
            title={`Form · ${r.disc}`}
            rating={r}
            kind="glicko"
          />
        ))}
        {profile.ratings.length === 0 && !profile.rating ? (
          <RatingCard title="Form rating" rating={null} kind="glicko" />
        ) : null}
        {profile.discs.some((d) => d === "MD" || d === "WD" || d === "XD") ? (
          <RatingCard
            title="Doubles individual"
            rating={profile.individualRating}
            kind="trueskill"
          />
        ) : null}
        {[
          {
            k: "Matches",
            v: String(profile.matches),
          },
          {
            k: "Three-game",
            v: String(profile.threeGames),
            c: "text-[var(--accent)]",
          },
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

      <div className="mb-3.5 grid gap-3.5 lg:grid-cols-2">
        <div className="rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-4">
          <div className="mb-3.5 text-[13px] font-medium text-[var(--text-strong)]">
            Recent form{" "}
            <span className="font-mono text-[11px] font-normal text-[var(--text-muted)]">
              — last {profile.form.length} decided
              {formOrderCaption(matches)}
            </span>
          </div>
          {profile.form.length === 0 ? (
            <div className="text-[13px] text-[var(--text-muted)]">
              No completed results yet.
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {profile.form.map((f, i) => (
                <span
                  key={i}
                  className={cn(
                    "inline-flex h-8 w-8 items-center justify-center rounded-lg font-mono text-xs font-semibold",
                    f === "W"
                      ? "bg-[var(--success-bg)] text-[var(--success-500)]"
                      : "bg-[rgba(244,81,92,0.14)] text-[var(--danger-500)]",
                  )}
                >
                  {f}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-4">
          <div className="mb-3.5 flex items-center justify-between">
            <span className="text-[13px] font-medium text-[var(--text-strong)]">
              Top rivalries
            </span>
            {defaultOpp ? (
              <Link
                href={`/bwf/h2h?a=${profile.id}&b=${defaultOpp.id}`}
                className="inline-flex min-h-10 items-center gap-1 text-xs text-[var(--text-link)] hover:text-[var(--accent)]"
              >
                <Swords className="h-3.5 w-3.5" />
                Compare
              </Link>
            ) : null}
          </div>
          <p className="mb-3 text-[12px] leading-relaxed text-[var(--text-muted)]">
            Opposite-side meetings only. Doubles partners are excluded. Pair vs
            pair lives on the match page.
          </p>
          <div className="space-y-2">
            {profile.rivals.length === 0 ? (
              <div className="text-[13px] text-[var(--text-muted)]">
                No head-to-head data yet.
              </div>
            ) : (
              profile.rivals.slice(0, 5).map((opp) => (
                <Link
                  key={opp.id}
                  href={`/bwf/h2h?a=${profile.id}&b=${opp.id}`}
                  className="flex min-h-10 w-full items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2.5 text-left hover:border-[var(--border)]"
                >
                  <span className="min-w-0 truncate text-[13px] text-[var(--text-strong)]">
                    {opp.name}
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                    {opp.wins}–{opp.meetings - opp.wins}
                    <span className="ml-1.5 text-[var(--text-faint)]">
                      ({opp.meetings})
                    </span>
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="mb-3.5 grid gap-3.5 lg:grid-cols-2">
        <RivalList
          title="Owns"
          rows={profile.owns}
          selfId={profile.id}
          empty="No close rival with at least 4 meetings at 70% or better."
        />
        <RivalList
          title="Struggles"
          rows={profile.struggles}
          selfId={profile.id}
          empty="No close rival with at least 4 meetings at 30% or worse."
        />
      </div>
      <p className="mb-4 font-mono text-[11px] text-[var(--text-faint)]">
        Owns / Struggles: at least 4 meetings against someone within 200 form
        points. Walkovers and retirements are listed below but not rated.
      </p>

      <div className="rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] px-[18px] py-4">
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="text-[13px] font-medium text-[var(--text-strong)]">
            Match history
          </div>
          <Link
            href={`/bwf/matches?player=${encodeURIComponent(profile.id)}`}
            className="inline-flex min-h-10 items-center text-xs text-[var(--text-link)] hover:text-[var(--accent)]"
          >
            View in library
          </Link>
        </div>
        <div className="mt-3 space-y-2">
          {matches.length === 0 ? (
            <div className="py-6 text-center text-[13px] text-[var(--text-muted)]">
              No matches found for this player.
            </div>
          ) : (
            matches.map((m) => (
              <MatchRow
                key={m.id}
                m={m}
                highlightPlayerId={profile.id}
                outcomeMode="wl"
              />
            ))
          )}
        </div>
      </div>
    </section>
  );
}
