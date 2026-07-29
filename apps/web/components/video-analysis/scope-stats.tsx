"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  MoveRight,
  Pause,
  Play,
  Share2,
  SkipBack,
  SkipForward,
  Sparkles,
} from "lucide-react";
import { Tabs } from "@/components/ui/tabs";
import type { Rally, Shot } from "@/lib/video-analysis/rallies";
import { RALLIES } from "@/lib/video-analysis/rallies";
import type { AnalysisScope } from "@/lib/video-analysis/stats";
import { cn } from "@/lib/utils";

type LengthBucket = { label: string; n: number; h: number };
type TypeMix = { type: string; pct: number; n: number };

type ScopeStatsProps = {
  scope: AnalysisScope;
  onScopeChange: (scope: AnalysisScope) => void;
  active: Rally;
  activeShot: Shot | undefined;
  shotIdx: number;
  setShotIdx: (v: number | ((i: number) => number)) => void;
  allShotCount: number;
  pace: string;
  typeMix: TypeMix[];
  lengthBuckets: LengthBucket[];
  shared: boolean;
  shareLabel: string;
  onShare: () => void;
  goPrevRally: () => void;
  goNextRally: () => void;
  playing: boolean;
  togglePlay: () => void;
};

export function ScopeStats({
  scope,
  onScopeChange,
  active,
  activeShot,
  shotIdx,
  setShotIdx,
  allShotCount,
  pace,
  typeMix,
  lengthBuckets,
  shared,
  shareLabel,
  onShare,
  goPrevRally,
  goNextRally,
  playing,
  togglePlay,
}: ScopeStatsProps) {
  return (
    <section className="overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-edge)]">
      <div className="flex flex-wrap items-center gap-x-[18px] gap-y-3.5 border-b border-[var(--border-subtle)] px-[18px] py-[15px]">
        <div className="min-w-[180px] flex-1">
          <div className="font-display text-base font-semibold text-[var(--text-strong)]">
            {scope === "match"
              ? "Match overview"
              : scope === "shot"
                ? `Shot ${shotIdx + 1} · ${activeShot?.type ?? "—"}`
                : `Rally ${String(active.n).padStart(2, "0")}`}
          </div>
          <div className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
            {scope === "match"
              ? `${RALLIES.length} rallies · ${allShotCount} shots tracked`
              : scope === "shot"
                ? `${activeShot?.side ?? "—"} · ${activeShot?.speed ? `${activeShot.speed} km/h` : "pace shot"} · Rally ${String(active.n).padStart(2, "0")}`
                : `${active.shots} shots · ${active.dur}s · won by Axelsen`}
          </div>
        </div>
        {scope !== "match" ? (
          <div className="inline-flex items-center gap-0.5 rounded-[9px] border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
            <button
              type="button"
              aria-label="Previous rally"
              onClick={goPrevRally}
              className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-strong)]"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="whitespace-nowrap px-2 font-mono text-[11.5px] tabular-nums text-[var(--text-strong)]">
              Rally {String(active.n).padStart(2, "0")} /{" "}
              {String(RALLIES.length).padStart(2, "0")}
            </span>
            <button
              type="button"
              aria-label="Next rally"
              onClick={goNextRally}
              className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-strong)]"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        ) : null}
        <button
          type="button"
          onClick={onShare}
          className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[var(--border)] bg-[var(--surface-2)] px-3 text-[13px] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]"
        >
          {shared ? (
            <>
              <Check className="h-[15px] w-[15px] text-[var(--success-500)]" />
              <span className="text-[var(--success-500)]">Link copied</span>
            </>
          ) : (
            <>
              <Share2 className="h-[15px] w-[15px]" />
              {shareLabel}
            </>
          )}
        </button>
        <Tabs<AnalysisScope>
          variant="pill"
          value={scope}
          onChange={onScopeChange}
          items={[
            { value: "match", label: "Match" },
            { value: "rally", label: "This rally" },
            { value: "shot", label: "This shot" },
          ]}
        />
      </div>

      <div className="p-[18px]">
        {/* Hero tiles */}
        <div className="mb-[18px] grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(scope === "match"
            ? [
                { k: "Rallies", v: String(RALLIES.length), u: "" },
                { k: "Total shots", v: String(allShotCount), u: "" },
                {
                  k: "Avg rally",
                  v: (allShotCount / RALLIES.length).toFixed(1),
                  u: "shots",
                },
                {
                  k: "Winners",
                  v: String(RALLIES.filter((r) => r.tone === "success").length),
                  u: "",
                  accent: true,
                },
              ]
            : scope === "shot"
              ? [
                  {
                    k: "Stroke",
                    v: activeShot?.type ?? "—",
                    u: "",
                    accent: true,
                  },
                  { k: "Side", v: activeShot?.side ?? "—", u: "" },
                  {
                    k: "Speed",
                    v: activeShot?.speed ? String(activeShot.speed) : "—",
                    u: activeShot?.speed ? "km/h" : "",
                  },
                  { k: "Index", v: String(shotIdx + 1), u: `/ ${active.shots}` },
                ]
              : [
                  { k: "Rally length", v: String(active.shots), u: "shots" },
                  { k: "Duration", v: String(active.dur), u: "s" },
                  { k: "Pace", v: pace, u: "s / shot" },
                  { k: "Ended with", v: active.end, u: "", accent: true },
                ]
          ).map((s) => (
            <div
              key={s.k}
              className="rounded-[11px] border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4"
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
                {s.k}
              </div>
              <div
                className={cn(
                  "mt-2 font-display text-[28px] font-semibold tracking-[-0.02em] tabular-nums",
                  s.accent ? "text-[var(--accent)]" : "text-[var(--text-strong)]",
                )}
              >
                {s.v}
                {s.u ? (
                  <span className="ml-1.5 text-[13px] font-normal text-[var(--text-muted)]">
                    {s.u}
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        {/* Match scope */}
        {scope === "match" ? (
          <div className="grid gap-3.5 lg:grid-cols-[1.3fr_1fr_1fr]">
            <div className="rounded-[11px] border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4">
              <div className="mb-4 text-[13px] font-medium text-[var(--text-strong)]">
                Rally length distribution
              </div>
              <div className="flex h-[120px] items-end gap-2">
                {lengthBuckets.map((b) => (
                  <div
                    key={b.label}
                    className="flex flex-1 flex-col items-center gap-1.5"
                  >
                    <span className="font-mono text-[10px] text-[var(--text-muted)]">
                      {b.n}
                    </span>
                    <div
                      className="w-full rounded-t-md bg-[var(--accent)]/70"
                      style={{ height: `${Math.max(8, b.h)}%` }}
                    />
                    <span className="font-mono text-[10px] text-[var(--text-faint)]">
                      {b.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-[11px] border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4">
              <div className="mb-3.5 text-[13px] font-medium text-[var(--text-strong)]">
                Shot type mix
              </div>
              <div className="flex flex-col gap-2.5">
                {typeMix.map((m) => (
                  <div key={m.type}>
                    <div className="mb-1 flex items-center justify-between text-[12px]">
                      <span className="text-[var(--text-secondary)]">{m.type}</span>
                      <span className="font-mono tabular-nums text-[var(--text-muted)]">
                        {m.pct}%
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
                      <div
                        className="h-full rounded-full bg-[var(--accent)]"
                        style={{ width: `${m.pct}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-[11px] border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4">
              <div className="mb-3.5 text-[13px] font-medium text-[var(--text-strong)]">
                Tactical splits
              </div>
              <div className="flex flex-col gap-3">
                {[
                  { label: "Attack share", value: "34%" },
                  { label: "Forehand", value: "58%" },
                  { label: "Cross-court", value: "41%" },
                  { label: "Longest rally", value: "18 shots" },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between text-[13px]"
                  >
                    <span className="text-[var(--text-secondary)]">{row.label}</span>
                    <span className="font-mono tabular-nums text-[var(--text-strong)]">
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {/* Rally scope */}
        {scope === "rally" ? (
          <div className="grid gap-3.5 lg:grid-cols-[1.5fr_1fr]">
            <div className="rounded-[11px] border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4">
              <div className="mb-[15px] flex items-center gap-2">
                <span className="text-[13px] font-medium text-[var(--text-strong)]">
                  Shot sequence
                </span>
                <span className="font-mono text-[11px] text-[var(--text-muted)]">
                  — the rally, stroke by stroke
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {active.sequence.map((s, idx) => (
                  <div key={s.i} className="contents">
                    <button
                      type="button"
                      onClick={() => {
                        setShotIdx(idx);
                        onScopeChange("shot");
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1 text-[12px] text-[var(--text-strong)] hover:border-[var(--accent)]"
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: s.color }}
                      />
                      {s.type}
                    </button>
                    {idx < active.sequence.length - 1 ? (
                      <span className="text-[13px] text-[var(--text-faint)]">›</span>
                    ) : null}
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-2 rounded-[9px] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2.5">
                <Sparkles className="h-[15px] w-[15px] shrink-0 text-[var(--text-muted)]" />
                <span className="text-[12.5px] text-[var(--text-primary)]">
                  {active.sequence.length >= 2
                    ? `${active.sequence[active.sequence.length - 2].type} → ${active.sequence[active.sequence.length - 1].type} finished the rally for Axelsen.`
                    : "Single-shot rally."}
                </span>
              </div>
            </div>
            <div className="rounded-[11px] border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4">
              <div className="mb-3.5 text-[13px] font-medium text-[var(--text-strong)]">
                In this rally
              </div>
              <div className="flex flex-col gap-3">
                {[
                  {
                    label: "Player A shots",
                    value: String(Math.ceil(active.shots / 2)),
                  },
                  {
                    label: "Player B shots",
                    value: String(Math.floor(active.shots / 2)),
                  },
                  {
                    label: "Forehand share",
                    value: `${Math.round(
                      (active.sequence.filter((s) => s.side === "FH").length /
                        active.shots) *
                        100,
                    )}%`,
                  },
                  {
                    label: "Smashes",
                    value: String(
                      active.sequence.filter((s) =>
                        s.type.toLowerCase().includes("smash"),
                      ).length,
                    ),
                  },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between text-[13px]"
                  >
                    <span className="text-[var(--text-secondary)]">{row.label}</span>
                    <span className="font-mono tabular-nums text-[var(--text-strong)]">
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {/* Shot scope */}
        {scope === "shot" ? (
          <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1.1fr)_1fr]">
            <div className="rounded-[11px] border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[13px] font-medium text-[var(--text-strong)]">
                  3D shot view
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
                  court · shuttle · players
                </span>
              </div>
              <div
                className="relative aspect-[4/3] overflow-hidden rounded-[10px] border border-[var(--border)] bg-[linear-gradient(160deg,#0c1426,#070d1a)]"
                style={{ perspective: 900 }}
              >
                <div
                  className="absolute left-1/2 top-1/2 h-[220px] w-[130px] origin-center"
                  style={{
                    transform:
                      "translate(-50%, -50%) scale(0.95) rotateX(58deg) rotateZ(-8deg)",
                    transformStyle: "preserve-3d",
                  }}
                >
                  <div className="absolute inset-0 rounded border-2 border-[rgba(80,222,255,0.45)] bg-[linear-gradient(180deg,rgba(80,222,255,0.08),rgba(54,147,255,0.03))]" />
                  <div className="absolute bottom-0 left-[8%] top-0 border-l border-[rgba(80,222,255,0.22)]" />
                  <div className="absolute bottom-0 right-[8%] top-0 border-r border-[rgba(80,222,255,0.22)]" />
                  <div className="absolute left-0 right-0 top-[36%] border-t border-[rgba(80,222,255,0.28)]" />
                  <div className="absolute left-0 right-0 top-[64%] border-t border-[rgba(80,222,255,0.28)]" />
                  <div className="absolute left-[6%] right-[6%] top-1/2 border-t border-dashed border-white/30" />
                  {/* trajectory arc */}
                  <svg
                    className="absolute inset-0 h-full w-full overflow-visible"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                  >
                    <path
                      d="M 30 28 Q 55 12 72 68"
                      fill="none"
                      stroke={activeShot?.color ?? "var(--accent)"}
                      strokeWidth="1.4"
                      strokeDasharray="3 2"
                      strokeLinecap="round"
                    />
                    <circle cx="30" cy="28" r="2.2" fill="var(--player-a)" />
                    <circle
                      cx="72"
                      cy="68"
                      r="2.6"
                      fill="#fff"
                      stroke={activeShot?.color ?? "var(--cyan-500)"}
                      strokeWidth="1"
                    />
                  </svg>
                  <div className="absolute left-[28%] top-[26%] h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--player-a)] shadow-[0_0_10px_rgba(54,147,255,0.6)]" />
                  <div className="absolute left-[58%] top-[74%] h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--player-b)] shadow-[0_0_10px_rgba(251,191,36,0.5)]" />
                </div>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-4 font-mono text-[11px] text-[var(--text-muted)]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-0.5 w-2.5 rounded-sm bg-[var(--player-a)]" />
                  Axelsen
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-0.5 w-2.5 rounded-sm bg-[var(--player-b)]" />
                  Momota
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="h-0.5 w-2.5 rounded-sm"
                    style={{ background: activeShot?.color ?? "var(--accent)" }}
                  />
                  {activeShot?.type ?? "Shot"} trajectory
                </span>
              </div>
              <div className="mt-3 flex flex-col gap-2.5 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label="Previous shot"
                    onClick={() => setShotIdx((i) => Math.max(0, i - 1))}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)]"
                  >
                    <SkipBack className="h-[15px] w-[15px]" />
                  </button>
                  <button
                    type="button"
                    aria-label={playing ? "Pause" : "Play"}
                    onClick={togglePlay}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)] text-white"
                  >
                    {playing ? (
                      <Pause className="h-4 w-4" />
                    ) : (
                      <Play className="ml-0.5 h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label="Next shot"
                    onClick={() =>
                      setShotIdx((i) =>
                        Math.min(active.sequence.length - 1, i + 1),
                      )
                    }
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)]"
                  >
                    <SkipForward className="h-[15px] w-[15px]" />
                  </button>
                  <span className="font-mono text-[11.5px] tabular-nums text-[var(--text-secondary)]">
                    Shot {shotIdx + 1} / {active.shots}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={active.shots}
                  value={shotIdx + 1}
                  onChange={(e) => setShotIdx(Number(e.target.value) - 1)}
                  aria-label="Scrub shots in rally"
                  className="w-full cursor-pointer accent-[var(--accent)]"
                />
              </div>
            </div>

            <div className="rounded-[11px] border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4">
              <div className="mb-3.5 text-[13px] font-medium text-[var(--text-strong)]">
                Shot detail
              </div>
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-[var(--border-subtle)] bg-[var(--border-subtle)]">
                {[
                  {
                    label: "Stroke",
                    value: activeShot?.type ?? "—",
                    color: activeShot?.color,
                  },
                  { label: "Side", value: activeShot?.side ?? "—" },
                  {
                    label: "Speed",
                    value: activeShot?.speed
                      ? `${activeShot.speed} km/h`
                      : "—",
                  },
                  {
                    label: "Rally pos",
                    value: `${shotIdx + 1} of ${active.shots}`,
                  },
                ].map((cell) => (
                  <div key={cell.label} className="bg-[var(--surface-1)] px-3 py-3">
                    <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
                      {cell.label}
                    </div>
                    <div
                      className="mt-1 text-sm font-medium text-[var(--text-strong)]"
                      style={cell.color ? { color: cell.color } : undefined}
                    >
                      {cell.value}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2 rounded-[9px] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2.5">
                <MoveRight className="h-[15px] w-[15px] shrink-0 text-[var(--text-muted)]" />
                <span className="text-[12.5px] text-[var(--text-secondary)]">
                  {activeShot?.type?.toLowerCase().includes("smash")
                    ? "Steep attack into the deep backhand corner."
                    : activeShot?.type?.toLowerCase().includes("drop")
                      ? "Tight drop targeting the front tramlines."
                      : "Trajectory reconstructed from calibrated court space."}
                </span>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
