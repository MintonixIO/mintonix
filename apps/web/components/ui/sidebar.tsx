"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { cn, initials } from "@/lib/utils";

const ICONS: Record<string, React.ReactNode> = {
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  ),
  library: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  ),
  analysis: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <rect x="7" y="11" width="3" height="6" rx="0.6" />
      <rect x="12" y="7" width="3" height="10" rx="0.6" />
      <rect x="17" y="13" width="3" height="4" rx="0.6" />
    </svg>
  ),
  highlights: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M2 8h20M7 4v4M17 4v4M7 20v-4M17 20v-4M2 16h20" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 7.6 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 3.6 14H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 8.6a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 10 3.6V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 2.4 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 20.4 10H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  ),
  help: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  ),
  user: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  sliders: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="8" x2="20" y2="8" />
      <line x1="4" y1="16" x2="20" y2="16" />
      <circle cx="9" cy="8" r="2.4" fill="var(--surface-1,#0e162d)" />
      <circle cx="15" cy="16" r="2.4" fill="var(--surface-1,#0e162d)" />
    </svg>
  ),
  card: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  moon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  ),
  sun: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  ),
  logout: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  ),
  chevron: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  ),
};

function pct(used: number, limit: number) {
  return Math.max(0, Math.min(100, Math.round((used / (limit || 1)) * 100)));
}

export interface SidebarSection {
  label?: string;
  items: { key: string; label: string; icon: string; href: string }[];
}

export interface SidebarUser {
  name: string;
  role?: string;
  initials?: string;
  email?: string;
  plan?: string;
  src?: string;
}

export interface SidebarProps {
  active?: string;
  brand?: string;
  logoSrc?: string;
  brandHref?: string;
  sections?: SidebarSection[];
  user?: SidebarUser;
  usage?: {
    resetLabel?: string;
    minutesUsed: number;
    minutesLimit: number;
    storageUsed: number;
    storageLimit: number;
    storageUnit?: string;
  } | null;
  workspaces?: { id: string; initials: string; name: string; accent?: boolean }[];
  menu?: { label: string; icon: string; href: string; trailing?: string }[];
  signOutHref?: string;
  width?: number;
  className?: string;
}

export function Sidebar({
  active,
  brand = "Mintonix",
  logoSrc = "/assets/logomark.png",
  brandHref = "/",
  sections = [],
  user = {
    name: "Viktor Koster",
    role: "Coach · Pro",
    initials: "VK",
    email: "viktor@velocitybc.com",
    plan: "Pro",
  },
  usage = {
    resetLabel: "Resets 1 Jul",
    minutesUsed: 428,
    minutesLimit: 600,
    storageUsed: 18.4,
    storageLimit: 100,
    storageUnit: "GB",
  },
  workspaces = [
    { id: "velocity", initials: "VB", name: "Velocity Badminton Club", accent: true },
    { id: "national", initials: "NT", name: "National Team — U19" },
  ],
  menu = [
    { label: "View profile", icon: "user", href: "/settings" },
    { label: "Account settings", icon: "sliders", href: "/settings" },
    { label: "Billing & plan", icon: "card", href: "/settings", trailing: "$29 / mo" },
  ],
  signOutHref = "/auth",
  width = 244,
  className = "",
}: SidebarProps) {
  const [open, setOpen] = React.useState(false);
  const [ws, setWs] = React.useState(workspaces[0]?.id);
  const [theme, setTheme] = React.useState<"dark" | "light">("dark");

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <aside className={cn("mx-side", className)} style={{ width }}>
      <Link className="mx-side__brand" href={brandHref} aria-label={brand}>
        {logoSrc ? (
          <Image src={logoSrc} alt={brand} width={24} height={24} />
        ) : null}
        <span className="mx-side__word">{brand}</span>
      </Link>

      <nav className="mx-side__nav">
        {sections.map((sec, si) => (
          <React.Fragment key={si}>
            {sec.label ? (
              <div className="mx-side__seclabel">{sec.label}</div>
            ) : null}
            {sec.items.map((it) => {
              const on = it.key && it.key === active;
              return (
                <Link
                  key={it.key}
                  className={cn("mx-side__link", on && "is-active")}
                  href={it.href || "#"}
                  aria-current={on ? "page" : undefined}
                >
                  {ICONS[it.icon] || null}
                  {it.label}
                </Link>
              );
            })}
          </React.Fragment>
        ))}
      </nav>

      {usage ? (
        <div className="mx-side__usage">
          <div className="mx-side__usagehd">
            <span className="mx-side__usagek">Usage</span>
            {usage.resetLabel ? (
              <span className="mx-side__usagereset">{usage.resetLabel}</span>
            ) : null}
          </div>
          <div className="mx-side__meter">
            <div className="mx-side__meterhd">
              <span className="mx-side__metername">Analysis minutes</span>
              <span className="mx-side__meterval">
                {usage.minutesUsed} / {usage.minutesLimit}
              </span>
            </div>
            <div className="mx-side__track">
              <div
                className="mx-side__fill"
                style={{
                  width: pct(usage.minutesUsed, usage.minutesLimit) + "%",
                }}
              />
            </div>
          </div>
          <div className="mx-side__meter">
            <div className="mx-side__meterhd">
              <span className="mx-side__metername">Storage</span>
              <span className="mx-side__meterval">
                {usage.storageUsed} / {usage.storageLimit}{" "}
                {usage.storageUnit || "GB"}
              </span>
            </div>
            <div className="mx-side__track">
              <div
                className="mx-side__fill"
                style={{
                  width: pct(usage.storageUsed, usage.storageLimit) + "%",
                }}
              />
            </div>
          </div>
        </div>
      ) : null}

      <div className="mx-side__acct">
        {open ? (
          <>
            <div className="mx-side__scrim" onClick={() => setOpen(false)} />
            <div className="mx-side__menu" role="menu">
              <div className="mx-side__menuhd">
                <span
                  className="mx-side__avatar"
                  style={{ width: 36, height: 36, fontSize: 13 }}
                >
                  {user.src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={user.src} alt={user.name || ""} />
                  ) : (
                    initials(user.name, user.initials)
                  )}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mx-side__menuname">{user.name}</div>
                  {user.email ? (
                    <div className="mx-side__menumail">{user.email}</div>
                  ) : null}
                </div>
                {user.plan ? (
                  <span className="mx-side__plan">{user.plan}</span>
                ) : null}
              </div>

              <div className="mx-side__menugrp">
                {menu.map((m, i) => (
                  <Link
                    key={i}
                    className="mx-side__menuitem"
                    href={m.href || "#"}
                    role="menuitem"
                  >
                    {ICONS[m.icon] || null}
                    <span style={{ flex: 1, minWidth: 0 }}>{m.label}</span>
                    {m.trailing ? (
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 10,
                          color: "var(--text-muted)",
                        }}
                      >
                        {m.trailing}
                      </span>
                    ) : null}
                  </Link>
                ))}
              </div>

              {workspaces?.length ? (
                <div className="mx-side__menugrp">
                  <div className="mx-side__menugrplabel">Workspace</div>
                  {workspaces.map((w) => {
                    const on = w.id === ws;
                    return (
                      <button
                        key={w.id}
                        type="button"
                        className={cn(
                          "mx-side__ws",
                          on && "is-active",
                          w.accent && "mx-side__ws--accent",
                        )}
                        onClick={() => {
                          setWs(w.id);
                          setOpen(false);
                        }}
                      >
                        <span className="mx-side__wsbadge">{w.initials}</span>
                        <span className="mx-side__wsname">{w.name}</span>
                        {on ? (
                          <span className="mx-side__wscheck">{ICONS.check}</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              <div className="mx-side__menugrp">
                <div className="mx-side__themerow">
                  <span className="mx-side__themelabel">Theme</span>
                  <div className="mx-side__themeseg">
                    <button
                      type="button"
                      className={cn(
                        "mx-side__themebtn",
                        theme === "dark" && "is-on",
                      )}
                      onClick={() => setTheme("dark")}
                    >
                      {ICONS.moon}Dark
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "mx-side__themebtn",
                        theme === "light" && "is-on",
                      )}
                      onClick={() => setTheme("light")}
                    >
                      {ICONS.sun}Light
                    </button>
                  </div>
                </div>
                <Link
                  className="mx-side__menuitem mx-side__menuitem--danger"
                  href={signOutHref}
                >
                  {ICONS.logout}Sign out
                </Link>
              </div>
            </div>
          </>
        ) : null}

        <button
          type="button"
          className="mx-side__acctbtn"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="mx-side__avatar">
            {user.src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.src} alt={user.name || ""} />
            ) : (
              initials(user.name, user.initials)
            )}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="mx-side__acctname">{user.name}</div>
            {user.role ? (
              <div className="mx-side__acctrole">{user.role}</div>
            ) : null}
          </div>
          <span className="mx-side__chev">{ICONS.chevron}</span>
        </button>
      </div>
    </aside>
  );
}
