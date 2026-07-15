import * as React from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "outline"
  | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  block = false,
  leadingIcon,
  trailingIcon,
  disabled = false,
  type = "button",
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "mx-btn",
        `mx-btn--${variant}`,
        size !== "md" && `mx-btn--${size}`,
        block && "mx-btn--block",
        className,
      )}
      disabled={disabled}
      {...rest}
    >
      {leadingIcon ? <span className="mx-btn__icon">{leadingIcon}</span> : null}
      {children != null ? <span>{children}</span> : null}
      {trailingIcon ? (
        <span className="mx-btn__icon">{trailingIcon}</span>
      ) : null}
    </button>
  );
}
