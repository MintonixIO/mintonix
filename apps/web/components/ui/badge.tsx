import * as React from "react";
import { cn } from "@/lib/utils";

export type BadgeTone =
  | "neutral"
  | "brand"
  | "success"
  | "warning"
  | "danger"
  | "cyan";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  solid?: boolean;
  pill?: boolean;
  dot?: boolean;
  live?: boolean;
  icon?: React.ReactNode;
}

export function Badge({
  tone = "neutral",
  solid = false,
  pill = false,
  dot = false,
  live = false,
  icon,
  className = "",
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={cn(
        "mx-badge",
        live ? "mx-badge--live" : `mx-badge--${tone}`,
        solid && "mx-badge--solid",
        (pill || live) && "mx-badge--pill",
        className,
      )}
      {...rest}
    >
      {dot || live ? <span className="mx-badge__dot" /> : null}
      {icon}
      {children}
    </span>
  );
}
