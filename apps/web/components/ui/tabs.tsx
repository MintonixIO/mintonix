"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface TabItem {
  value: string;
  label: string;
  icon?: React.ReactNode;
  count?: number | string;
}

export interface TabsProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  items: Array<string | TabItem>;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  variant?: "line" | "pill";
}

export function Tabs({
  items,
  value,
  defaultValue,
  onChange,
  variant = "line",
  className = "",
  ...rest
}: TabsProps) {
  const norm = items.map((it) =>
    typeof it === "string" ? { value: it, label: it } : it,
  );
  const [internal, setInternal] = React.useState(
    defaultValue ?? norm[0]?.value,
  );
  const active = value !== undefined ? value : internal;
  const select = (v: string) => {
    if (value === undefined) setInternal(v);
    onChange?.(v);
  };
  return (
    <div
      className={cn("mx-tabs", `mx-tabs--${variant}`, className)}
      role="tablist"
      {...rest}
    >
      {norm.map((it) => (
        <button
          key={it.value}
          role="tab"
          type="button"
          aria-selected={active === it.value}
          className="mx-tab"
          onClick={() => select(it.value)}
        >
          {it.icon}
          {it.label}
          {it.count != null ? (
            <span className="mx-tab__count">{it.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
