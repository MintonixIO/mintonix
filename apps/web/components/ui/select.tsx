import * as React from "react";
import { cn } from "@/lib/utils";

const Chevron = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  label?: string;
  size?: "sm" | "md";
  options?: Array<string | SelectOption>;
}

export function Select({
  label,
  size = "md",
  options,
  id,
  className = "",
  children,
  ...rest
}: SelectProps) {
  const fid =
    id ||
    (label ? "mx-sel-" + label.replace(/\s+/g, "-").toLowerCase() : undefined);
  return (
    <div className="mx-select-wrap">
      {label ? <label htmlFor={fid}>{label}</label> : null}
      <div className="mx-select-field">
        <select
          id={fid}
          className={cn(
            "mx-select",
            size === "sm" && "mx-select--sm",
            className,
          )}
          {...rest}
        >
          {options
            ? options.map((o) => {
                const opt = typeof o === "string" ? { value: o, label: o } : o;
                return (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                );
              })
            : children}
        </select>
        <span className="mx-select__chev">
          <Chevron />
        </span>
      </div>
    </div>
  );
}
