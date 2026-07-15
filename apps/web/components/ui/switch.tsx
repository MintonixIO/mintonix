"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  label?: string;
  size?: "sm" | "md";
}

export function Switch({
  checked,
  defaultChecked,
  onChange,
  label,
  size = "md",
  disabled = false,
  className = "",
  ...rest
}: SwitchProps) {
  return (
    <label
      className={cn(
        "mx-switch",
        size === "sm" && "mx-switch--sm",
        disabled && "mx-switch--disabled",
        className,
      )}
    >
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        defaultChecked={defaultChecked}
        onChange={onChange}
        disabled={disabled}
        {...rest}
      />
      <span className="mx-switch__track">
        <span className="mx-switch__thumb" />
      </span>
      {label ? <span className="mx-switch__label">{label}</span> : null}
    </label>
  );
}
