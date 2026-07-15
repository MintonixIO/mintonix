import * as React from "react";
import { cn } from "@/lib/utils";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: React.ReactNode;
  glow?: boolean;
  hover?: boolean;
  gradient?: boolean;
  padded?: boolean;
}

export function Card({
  title,
  subtitle,
  eyebrow,
  actions,
  glow = false,
  hover = false,
  gradient = true,
  padded = false,
  className = "",
  children,
  ...rest
}: CardProps) {
  const hasHeader = !!(title || actions || eyebrow);
  return (
    <div
      className={cn(
        "mx-card",
        glow && "mx-card--glow",
        hover && "mx-card--hover",
        gradient && "mx-card--grad",
        padded && !title && "mx-card--pad",
        className,
      )}
      {...rest}
    >
      {hasHeader ? (
        <div className="mx-card__header">
          <div>
            {eyebrow ? <div className="mx-card__eyebrow">{eyebrow}</div> : null}
            {title ? <h3 className="mx-card__title">{title}</h3> : null}
            {subtitle ? <div className="mx-card__sub">{subtitle}</div> : null}
          </div>
          {actions ? <div className="mx-card__actions">{actions}</div> : null}
        </div>
      ) : null}
      {title ? <div className="mx-card__body">{children}</div> : children}
    </div>
  );
}
