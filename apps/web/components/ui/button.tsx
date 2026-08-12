import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "outline"
  | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export function buttonClassName(opts: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  className?: string;
}): string {
  const variant = opts.variant ?? "primary";
  const size = opts.size ?? "md";
  return cn(
    "mx-btn",
    `mx-btn--${variant}`,
    size !== "md" && `mx-btn--${size}`,
    opts.block && "mx-btn--block",
    opts.className,
  );
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  /** Prefer this over nesting <Button> inside <Link>. */
  href?: string;
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
  href,
  ...rest
}: ButtonProps) {
  const classes = buttonClassName({ variant, size, block, className });
  const content = (
    <>
      {leadingIcon ? <span className="mx-btn__icon">{leadingIcon}</span> : null}
      {children != null ? <span>{children}</span> : null}
      {trailingIcon ? (
        <span className="mx-btn__icon">{trailingIcon}</span>
      ) : null}
    </>
  );
  if (href && !disabled) {
    return (
      <Link href={href} className={classes}>
        {content}
      </Link>
    );
  }
  return (
    <button
      type={type}
      className={classes}
      disabled={disabled}
      {...rest}
    >
      {content}
    </button>
  );
}
