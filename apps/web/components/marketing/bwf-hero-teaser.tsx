import Link from "next/link";
import { ArrowRight, Swords, Trophy, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HomeStats } from "@/lib/bwf/types";

const LINKS = [
  {
    href: "/bwf/matches",
    icon: Trophy,
    title: "Match library",
    body: "Filter by event, discipline, and round.",
    iconClass: "border-[var(--border)] bg-[var(--brand-subtle)] text-[var(--brand)]",
  },
  {
    href: "/bwf/players",
    icon: Users,
    title: "Player directory",
    body: "Win–loss and form from real match rows.",
    iconClass: "border-[var(--border)] bg-[var(--success-bg)] text-[var(--success-500)]",
  },
  {
    href: "/bwf/h2h",
    icon: Swords,
    title: "Head-to-head",
    body: "Every shared meeting in the catalog.",
    iconClass: "border-[var(--border)] bg-[var(--player-b-soft)] text-[var(--player-b)]",
  },
] as const;

function fmt(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString();
}

/** BWF-native home teaser — same headline stats as `/bwf` home. */
export function BwfHeroTeaser({
  stats,
  className,
}: {
  stats?: HomeStats | null;
  className?: string;
}) {
  const chips = [
    {
      label: "Tournaments",
      value: fmt(stats?.tournaments),
      unit: "BWF events",
    },
    {
      label: "Players",
      value: fmt(stats?.players),
      unit: "in catalog",
    },
    {
      label: "Matches",
      value: fmt(stats?.matches),
      unit: "finished",
    },
    {
      label: "With video",
      value: fmt(stats?.withVideo),
      unit: "YouTube links",
    },
  ] as const;

  const discEntries = stats
    ? (Object.entries(stats.byDisc) as [string, number][]).filter(
        ([, n]) => n > 0,
      )
    : [];

  return (
    <div
      aria-label="BWF catalog preview"
      className={cn(
        "overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-edge)]",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] px-5 py-4 sm:px-6">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--border)] bg-[var(--brand-subtle)] text-[var(--brand)]">
          <Trophy className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1 text-left">
          <div className="font-display text-base font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
            BWF match catalog
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-[var(--text-muted)]">
            {stats
              ? "Live counts from the loaded catalog"
              : "Counts unavailable — open the catalog to retry"}
          </div>
        </div>
        <Link
          href="/bwf"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] bg-[var(--brand)] px-4 text-sm font-medium text-[var(--text-on-blue)] transition-colors hover:bg-[var(--brand-hover)]"
        >
          Open catalog
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-px bg-[var(--border-subtle)] sm:grid-cols-4">
        {chips.map((s) => (
          <div key={s.label} className="bg-[var(--surface-1)] px-4 py-4 sm:px-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
              {s.label}
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="font-display text-[22px] font-semibold tabular-nums tracking-[-0.02em] text-[var(--text-strong)] sm:text-[26px]">
                {s.value}
              </span>
              <span className="font-mono text-[11px] text-[var(--text-muted)]">
                {s.unit}
              </span>
            </div>
          </div>
        ))}
      </div>

      {discEntries.length > 0 ? (
        <div className="flex flex-wrap gap-2 border-b border-[var(--border-subtle)] px-5 py-3.5 sm:px-6">
          {discEntries.map(([d, n]) => (
            <Link
              key={d}
              href={`/bwf/matches?disc=${d}`}
              className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 text-[12.5px] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]"
            >
              <span className="font-mono text-[10.5px] text-[var(--accent)]">
                {d}
              </span>
              <span className="tabular-nums">{n.toLocaleString()}</span>
            </Link>
          ))}
        </div>
      ) : null}

      <div className="grid gap-px bg-[var(--border-subtle)] md:grid-cols-3">
        {LINKS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group flex min-h-[5.5rem] flex-col bg-[var(--surface-1)] p-5 text-left transition-colors hover:bg-[var(--surface-2)]"
          >
            <span
              className={
                "inline-flex h-9 w-9 items-center justify-center rounded-[10px] border " +
                item.iconClass
              }
            >
              <item.icon className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <span className="mt-3 font-display text-[15px] font-semibold text-[var(--text-strong)] group-hover:text-[var(--brand)]">
              {item.title}
            </span>
            <span className="mt-1 text-[13px] leading-snug text-[var(--text-secondary)]">
              {item.body}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
