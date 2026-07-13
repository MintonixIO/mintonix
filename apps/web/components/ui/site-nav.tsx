"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { cn, initials } from "@/lib/utils";

const ICONS = {
  trophy: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M6 2h12v7a6 6 0 0 1-12 0V2Z" />
      <path d="M9 19h6" />
      <path d="M10 22h4" />
      <path d="M12 15v4" />
    </svg>
  ),
  arrowRight: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  ),
  chevronDown: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  ),
  bell: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      <path d="M21 16H3a3 3 0 0 0 2-3V9a7 7 0 1 1 14 0v4a3 3 0 0 0 2 3Z" />
    </svg>
  ),
  user: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 7.6 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 3.6 14H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 8.6a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 10 3.6V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 2.4 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 20.4 10H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  ),
  logout: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  ),
} as const;

export type NavItem = { label: string; href: string };
export type NavFeatured = { label: string; href: string; icon?: keyof typeof ICONS };
export type NavMenuItem =
  | { label: string; href: string; icon?: keyof typeof ICONS; divider?: never }
  | { divider: true; label?: never; href?: never; icon?: never };

export interface SiteNavProps extends React.HTMLAttributes<HTMLElement> {
  brand?: string;
  logoSrc?: string;
  brandHref?: string;
  items?: NavItem[];
  featured?: NavFeatured | null;
  active?: string;
  mode?: "marketing" | "app";
  indicator?: "spotlight" | "underline" | "dot";
  signInLabel?: string;
  signInHref?: string;
  ctaLabel?: string;
  ctaHref?: string;
  user?: { name?: string; src?: string };
  menu?: NavMenuItem[];
  maxWidth?: number;
}

export function SiteNav({
  brand = "Mintonix",
  logoSrc = "/assets/logomark.png",
  brandHref = "/",
  items = [
    { label: "Pricing", href: "/pricing" },
    { label: "Blog", href: "/blog" },
    { label: "About", href: "/about" },
  ],
  featured = { label: "BWF", href: "/bwf", icon: "trophy" },
  active,
  mode = "marketing",
  indicator = "spotlight",
  signInLabel = "Sign in",
  signInHref = "/auth",
  ctaLabel = "Start free",
  ctaHref = "/auth",
  user,
  menu = [
    { label: "Account", href: "/settings", icon: "user" },
    { label: "Settings", href: "/settings", icon: "settings" },
    { divider: true },
    { label: "Sign out", href: "/auth", icon: "logout" },
  ],
  maxWidth = 1320,
  className = "",
  style,
  ...rest
}: SiteNavProps) {
  const list = items || [];
  const itemRefs = React.useRef<(HTMLAnchorElement | null)[]>([]);
  const [hover, setHover] = React.useState<number | null>(null);
  const [scrolled, setScrolled] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [ind, setInd] = React.useState({ left: 0, width: 0, on: false });
  const acctRef = React.useRef<HTMLDivElement>(null);

  const activeIdx = list.findIndex(
    (it) => it.label === active || (it.href && it.href === active),
  );
  const featActive =
    !!featured &&
    (featured.label === active || (featured.href && featured.href === active));

  const measure = React.useCallback(() => {
    const idx = hover != null ? hover : activeIdx;
    const el = idx >= 0 ? itemRefs.current[idx] : null;
    if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth, on: true });
    else setInd((s) => ({ ...s, on: false }));
  }, [hover, activeIdx]);

  React.useLayoutEffect(() => {
    measure();
  }, [measure, indicator, list.length, mode]);

  React.useEffect(() => {
    const onR = () => measure();
    window.addEventListener("resize", onR);
    const t1 = setTimeout(measure, 120);
    const t2 = setTimeout(measure, 420);
    return () => {
      window.removeEventListener("resize", onR);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [measure]);

  React.useEffect(() => {
    const onS = () => setScrolled((window.scrollY || 0) > 8);
    onS();
    window.addEventListener("scroll", onS, { passive: true });
    return () => window.removeEventListener("scroll", onS);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (acctRef.current && !acctRef.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const dotStyle =
    indicator === "dot"
      ? { left: ind.left + ind.width / 2 - 2.5 }
      : { left: ind.left, width: ind.width };

  return (
    <header
      className={cn("mx-nav", scrolled && "is-scrolled", className)}
      style={{ ["--mx-nav-max" as string]: maxWidth + "px", ...style }}
      {...rest}
    >
      <nav className="mx-nav__inner">
        <Link className="mx-nav__logo" href={brandHref} aria-label={brand}>
          {logoSrc ? (
            <Image src={logoSrc} alt={brand} width={26} height={26} priority />
          ) : null}
          <span className="mx-nav__word">{brand}</span>
        </Link>

        <span className="mx-nav__spacer" />

        <div className="mx-nav__group" onMouseLeave={() => setHover(null)}>
          <span
            className={`mx-nav__ind mx-nav__ind--${indicator}`}
            data-on={ind.on}
            style={dotStyle}
          />
          {list.map((it, i) => {
            const lit = hover != null ? hover === i : activeIdx === i;
            return (
              <Link
                key={it.href + it.label}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                className={cn("mx-nav__link", lit && "is-lit")}
                href={it.href || "#"}
                aria-current={activeIdx === i ? "page" : undefined}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              >
                {it.label}
              </Link>
            );
          })}
          {featured ? (
            <Link
              className={cn("mx-nav__feat", featActive && "is-active")}
              href={featured.href || "#"}
              aria-current={featActive ? "page" : undefined}
            >
              {ICONS[featured.icon || "trophy"] || ICONS.trophy}
              {featured.label}
            </Link>
          ) : null}
        </div>

        <span className="mx-nav__div" />

        {mode === "app" ? (
          <div className="mx-nav__right">
            <button className="mx-nav__icbtn" type="button" aria-label="Notifications">
              {ICONS.bell}
              <span className="mx-nav__dotbadge" />
            </button>
            <div className="mx-nav__acct" ref={acctRef}>
              <button
                className="mx-nav__acctbtn"
                type="button"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
              >
                <span
                  className="mx-avatar"
                  style={{
                    width: 30,
                    height: 30,
                    fontSize: 12,
                    background: "var(--grad-brand)",
                  }}
                >
                  {user?.src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={user.src}
                      alt={user.name || ""}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        borderRadius: 999,
                      }}
                    />
                  ) : (
                    initials(user?.name)
                  )}
                </span>
                {user?.name ? (
                  <span className="mx-nav__acctname">{user.name}</span>
                ) : null}
                <span className="mx-nav__chev">{ICONS.chevronDown}</span>
              </button>
              {open ? (
                <div className="mx-nav__menu" role="menu">
                  {(menu || []).map((m, i) =>
                    m.divider ? (
                      <div key={i} className="mx-nav__menudiv" />
                    ) : (
                      <Link
                        key={i}
                        className="mx-nav__menuitem"
                        href={m.href || "#"}
                        role="menuitem"
                      >
                        {m.icon && ICONS[m.icon] ? ICONS[m.icon] : null}
                        {m.label}
                      </Link>
                    ),
                  )}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="mx-nav__right">
            <Link className="mx-nav__signin" href={signInHref}>
              {signInLabel}
            </Link>
            <Link className="mx-nav__cta" href={ctaHref}>
              {ctaLabel}
              {ICONS.arrowRight}
            </Link>
          </div>
        )}
      </nav>
    </header>
  );
}
