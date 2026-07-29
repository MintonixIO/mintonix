import Link from "next/link";
import { CheckCircle2, Layers, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtSecs } from "@/components/highlights/moment-thumb";
import { MOMENTS } from "@/lib/highlights/moments";

type SelectionBarProps = {
  selIds: string[];
  selSecs: number;
  onClear: () => void;
  onExport: (title: string) => void;
};

export function SelectionBar({
  selIds,
  selSecs,
  onClear,
  onExport,
}: SelectionBarProps) {
  if (selIds.length === 0) return null;

  return (
    <div className="sticky bottom-3.5 z-[60] flex items-center gap-3.5 rounded-[13px] border border-[var(--border-strong)] bg-[rgba(14,22,45,0.9)] px-4 py-[11px] shadow-[0_12px_34px_rgba(0,0,0,0.5)] backdrop-blur-[14px]">
      <Layers className="h-[17px] w-[17px] shrink-0 text-[var(--accent)]" />
      <span className="font-mono text-[12.5px] text-[var(--text-strong)]">
        {selIds.length} {selIds.length === 1 ? "moment" : "moments"} ·{" "}
        {fmtSecs(selSecs)}
      </span>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onClear}
        className="rounded-[9px] border border-[var(--border)] px-[13px] py-1.5 text-[12.5px] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]"
      >
        Clear
      </button>
      {selIds.length === 1 ? (
        <button
          type="button"
          onClick={() => {
            const m = MOMENTS.find((x) => x.id === selIds[0]);
            onExport(m?.title ?? "clip");
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
  );
}

type ToastProps = {
  message: string;
  onDismiss: () => void;
};

export function HighlightsToast({ message, onDismiss }: ToastProps) {
  if (!message) return null;
  return (
    <div className="fixed right-[22px] bottom-5 z-[90] flex items-center gap-2 rounded-[11px] border border-[var(--border-strong)] bg-[rgba(14,22,45,0.95)] px-[15px] py-2.5 shadow-[0_12px_30px_rgba(0,0,0,0.5)] backdrop-blur-[10px]">
      <CheckCircle2 className="h-[15px] w-[15px] text-[var(--success-500)]" />
      <span className="text-[12.5px] text-[var(--text-primary)]">{message}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="ml-1 text-[var(--text-muted)]"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
