import Link from "next/link";
import { Check, Plus, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { MomentThumb } from "@/components/highlights/moment-thumb";
import {
  REASON_STYLE,
  ReasonIcon,
} from "@/components/highlights/reason-style";
import { pickReason, type EmphKey } from "@/lib/highlights/query";
import type { Moment } from "@/lib/highlights/moments";
import { cn } from "@/lib/utils";

type MomentGridProps = {
  filtered: Moment[];
  emph: EmphKey;
  sel: Record<string, boolean>;
  onToggleSel: (id: string, e?: React.MouseEvent) => void;
  onExport: (title: string) => void;
};

export function MomentGrid({
  filtered,
  emph,
  sel,
  onToggleSel,
  onExport,
}: MomentGridProps) {
  if (filtered.length === 0) {
    return (
      <div className="rounded-[13px] border border-dashed border-[var(--border)] px-4 py-10 text-center">
        <div className="text-sm text-[var(--text-secondary)]">
          No moments match this search.
        </div>
        <div className="mt-1 font-mono text-xs text-[var(--text-muted)]">
          Try fewer filters — or a phrase like &ldquo;smash over 300&rdquo;.
        </div>
      </div>
    );
  }

  return (
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
                aria-label={sel[m.id] ? "Remove from queue" : "Add to queue"}
                onClick={(e) => onToggleSel(m.id, e)}
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
                  onClick={() => onExport(m.title)}
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
  );
}
