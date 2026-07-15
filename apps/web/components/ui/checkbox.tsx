"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: React.ReactNode;
  round?: boolean;
}

export function Checkbox({
  checked,
  defaultChecked,
  onChange,
  label,
  children,
  round = false,
  disabled = false,
  className = "",
  ...rest
}: CheckboxProps) {
  const text = label != null ? label : children;
  return (
    <label
      className={cn(
        "mx-check",
        round && "mx-check--round",
        disabled && "mx-check--disabled",
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        defaultChecked={defaultChecked}
        onChange={onChange}
        disabled={disabled}
        {...rest}
      />
      <span className="mx-check__box">
        <svg viewBox="0 0 24 24">
          <polyline points="5 13 10 18 19 6" />
        </svg>
      </span>
      {text ? <span className="mx-check__label">{text}</span> : null}
    </label>
  );
}
