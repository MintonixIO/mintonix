import Link from "next/link";
import {
  ArrowRight,
  Check,
  Repeat,
  Target,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PA, PB, typeColor, type Match, type Player } from "@/lib/bwf/types";

export function MatchCard({ m, lens = "all" }: { m: Match; lens?: string }) {
  const top = [...m.shotMix].sort((a, b) => b.pct - a.pct);
  const badge =
    lens === "long"
      ? { label: "Longest rally", value: `${m.longest} shots`, color: "var(--accent)" }
      : lens === "fast"
        ? { label: "Top smash", value: `${m.fastestSmash} km/h`, color: "var(--danger-500)" }
        : lens === "marathon"
          ? { label: "Duration", value: `${m.dur} min`, color: "var(--text-strong)" }
          : lens === "attacking"
            ? { label: "Attacking", value: `${m.attackPct}%`, color: "var(--accent)" }
            : null;

  const row = (player: Player, color: string, won: boolean, side: "a" | "b") => (
    <div className="flex items-center gap-2.5">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: color }}
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate font-display text-base",
          won
            ? "font-semibold text-[var(--text-strong)]"
            : "font-medium text-[var(--text-secondary)]",
        )}
      >
        {player.name}
      </span>
      {m.games.map((g, i) => (
        <span
          key={i}
          className={cn(
            "w-6 text-center font-mono text-sm tabular-nums",
            won ? "text-[var(--text-strong)]" : "text-[var(--text-muted)]",
          )}
        >
          {side === "a" ? g.a : g.b}
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
      href="/video-analysis"
      className="group flex flex-col overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-edge)] transition-[transform,border-color] duration-160 hover:-translate-y-0.5 hover:border-[var(--border-strong)]"
    >
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-[13px]">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-[var(--accent)]">
          {m.disc}
        </span>
        <span className="h-[3px] w-[3px] rounded-full bg-[var(--text-faint)]" />
        <span className="min-w-0 truncate text-[12.5px] text-[var(--text-secondary)]">
          {m.event} · {m.round}
        </span>
        <div className="flex-1" />
        <span className="shrink-0 font-mono text-[11px] text-[var(--text-muted)]">
          {m.date}
        </span>
      </div>

      <div className="flex flex-col gap-[9px] px-4 pb-3 pt-3.5">
        {row(m.pa, PA, m.w === "a", "a")}
        {row(m.pb, PB, m.w === "b", "b")}
      </div>

      <div className="flex flex-col gap-3 px-4 pb-3.5">
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
            {m.rallies} rallies · {m.avgRally} avg · {m.dur} min
          </span>
          <div className="flex-1" />
          {badge ? (
            <span className="inline-flex items-baseline gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-3)] px-2.5 py-[3px]">
              <span className="font-mono text-[8.5px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
                {badge.label}
              </span>
              <span
                className="font-mono text-xs tabular-nums"
                style={{ color: badge.color }}
              >
                {badge.value}
              </span>
            </span>
          ) : null}
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
              Momentum
            </span>
            <span className="font-mono text-[9.5px] text-[var(--text-faint)]">
              who won each rally
            </span>
          </div>
          <div className="flex h-[9px] gap-0.5 overflow-hidden rounded">
            {m.momentum.map((w, i) => (
              <div
                key={i}
                title={`Rally ${i + 1} · ${m.rallyLens[i]} shots`}
                className="h-full opacity-85"
                style={{
                  flexGrow: m.rallyLens[i],
                  flexBasis: 0,
                  background: w === "a" ? PA : PB,
                }}
              />
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
              Shot mix
            </span>
            <span className="font-mono text-[9.5px] text-[var(--text-muted)]">
              {top[0].type} {top[0].pct}% · {top[1].type} {top[1].pct}%
            </span>
          </div>
          <div className="flex h-[7px] overflow-hidden rounded bg-[var(--surface-3)]">
            {m.shotMix.map((s) => (
              <div
                key={s.type}
                title={`${s.type} ${s.pct}%`}
                style={{
                  width: `${s.pct}%`,
                  background: typeColor(s.type),
                }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] px-4 py-3">
        {(
          [
            {
              key: "fast",
              icon: Zap,
              text: `${m.smashes300} smashes 300+`,
              color: "var(--danger-500)",
            },
            {
              key: "long",
              icon: Repeat,
              text: `Longest ${m.longest}`,
              color: "var(--accent)",
            },
            {
              key: "net",
              icon: Target,
              text: `${m.netWinners} net winners`,
              color: "var(--success-500)",
            },
          ] as const
        ).map((c) => {
          const Icon = c.icon;
          const emph =
            (lens === "fast" && c.key === "fast") ||
            (lens === "long" && c.key === "long") ||
            (lens === "attacking" && c.key === "fast");
          return (
            <span
              key={c.key}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[5px] text-xs text-[var(--text-secondary)]",
                emph
                  ? "border-[var(--border-strong)] bg-[var(--surface-3)]"
                  : "border-[var(--border-subtle)] bg-[var(--surface-2)]",
              )}
            >
              <Icon className="h-[13px] w-[13px]" style={{ color: c.color }} />
              {c.text}
            </span>
          );
        })}
        <div className="min-w-2 flex-1" />
        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-[var(--text-link)] group-hover:text-[var(--accent)]">
          Open full analysis
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </Link>
  );
}
