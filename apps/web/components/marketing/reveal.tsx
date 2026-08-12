"use client";

import * as React from "react";

/** IntersectionObserver-based scroll reveal for marketing sections. */
export function Reveal({
  children,
  className,
  as: Tag = "div",
  style,
  ...rest
}: React.HTMLAttributes<HTMLElement> & {
  as?: "div" | "section" | "article" | "span";
}) {
  const ref = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      el.classList.remove("will-reveal");
      el.classList.add("is-visible");
      return;
    }
    // Only hide once mounted so SSR/first paint stays visible
    el.classList.add("will-reveal");
    // reflow then observe
    void el.offsetWidth;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const sec = e.target.closest("section") || e.target.parentElement;
          const sibs = sec
            ? Array.from(sec.querySelectorAll("[data-reveal].will-reveal"))
            : [e.target];
          const idx = Math.max(0, sibs.indexOf(e.target));
          (e.target as HTMLElement).style.transitionDelay = `${Math.min(idx, 4) * 40}ms`;
          e.target.classList.add("is-visible");
          io.unobserve(e.target);
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -4% 0px" },
    );
    // If already in view, show immediately
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.92) {
      el.classList.add("is-visible");
    } else {
      io.observe(el);
    }
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as React.Ref<HTMLDivElement>}
      data-reveal
      className={className}
      style={style}
      {...rest}
    >
      {children}
    </Tag>
  );
}
