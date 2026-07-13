"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Scales an iframe (or any fixed logical viewport) to fill the container width,
 * matching Claude Design's data-mxframe product previews.
 */
export function ScaledFrame({
  src,
  logicalWidth = 1480,
  logicalHeight = 700,
  className,
  title,
}: {
  src: string;
  logicalWidth?: number;
  logicalHeight?: number;
  className?: string;
  title?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (!w) return;
      setScale(w / logicalWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [logicalWidth]);

  return (
    <div
      ref={boxRef}
      className={cn("relative w-full overflow-hidden bg-[var(--bg-base)]", className)}
      style={{ height: Math.round(logicalHeight * scale) }}
    >
      <iframe
        src={src}
        title={title || "Product preview"}
        tabIndex={-1}
        loading="lazy"
        scrolling="no"
        className="pointer-events-none absolute left-0 top-0 border-0"
        style={{
          width: logicalWidth,
          height: Math.max(logicalHeight, 900),
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[rgba(10,16,32,0.45)]" />
    </div>
  );
}
