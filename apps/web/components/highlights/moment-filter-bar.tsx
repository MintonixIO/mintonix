import { Check } from "lucide-react";
import { Select } from "@/components/ui/select";
import { QUICK } from "@/lib/highlights/query";
import { cn } from "@/lib/utils";

type MomentFilterBarProps = {
  chips: string[];
  onChipsChange: (next: string[]) => void;
  sort: string;
  onSortChange: (v: string) => void;
  parsedChips: string[];
  showParsed: boolean;
};

export function MomentFilterBar({
  chips,
  onChipsChange,
  sort,
  onSortChange,
  parsedChips,
  showParsed,
}: MomentFilterBarProps) {
  return (
    <>
      {showParsed && parsedChips.length > 0 ? (
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
                onChipsChange(
                  chips.includes(c.id)
                    ? chips.filter((x) => x !== c.id)
                    : [...chips, c.id],
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
            onChange={(e) => onSortChange(e.target.value)}
            options={[
              { value: "best", label: "Best first" },
              { value: "fastest", label: "Fastest shot" },
              { value: "longest", label: "Longest rally" },
              { value: "recent", label: "Most recent" },
            ]}
          />
        </div>
      </div>
    </>
  );
}
