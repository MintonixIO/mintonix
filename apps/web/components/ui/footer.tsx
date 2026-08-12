import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/utils";

const SOCIAL_SVG: Record<string, React.ReactNode> = {
  x: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.7 3h3.2l-7 8 8.2 10h-6.4l-5-6.5L8.2 21H5l7.5-8.6L4.6 3H11l4.5 6 2.2-6Z" />
    </svg>
  ),
  youtube: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M23 7.5a3 3 0 0 0-2.1-2.1C19 5 12 5 12 5s-7 0-8.9.4A3 3 0 0 0 1 7.5 31 31 0 0 0 .7 12 31 31 0 0 0 1 16.5a3 3 0 0 0 2.1 2.1C5 19 12 19 12 19s7 0 8.9-.4a3 3 0 0 0 2.1-2.1A31 31 0 0 0 23.3 12 31 31 0 0 0 23 7.5ZM9.8 15.3V8.7l5.7 3.3-5.7 3.3Z" />
    </svg>
  ),
  github: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.4-2.2-.2-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.3 9.3 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.8-4.6 5 .3.3.6.9.6 1.9v2.8c0 .3.2.6.7.5A10 10 0 0 0 12 2Z" />
    </svg>
  ),
};

export interface FooterColumn {
  heading: string;
  links: { label: string; href: string }[];
}

export interface FooterProps {
  brand?: string;
  logoSrc?: string;
  tagline?: string;
  brandHref?: string;
  columns?: FooterColumn[];
  social?: { type: string; href: string; label?: string }[];
  copyright?: string;
  legalLinks?: { label: string; href: string }[];
  maxWidth?: number;
  className?: string;
}

export function Footer({
  brand = "Mintonix",
  logoSrc = "/assets/logomark.png",
  tagline = "BWF match analysis — catalog, video, players, and head-to-head from real tournament data.",
  brandHref = "/",
  columns = [],
  social = [],
  copyright = `© ${new Date().getFullYear()} Mintonix. All rights reserved.`,
  legalLinks = [
    { label: "Privacy", href: "/privacy" },
    { label: "Terms", href: "/terms" },
  ],
  maxWidth = 1320,
  className = "",
}: FooterProps) {
  return (
    <footer
      className={cn("mx-footer", className)}
      style={
        {
          "--mx-footer-cols": Math.max(1, columns.length),
          "--mx-footer-max": maxWidth + "px",
        } as React.CSSProperties
      }
    >
      <div className="mx-footer__inner">
        <div className="mx-footer__top">
          <div className="mx-footer__brand">
            <Link className="mx-footer__logo" href={brandHref}>
              {logoSrc ? (
                <Image src={logoSrc} alt={brand} width={24} height={24} />
              ) : null}
              <span className="mx-footer__wordmark">{brand}</span>
            </Link>
            {tagline ? <p className="mx-footer__tagline">{tagline}</p> : null}
            {social?.length ? (
              <div className="mx-footer__social">
                {social.map((s, i) => (
                  <a key={i} href={s.href || "#"} aria-label={s.label || s.type}>
                    {SOCIAL_SVG[s.type] || SOCIAL_SVG.x}
                  </a>
                ))}
              </div>
            ) : null}
          </div>

          {columns.map((col, i) => (
            <div key={i}>
              <div className="mx-footer__colhead">{col.heading}</div>
              <div className="mx-footer__links">
                {(col.links || []).map((l, j) => (
                  <Link key={j} href={l.href || "#"}>
                    {l.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mx-footer__legal">
          <span className="mx-footer__copy">{copyright}</span>
          <span className="mx-footer__spacer" />
          {legalLinks?.length ? (
            <div className="mx-footer__legallinks">
              {legalLinks.map((l, i) => (
                <Link key={i} href={l.href || "#"}>
                  {l.label}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </footer>
  );
}
