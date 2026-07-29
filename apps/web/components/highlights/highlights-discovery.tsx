import Link from "next/link";
import { Check, Plus, Smartphone, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Segmented } from "@/components/ui/segmented";
import {
  CompactMomentThumb,
  MomentThumb,
} from "@/components/highlights/moment-thumb";
import {
  REASON_STYLE,
  ReasonIcon,
} from "@/components/highlights/reason-style";
import {
  EMPH,
  pickReason,
  type EmphKey,
} from "@/lib/highlights/query";
import type { Moment } from "@/lib/highlights/moments";
import { cn } from "@/lib/utils";

type HighlightsDiscoveryProps = {
  hero: Moment | undefined;
  discRows: Moment[];
  emph: EmphKey;
  onEmphChange: (v: EmphKey) => void;
  sel: Record<string, boolean>;
  onToggleSel: (id: string, e?: React.MouseEvent) => void;
  onExport: (title: string) => void;
};

export function HighlightsDiscovery({
  hero,
  discRows,
  emph,
  onEmphChange,
  sel,
  onToggleSel,
  onExport,
}: HighlightsDiscoveryProps) {
  return (
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
          onChange={onEmphChange}
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
                  onClick={(e) => onToggleSel(hero.id, e)}
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
                  onClick={() => onExport(hero.title)}
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
                  className="relative w-32 shrink-0 overflow-hidden rounded-lg"
                >
                  <CompactMomentThumb m={d} className="min-h-[72px]" />
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
                  onClick={(e) => onToggleSel(d.id, e)}
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
  );
}
