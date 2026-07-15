import * as React from "react";
import { cn } from "@/lib/utils";

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "ghost" | "solid" | "primary";
  size?: "sm" | "md" | "lg";
  active?: boolean;
  /** Accessible name for icon-only controls. */
  label: string;
}

export function IconButton({
  variant = "ghost",
  size = "md",
  active = false,
  disabled = false,
  label,
  className = "",
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "mx-iconbtn",
        variant !== "ghost" && `mx-iconbtn--${variant}`,
        size !== "md" && `mx-iconbtn--${size}`,
        active && "mx-iconbtn--active",
        className,
      )}
      disabled={disabled}
      aria-label={label}
      title={label}
      {...rest}
    >
      {children}
    </button>
  );
}
