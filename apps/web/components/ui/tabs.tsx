"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface TabItem<T extends string = string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  count?: number | string;
}

export interface TabsProps<T extends string = string>
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  items: Array<T | TabItem<T>>;
  value?: T;
  defaultValue?: T;
  onChange?: (value: T) => void;
  variant?: "line" | "pill";
}

export function Tabs<T extends string = string>({
  items,
  value,
  defaultValue,
  onChange,
  variant = "line",
  className = "",
  ...rest
}: TabsProps<T>) {
  const norm: TabItem<T>[] = items.map((it) =>
    typeof it === "string" ? { value: it, label: it } : it,
  );
  const [internal, setInternal] = React.useState<T | undefined>(
    defaultValue ?? norm[0]?.value,
  );
  const active = value !== undefined ? value : internal;
  const select = (v: T) => {
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
