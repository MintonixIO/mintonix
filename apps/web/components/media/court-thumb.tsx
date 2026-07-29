import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type CourtThumbProps = {
  className?: string;
  children?: ReactNode;
  /** Extra overlay opacity for the court line grid (0–1). */
  gridOpacity?: number;
};

/**
 * Shared court-placeholder thumbnail used across library, dashboard, highlights.
 */
export function CourtThumb({
  className,
  children,
  gridOpacity = 0.5,
}: CourtThumbProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden bg-[linear-gradient(160deg,#0f1b34_0%,#070b16_100%)]",
        className,
      )}
    >
      <span
        className="pointer-events-none absolute inset-0 mx-court-grid"
        style={{ opacity: gridOpacity }}
        aria-hidden
      />
      <span
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_42%,rgba(54,147,255,0.14),transparent_70%)]"
        aria-hidden
      />
      {children}
    </div>
  );
}
