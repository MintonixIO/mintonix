import { Lock } from "lucide-react";
import { initials } from "@/lib/utils";

export function PlayerCardPreview({
  name,
  club,
  level,
  years,
  disciplines,
  isPrivate,
  avatarUrl,
}: {
  name: string;
  club: string;
  level: string;
  years: string;
  disciplines: string[];
  isPrivate: boolean;
  avatarUrl: string | null;
}) {
  const displayName = name.trim() || "Your name";
  const displayClub = club.trim() || "Add your club";
  const ini = initials(name) || "YN";

  return (
    <div className="max-w-[360px]">
      <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--accent)]">
        Your player card
      </div>
      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-lg),inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div className="flex items-center gap-3.5 border-b border-[var(--border-subtle)] px-[22px] py-[22px] pb-[18px]">
          <div className="relative flex h-[58px] w-[58px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-[linear-gradient(135deg,#4a9dff,#2d7ff0)] font-display text-[21px] font-semibold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <span>{ini}</span>
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate font-display text-lg font-semibold tracking-[-0.01em] text-[var(--text-strong)]">
              {displayName}
            </div>
            <div className="mt-0.5 truncate text-[13px] text-[var(--text-muted)]">
              {displayClub}
            </div>
          </div>
          {isPrivate ? (
            <span className="ml-auto inline-flex shrink-0 items-center gap-1 self-start rounded-full border border-[var(--border)] bg-white/[0.04] px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
              <Lock className="h-[11px] w-[11px]" aria-hidden />
              Private
            </span>
          ) : null}
        </div>
        <div className="flex min-h-[30px] flex-wrap gap-2 px-[22px] py-4">
          {level ? (
            <span className="rounded-full border border-[var(--border)] bg-[var(--accent-soft)] px-2.5 py-1 font-mono text-[11px] tracking-wide text-[var(--accent)]">
              {level}
            </span>
          ) : null}
          {disciplines.map((d) => (
            <span
              key={d}
              className="rounded-full border border-[var(--border)] bg-white/[0.04] px-2.5 py-1 font-mono text-[11px] tracking-wide text-[var(--text-secondary)]"
            >
              {d}
            </span>
          ))}
          {years ? (
            <span className="rounded-full border border-[var(--border)] bg-white/[0.04] px-2.5 py-1 font-mono text-[11px] tracking-wide text-[var(--text-secondary)]">
              {years}
            </span>
          ) : null}
        </div>
        <div className="mx-[22px] mb-[22px] grid grid-cols-3 gap-px overflow-hidden rounded-[11px] border border-[var(--border-subtle)] bg-[var(--border-subtle)]">
          {["Matches", "Win rate", "Rallies"].map((label) => (
            <div
              key={label}
              className="bg-[var(--surface-1)] px-2.5 py-3 text-center"
            >
              <div className="font-mono text-lg font-semibold text-[var(--text-faint)]">
                —
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                {label}
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-4 px-1 text-[13px] leading-[1.55] text-[var(--text-muted)]">
        Your card fills in as you play. Upload your first match to start tracking
        these stats.
      </p>
    </div>
  );
}
