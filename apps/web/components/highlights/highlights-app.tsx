"use client";

import Link from "next/link";
import {
  Check,
  CheckCircle2,
  Clapperboard,
  Film,
  Flag,
  Gauge,
  Layers,
  Play,
  Plus,
  Smartphone,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { AppTopbar } from "@/components/app/app-topbar";
import { CourtDot } from "@/components/charts/court-dot";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import {
  EMPH,
  QUICK,
  emphWeights,
  parseQuery,
  passes,
  pickReason,
  scoreMoment,
  type EmphKey,
} from "@/lib/highlights/query";
import { MOMENTS, type Moment, type ReasonKey } from "@/lib/highlights/moments";
import { REELS } from "@/lib/highlights/reels";
import { cn } from "@/lib/utils";

const REASON_STYLE: Record<
  ReasonKey,
  { icon: typeof Gauge; tone: BadgeTone; color: string }
> = {
  rec: { icon: Gauge, tone: "success", color: "#2dd4a7" },
  ctx: { icon: Flag, tone: "warning", color: "#fbbf24" },
  qua: { icon: Clapperboard, tone: "cyan", color: "#50deff" },
  top: { icon: Star, tone: "brand", color: "#3693ff" },
};

function durLabel(secs: number) {
  return `0:${String(secs).padStart(2, "0")}`;
}

function fmtSecs(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function ReasonIcon({ k, className }: { k: ReasonKey; className?: string }) {
  const Icon = REASON_STYLE[k].icon;
  return <Icon className={className} />;
}

function MomentThumb({
  m,
  large,
}: {
  m: Moment;
  large?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden bg-[linear-gradient(160deg,#0f1b34_0%,#070b16_100%)]",
        large ? "aspect-[16/8.4]" : "aspect-video",
      )}
    >
      <span
        className="absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 28%, rgba(54,147,255,0.16) 28%, rgba(54,147,255,0.16) calc(28% + 1px), transparent calc(28% + 1px)), linear-gradient(90deg, transparent 72%, rgba(54,147,255,0.16) 72%, rgba(54,147,255,0.16) calc(72% + 1px), transparent calc(72% + 1px)), linear-gradient(180deg, transparent calc(50% - 1px), rgba(154,168,194,0.28) 50%, transparent calc(50% + 1px))",
        }}
      />
      <CourtDot x={m.dotX} y={m.dotY} size={large ? 10 : 8} />
      <span className="absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_42%,rgba(54,147,255,0.10),transparent_70%)]" />
      <span className="absolute top-2.5 left-2.5 rounded-full border border-[var(--border)] bg-[rgba(7,11,22,0.72)] px-2 py-0.5 font-mono text-[10px] tracking-[0.06em] text-[var(--text-secondary)] backdrop-blur-[6px]">
        {m.speed
          ? `${m.type} · ${m.speed} km/h`
          : m.kind === "rally"
            ? `Rally · ${m.rallyLen} shots`
            : `${m.type} · winner`}
      </span>
      <span className="absolute right-2.5 bottom-2 rounded border border-[var(--border)] bg-[rgba(7,11,22,0.78)] px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--text-strong)]">
        {durLabel(m.dur)}
      </span>
      {large ? (
        <span className="absolute top-1/2 left-1/2 inline-flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[rgba(54,147,255,0.92)] text-white shadow-[var(--glow-blue)]">
          <Play className="ml-0.5 h-5 w-5" />
        </span>
      ) : null}
    </div>
  );
}

export function HighlightsApp() {
  const [query, setQuery] = useState("");
  const [emph, setEmph] = useState<EmphKey>("balanced");
  const [chips, setChips] = useState<string[]>([]);
  const [sort, setSort] = useState("best");
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState("");

  const ranked = useMemo(() => {
    const w = emphWeights(emph);
    return MOMENTS.slice().sort(
      (a, b) => scoreMoment(b, w) - scoreMoment(a, w),
    );
  }, [emph]);
  const disc = ranked.slice(0, 4);
  const hero = disc[0];
  const discRows = disc.slice(1, 4);

  const filtered = useMemo(() => {
    const f = parseQuery(query);
    const chipFs = QUICK.filter((c) => chips.includes(c.id)).map((c) => c.f);
    let list = MOMENTS.filter(
      (m) => passes(m, f) && chipFs.every((cf) => passes(m, cf)),
    );
    if (sort === "best") {
      const w = emphWeights(emph);
      list = list
        .slice()
        .sort((a, b) => scoreMoment(b, w) - scoreMoment(a, w));
    } else if (sort === "fastest")
      list = list.slice().sort((a, b) => (b.speed || 0) - (a.speed || 0));
    else if (sort === "longest")
      list = list.slice().sort((a, b) => b.rallyLen - a.rallyLen);
    else list = list.slice().sort((a, b) => b.ord - a.ord);
    return list;
  }, [query, chips, sort, emph]);

  const parsedChips = useMemo(() => {
    const f = parseQuery(query);
    const out: string[] = [];
    f.types?.forEach((t) => out.push(`type: ${t.toLowerCase()}`));
    if (f.speedMin) out.push(`≥ ${f.speedMin} km/h`);
    if (f.rallyMin) out.push(`rally ≥ ${f.rallyMin}`);
    if (f.outcome) out.push("winners");
    if (f.kind === "rally") out.push("rallies");
    f.ctx?.forEach((t) => out.push(t));
    f.free?.forEach((t) => out.push(`“${t}”`));
    return out;
  }, [query]);

  const selIds = Object.keys(sel).filter((id) => sel[id]);
  const selSecs = selIds.reduce((a, id) => {
    const m = MOMENTS.find((x) => x.id === id);
    return a + (m ? m.dur : 0);
  }, 0);
  const matchCount = new Set(MOMENTS.map((m) => m.match)).size;

  const toggleSel = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    setSel((s) => {
      const next = { ...s };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });
  };

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2600);
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
      <AppTopbar
        title="Highlights"
        subtitle={`${MOMENTS.length} moments indexed · ${matchCount} matches`}
        searchPlaceholder="Search moments…"
        showBell={false}
        showAccount={false}
        searchValue={query}
        onSearchChange={setQuery}
        onSearchClear={() => setQuery("")}
        actions={
          <Link href="/video-analysis">
            <Button size="md">New reel</Button>
          </Link>
        }
      />

      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-[26px] px-7 pt-6 pb-10">
        {/* Discovery */}
        <section className="flex flex-col gap-[13px]">
          <div className="flex flex-wrap items-center gap-2.5">
            <Sparkles className="h-4 w-4 text-[var(--accent)]" />
            <h2 className="font-display text-[15px] font-semibold text-[var(--text-strong)]">
              Worth a second look
            </h2>
            <span className="font-mono text-[11.5px] text-[var(--text-muted)]">
              — ranked by the engine, each with a reason
            </span>
            <div className="flex-1" />
            <Segmented
              value={emph}
              onChange={setEmph}
              options={EMPH.map((t) => ({ id: t.v, label: t.label }))}
            />
          </div>

          <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            {hero ? (
              <article
                className={cn(
                  "relative flex flex-col overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-edge)]",
                  sel[hero.id] && "ring-1 ring-[var(--accent)]",
                )}
              >
                <Link href="/video-analysis">
                  <MomentThumb m={hero} large />
                </Link>
                <div className="flex flex-1 flex-col gap-2 px-4 pt-[15px] pb-4">
                  {(() => {
                    const pr = pickReason(hero, emph);
                    const st = REASON_STYLE[pr.k];
                    return (
                      <Badge tone={st.tone} pill className="self-start">
                        <ReasonIcon k={pr.k} className="h-[13px] w-[13px]" />
                        {pr.label}
                      </Badge>
                    );
                  })()}
                  <div className="font-display text-[17px] font-semibold text-[var(--text-strong)]">
                    {hero.title}
                  </div>
                  <div className="font-mono text-[11.5px] text-[var(--text-muted)]">
                    {hero.match} · {hero.round} · {hero.score}
                  </div>
                  <div className="mt-auto flex items-center gap-2 border-t border-[var(--border-subtle)] pt-2.5">
                    <button
                      type="button"
                      onClick={(e) => toggleSel(hero.id, e)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px]",
                        sel[hero.id]
                          ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                          : "border-[var(--border)] bg-transparent text-[var(--text-primary)] hover:border-[var(--accent)]",
                      )}
                    >
                      {sel[hero.id] ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                      {sel[hero.id] ? "In queue" : "Add to reel"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        showToast(`Exporting 9:16 · ${hero.title}`)
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-[12.5px] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]"
                    >
                      <Smartphone className="h-3.5 w-3.5" />
                      Export 9:16
                    </button>
                  </div>
                </div>
              </article>
            ) : null}

            <div className="flex flex-col gap-3">
              {discRows.map((d) => {
                const pr = pickReason(d, emph);
                const st = REASON_STYLE[pr.k];
                return (
                  <article
                    key={d.id}
                    className={cn(
                      "relative flex flex-1 cursor-pointer gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-2.5 hover:bg-[var(--surface-2)]",
                      sel[d.id] && "ring-1 ring-[var(--accent)]",
                    )}
                  >
                    <Link
                      href="/video-analysis"
                      className="relative w-32 shrink-0 overflow-hidden rounded-lg bg-[linear-gradient(160deg,#0f1b34_0%,#070b16_100%)]"
                    >
                      <span
                        className="absolute inset-0 opacity-50"
                        style={{
                          backgroundImage:
                            "linear-gradient(90deg, transparent 28%, rgba(54,147,255,0.16) 28%, rgba(54,147,255,0.16) calc(28% + 1px), transparent calc(28% + 1px)), linear-gradient(90deg, transparent 72%, rgba(54,147,255,0.16) 72%, rgba(54,147,255,0.16) calc(72% + 1px), transparent calc(72% + 1px)), linear-gradient(180deg, transparent calc(50% - 1px), rgba(154,168,194,0.28) 50%, transparent calc(50% + 1px))",
                        }}
                      />
                      <CourtDot x={d.dotX} y={d.dotY} size={7} />
                      <span className="absolute right-1.5 bottom-1 rounded bg-[rgba(7,11,22,0.78)] px-1 font-mono text-[10px] text-[var(--text-strong)]">
                        {durLabel(d.dur)}
                      </span>
                    </Link>
                    <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
                      <span
                        className="flex min-w-0 items-center gap-1 font-mono text-[10.5px] tracking-[0.03em]"
                        style={{ color: st.color }}
                      >
                        <ReasonIcon k={pr.k} className="h-3 w-3 shrink-0" />
                        <span className="truncate">{pr.label}</span>
                      </span>
                      <div className="truncate text-[13.5px] font-semibold text-[var(--text-strong)]">
                        {d.title}
                      </div>
                      <div className="truncate font-mono text-[11px] text-[var(--text-muted)]">
                        {d.match} · {d.round}
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label={sel[d.id] ? "Remove from queue" : "Add to queue"}
                      onClick={(e) => toggleSel(d.id, e)}
                      className={cn(
                        "inline-flex h-[30px] w-[30px] shrink-0 self-center items-center justify-center rounded-full",
                        sel[d.id]
                          ? "bg-[var(--accent)] text-white"
                          : "border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]",
                      )}
                    >
                      {sel[d.id] ? (
                        <Check className="h-[15px] w-[15px]" />
                      ) : (
                        <Plus className="h-[15px] w-[15px]" />
                      )}
                    </button>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* Moment index */}
        <section className="flex flex-col gap-[13px]">
          <div className="flex items-baseline gap-2.5">
            <h2 className="font-display text-[15px] font-semibold text-[var(--text-strong)]">
              All moments
            </h2>
            <span className="font-mono text-[11.5px] text-[var(--text-muted)]">
              {filtered.length} of {MOMENTS.length}
            </span>
          </div>

          {query.trim() && parsedChips.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10.5px] tracking-[0.1em] text-[var(--text-faint)] uppercase">
                From your search
              </span>
              {parsedChips.map((c) => (
                <span
                  key={c}
                  className="inline-flex items-center rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-2 py-0.5 font-mono text-[11px] text-[var(--accent)]"
                >
                  {c}
                </span>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {QUICK.map((c) => {
              const active = chips.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() =>
                    setChips((s) =>
                      s.includes(c.id)
                        ? s.filter((x) => x !== c.id)
                        : [...s, c.id],
                    )
                  }
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px]",
                    active
                      ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                      : "border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--text-strong)]",
                  )}
                >
                  {active ? <Check className="h-[13px] w-[13px]" /> : null}
                  {c.label}
                </button>
              );
            })}
            <div className="flex-1" />
            <span className="font-mono text-[11px] tracking-[0.1em] text-[var(--text-faint)] uppercase">
              Sort
            </span>
            <div className="w-40">
              <Select
                size="sm"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                options={[
                  { value: "best", label: "Best first" },
                  { value: "fastest", label: "Fastest shot" },
                  { value: "longest", label: "Longest rally" },
                  { value: "recent", label: "Most recent" },
                ]}
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-[13px] border border-dashed border-[var(--border)] px-4 py-10 text-center">
              <div className="text-sm text-[var(--text-secondary)]">
                No moments match this search.
              </div>
              <div className="mt-1 font-mono text-xs text-[var(--text-muted)]">
                Try fewer filters — or a phrase like &ldquo;smash over 300&rdquo;.
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {filtered.map((m) => {
                const pr = pickReason(m, emph);
                const st = REASON_STYLE[pr.k];
                return (
                  <article
                    key={m.id}
                    className={cn(
                      "relative flex flex-col overflow-hidden rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-edge)] transition-colors hover:border-[var(--border-strong)]",
                      sel[m.id] && "ring-1 ring-[var(--accent)]",
                    )}
                  >
                    <div className="relative">
                      <Link href="/video-analysis">
                        <MomentThumb m={m} />
                      </Link>
                      <button
                        type="button"
                        aria-label={
                          sel[m.id] ? "Remove from queue" : "Add to queue"
                        }
                        onClick={(e) => toggleSel(m.id, e)}
                        className={cn(
                          "absolute top-2 right-2 z-10 inline-flex h-[27px] w-[27px] items-center justify-center rounded-full",
                          sel[m.id]
                            ? "bg-[var(--accent)] text-white shadow-[0_0_14px_rgba(54,147,255,0.5)]"
                            : "border border-[var(--border)] bg-[rgba(7,11,22,0.72)] text-[var(--text-secondary)] backdrop-blur-sm hover:border-[var(--accent)] hover:text-[var(--accent)]",
                        )}
                      >
                        {sel[m.id] ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Plus className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                    <div className="flex flex-1 flex-col gap-1.5 px-[13px] pt-3 pb-[13px]">
                      <Badge tone={st.tone} pill className="self-start">
                        <ReasonIcon k={pr.k} className="h-3 w-3" />
                        {pr.label}
                      </Badge>
                      <div className="truncate text-[13.5px] font-semibold text-[var(--text-strong)]">
                        {m.title}
                      </div>
                      <div className="truncate font-mono text-[11px] text-[var(--text-muted)]">
                        {m.match} · {m.round} · {m.score}
                      </div>
                      <div className="mt-auto flex items-center gap-2 border-t border-[var(--border-subtle)] pt-2 font-mono text-[11px] text-[var(--text-muted)]">
                        <span>{m.t}</span>
                        <div className="flex-1" />
                        <button
                          type="button"
                          onClick={() =>
                            showToast(`Exporting 9:16 · ${m.title}`)
                          }
                          className="inline-flex items-center gap-1 rounded-[7px] px-2 py-1 font-mono text-[10.5px] text-[var(--text-muted)] hover:border hover:border-[var(--border)] hover:bg-[var(--surface-2)] hover:text-[var(--text-strong)]"
                        >
                          <Smartphone className="h-[13px] w-[13px]" />
                          9:16
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* Saved reels */}
        <section className="flex flex-col gap-3 border-t border-[var(--border-subtle)] pt-[18px]">
          <div className="flex items-center gap-2">
            <Film className="h-[15px] w-[15px] text-[var(--text-muted)]" />
            <h2 className="font-display text-sm font-semibold text-[var(--text-strong)]">
              Saved reels
            </h2>
            <span className="font-mono text-[11px] text-[var(--text-muted)]">
              {REELS.length} reels
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {REELS.map((r) => (
              <Link
                key={r.id}
                href="/video-analysis"
                className="flex flex-col gap-1.5 rounded-[11px] border border-[var(--border)] bg-[var(--surface-1)] px-[13px] py-3 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]"
              >
                <span className="truncate text-[13px] font-semibold text-[var(--text-strong)]">
                  {r.title}
                </span>
                <span className="truncate font-mono text-[10.5px] text-[var(--text-muted)]">
                  {r.criteriaLabel}
                </span>
                <span className="flex items-center gap-2 font-mono text-[10.5px] text-[var(--text-muted)]">
                  {r.clips} clips · {r.dur}
                  <span className="flex-1" />
                  {r.status === "ready" ? (
                    <span className="inline-flex items-center gap-1 text-[var(--success-500)]">
                      <span className="h-[5px] w-[5px] rounded-full bg-[var(--success-500)]" />
                      Ready
                    </span>
                  ) : r.status === "draft" ? (
                    <span className="text-[var(--text-secondary)]">Draft</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[var(--accent)]">
                      <span className="h-[5px] w-[5px] animate-pulse rounded-full bg-[var(--accent)]" />
                      {r.progress}%
                    </span>
                  )}
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* Selection queue bar */}
        {selIds.length > 0 ? (
          <div className="sticky bottom-3.5 z-[60] flex items-center gap-3.5 rounded-[13px] border border-[var(--border-strong)] bg-[rgba(14,22,45,0.9)] px-4 py-[11px] shadow-[0_12px_34px_rgba(0,0,0,0.5)] backdrop-blur-[14px]">
            <Layers className="h-[17px] w-[17px] shrink-0 text-[var(--accent)]" />
            <span className="font-mono text-[12.5px] text-[var(--text-strong)]">
              {selIds.length} {selIds.length === 1 ? "moment" : "moments"} ·{" "}
              {fmtSecs(selSecs)}
            </span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => setSel({})}
              className="rounded-[9px] border border-[var(--border)] px-[13px] py-1.5 text-[12.5px] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]"
            >
              Clear
            </button>
            {selIds.length === 1 ? (
              <button
                type="button"
                onClick={() => {
                  const m = MOMENTS.find((x) => x.id === selIds[0]);
                  showToast(`Exporting 9:16 · ${m?.title ?? "clip"}`);
                }}
                className="inline-flex items-center gap-1.5 rounded-[9px] border border-[var(--border)] px-[13px] py-1.5 text-[12.5px] text-[var(--text-primary)] hover:border-[var(--accent)]"
              >
                <Smartphone className="h-3.5 w-3.5" />
                Export 9:16
              </button>
            ) : null}
            <Link href="/video-analysis">
              <Button size="md">Build reel</Button>
            </Link>
          </div>
        ) : null}
      </div>

      {toast ? (
        <div className="fixed right-[22px] bottom-5 z-[90] flex items-center gap-2 rounded-[11px] border border-[var(--border-strong)] bg-[rgba(14,22,45,0.95)] px-[15px] py-2.5 shadow-[0_12px_30px_rgba(0,0,0,0.5)] backdrop-blur-[10px]">
          <CheckCircle2 className="h-[15px] w-[15px] text-[var(--success-500)]" />
          <span className="text-[12.5px] text-[var(--text-primary)]">{toast}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setToast("")}
            className="ml-1 text-[var(--text-muted)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
