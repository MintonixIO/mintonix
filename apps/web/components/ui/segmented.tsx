"use client";

import { cn } from "@/lib/utils";

export type SegmentedOption<T extends string = string> = {
  id: T;
  label: string;
};

export function Segmented<T extends string = string>({
  value,
  onChange,
  options,
  className,
  size = "md",
}: {
  value: T;
  onChange: (id: T) => void;
  options: SegmentedOption<T>[];
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      className={cn(
        "flex gap-0.5 rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] p-0.5",
        className,
      )}
      role="tablist"
    >
      {options.map((opt) => {
        const on = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(opt.id)}
            className={cn(
              "rounded-[7px] whitespace-nowrap",
              size === "sm"
                ? "px-2.5 py-1 text-[12px]"
                : "px-3 py-1.5 text-[12.5px]",
              on
                ? "bg-[var(--accent)] text-white"
                : "bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-strong)]",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
