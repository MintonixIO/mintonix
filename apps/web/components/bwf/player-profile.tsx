import Link from "next/link";
import { ArrowLeft, Zap } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { byId, h2hRecord, MATCHES, PLAYERS } from "@/lib/bwf/data";
import { typeColor } from "@/lib/bwf/types";
import { cn } from "@/lib/utils";

export function PlayerProfile({ id }: { id: string }) {
  const profile = byId(id);
  if (!profile) return null;

  const defaultOpp = PLAYERS.find(
    (p) => p.disc === profile.disc && p.id !== profile.id,
  );

  return (
    <section>
      <Link
        href="/bwf/players"
        className="mb-[18px] inline-flex items-center gap-[7px] rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-[7px] text-[13px] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]"
      >
        <ArrowLeft className="h-[15px] w-[15px]" />
        All players
      </Link>

      <div className="relative mb-4 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-[22px] shadow-[var(--shadow-edge)]">
        <div
          className="pointer-events-none absolute inset-0 opacity-80"
          style={{
            background:
              "radial-gradient(80% 130% at 0% 0%, rgba(54,147,255,0.10), transparent 55%)",
          }}
        />
        <div className="relative flex flex-wrap items-center gap-5">
          <Avatar name={profile.name} size={76} />
          <div className="min-w-[220px] flex-1">
            <h1 className="font-display text-[27px] font-semibold tracking-[-0.025em] text-[var(--text-strong)]">
              {profile.name}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-[9px] font-mono text-xs text-[var(--text-secondary)]">
              <span>{profile.countryName}</span>
              <span className="text-[var(--text-faint)]">·</span>
              <span>
                {profile.disc === "MS" ? "Men's singles" : "Women's singles"}
              </span>
              <span className="text-[var(--text-faint)]">·</span>
              <span>{profile.hand}</span>
              <span className="text-[var(--text-faint)]">·</span>
              <span>World #{profile.rank}</span>
            </div>
            <div className="mt-[11px]">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--accent-soft)] px-2.5 py-1 text-xs text-[var(--text-strong)]">
                <Zap className="h-[13px] w-[13px] text-[var(--accent)]" />
                {profile.style}
              </span>
            </div>
          </div>
          <div className="relative flex items-center gap-[22px]">
            <div className="text-right">
              <div className="font-display text-[30px] font-semibold tracking-[-0.02em] tabular-nums text-[var(--text-strong)]">
                {profile.wins}–{profile.losses}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
                career W–L
              </div>
            </div>
            <div className="text-right">
              <div className="font-display text-[30px] font-semibold tracking-[-0.02em] tabular-nums text-[var(--warning-400,#fcd34d)]">
                {profile.titles}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
                titles
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          {
            k: "Win rate",
            v: `${profile.winRate}%`,
            c: "text-[var(--success-500)]",
          },
          { k: "Matches", v: String(profile.matches) },
          {
            k: "Max smash",
            v: `${profile.fastestSmash}`,
            c: "text-[var(--danger-500)]",
          },
          {
            k: "Attack %",
            v: `${profile.attackPct}%`,
            c: "text-[var(--accent)]",
          },
          { k: "Avg rally", v: String(profile.avgRally) },
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

      <div className="mb-3.5 grid gap-3.5 lg:grid-cols-3">
        <div className="rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-4">
          <div className="mb-[15px] text-[13px] font-medium text-[var(--text-strong)]">
            Shot type mix
          </div>
          <div className="space-y-2.5">
            {profile.mix.map((s) => (
              <div key={s.type} className="flex items-center gap-2.5">
                <span
                  className="h-2 w-2 shrink-0 rounded-sm"
                  style={{
                    background: typeColor(s.type),
                  }}
                />
                <span className="w-14 font-mono text-[11px] text-[var(--text-muted)]">
                  {s.type}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${s.pct}%`,
                      background: typeColor(s.type),
                    }}
                  />
                </div>
                <span className="w-8 text-right font-mono text-[11px] tabular-nums text-[var(--text-secondary)]">
                  {s.pct}%
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-4">
          <div className="mb-4 text-[13px] font-medium text-[var(--text-strong)]">
            Rally length distribution
          </div>
          <div className="flex h-[120px] items-end gap-2">
            {profile.dist.map((v, i) => {
              const labels = ["1–4", "5–8", "9–12", "13–18", "19+"];
              const max = Math.max(...profile.dist);
              return (
                <div
                  key={labels[i]}
                  className="flex flex-1 flex-col items-center gap-1.5"
                >
                  <div
                    className="w-full rounded-t bg-[var(--accent)] opacity-80"
                    style={{ height: `${(v / max) * 90}px` }}
                  />
                  <span className="font-mono text-[9px] text-[var(--text-faint)]">
                    {labels[i]}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-4">
          <div className="mb-[15px] text-[13px] font-medium text-[var(--text-strong)]">
            Tactical profile
          </div>
          <div className="space-y-3">
            {[
              {
                k: "Attack rate",
                v: profile.attackPct,
                c: "var(--accent)",
              },
              {
                k: "Cross-court",
                v: profile.crossPct,
                c: "var(--viz-5, #b07bff)",
              },
              {
                k: "Forehand share",
                v: profile.fhPct,
                c: "var(--success-500)",
              },
              {
                k: "Net winners",
                v: profile.netWinPct,
                c: "var(--cyan-500, #50deff)",
              },
            ].map((row) => (
              <div key={row.k}>
                <div className="mb-1 flex justify-between font-mono text-[11px]">
                  <span className="text-[var(--text-muted)]">{row.k}</span>
                  <span className="tabular-nums text-[var(--text-strong)]">
                    {row.v}%
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${row.v}%`, background: row.c }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-3.5 grid gap-3.5 lg:grid-cols-[0.9fr_1.1fr_1fr]">
        <div className="rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[13px] font-medium text-[var(--text-strong)]">
              Court coverage
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
              shot volume
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {profile.zones.map((z, i) => {
              const max = Math.max(...profile.zones);
              const opacity = 0.25 + (z / max) * 0.75;
              return (
                <div
                  key={i}
                  className="flex aspect-[4/3] items-center justify-center rounded-md border border-[var(--border-subtle)] font-mono text-[11px] tabular-nums text-[var(--text-strong)]"
                  style={{
                    background: `rgba(54,147,255,${opacity * 0.35})`,
                  }}
                >
                  {z}
                </div>
              );
            })}
          </div>
        </div>
        <div className="rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-4">
          <div className="mb-3.5 text-[13px] font-medium text-[var(--text-strong)]">
            Recent form{" "}
            <span className="font-mono text-[11px] font-normal text-[var(--text-muted)]">
              — last 10
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {profile.form.map((f, i) => (
              <span
                key={i}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-lg font-mono text-xs font-semibold",
                  f === "W"
                    ? "bg-[rgba(45,212,167,0.16)] text-[var(--success-500)]"
                    : "bg-[rgba(244,81,92,0.14)] text-[var(--danger-500)]",
                )}
              >
                {f}
              </span>
            ))}
          </div>
        </div>
        <div className="rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-4">
          <div className="mb-3.5 flex items-center justify-between">
            <span className="text-[13px] font-medium text-[var(--text-strong)]">
              Top rivalries
            </span>
            {defaultOpp ? (
              <Link
                href={`/bwf/h2h?a=${profile.id}&b=${defaultOpp.id}`}
                className="text-xs text-[var(--text-link)] hover:text-[var(--accent)]"
              >
                Compare
              </Link>
            ) : null}
          </div>
          <div className="space-y-2">
            {PLAYERS.filter(
              (p) => p.disc === profile.disc && p.id !== profile.id,
            )
              .slice(0, 4)
              .map((opp) => {
                const r = h2hRecord(profile.id, opp.id);
                return (
                  <Link
                    key={opp.id}
                    href={`/bwf/h2h?a=${profile.id}&b=${opp.id}`}
                    className="flex w-full items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2 text-left hover:border-[var(--border)]"
                  >
                    <span className="text-[13px] text-[var(--text-strong)]">
                      {opp.name}
                    </span>
                    <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                      {r.aWins}–{r.bWins}
                    </span>
                  </Link>
                );
              })}
          </div>
        </div>
      </div>

      <div className="rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] px-[18px] py-4">
        <div className="mb-1 text-[13px] font-medium text-[var(--text-strong)]">
          Recent matches
        </div>
        <div className="mt-3 space-y-2">
          {MATCHES.filter((m) => m.a === profile.id || m.b === profile.id)
            .slice(0, 5)
            .map((m) => {
              const isA = m.a === profile.id;
              const opp = isA ? m.pb : m.pa;
              const won = (isA && m.w === "a") || (!isA && m.w === "b");
              return (
                <Link
                  key={m.id}
                  href="/video-analysis"
                  className="flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2.5 hover:border-[var(--border)]"
                >
                  <span
                    className={cn(
                      "inline-flex h-6 w-6 items-center justify-center rounded-md font-mono text-[10px] font-semibold",
                      won
                        ? "bg-[rgba(45,212,167,0.16)] text-[var(--success-500)]"
                        : "bg-[rgba(244,81,92,0.14)] text-[var(--danger-500)]",
                    )}
                  >
                    {won ? "W" : "L"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-strong)]">
                    vs {opp.name}
                  </span>
                  <span className="font-mono text-[11px] text-[var(--text-muted)]">
                    {m.event}
                  </span>
                  <span className="font-mono text-[11px] text-[var(--text-faint)]">
                    {m.date}
                  </span>
                </Link>
              );
            })}
        </div>
      </div>
    </section>
  );
}
