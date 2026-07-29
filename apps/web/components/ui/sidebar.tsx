"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Check,
  ChevronDown,
  Clapperboard,
  CreditCard,
  HelpCircle,
  LayoutDashboard,
  Library,
  LogOut,
  Moon,
  Settings,
  SlidersHorizontal,
  Sun,
  User,
  type LucideIcon,
} from "lucide-react";
import { activeSidebarKeyFromPath } from "@/lib/nav";
import { cn, initials } from "@/lib/utils";

const ICONS = {
  dashboard: LayoutDashboard,
  library: Library,
  analysis: BarChart3,
  highlights: Clapperboard,
  settings: Settings,
  help: HelpCircle,
  user: User,
  sliders: SlidersHorizontal,
  card: CreditCard,
  check: Check,
  moon: Moon,
  sun: Sun,
  logout: LogOut,
  chevron: ChevronDown,
} as const satisfies Record<string, LucideIcon>;

export type SidebarIcon = keyof typeof ICONS;

function SidebarGlyph({
  name,
  className,
  strokeWidth = 1.8,
}: {
  name: SidebarIcon | string;
  className?: string;
  strokeWidth?: number;
}) {
  const Icon = ICONS[name as SidebarIcon];
  if (!Icon) return null;
  return <Icon className={className} strokeWidth={strokeWidth} aria-hidden />;
}

function pct(used: number, limit: number) {
  return Math.max(0, Math.min(100, Math.round((used / (limit || 1)) * 100)));
}

export interface SidebarSection {
  label?: string;
  items: { key: string; label: string; icon: SidebarIcon | string; href: string }[];
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
  menu?: { label: string; icon: SidebarIcon | string; href: string; trailing?: string }[];
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
    { label: "View profile", icon: "user", href: "/dashboard/settings" },
    { label: "Account settings", icon: "sliders", href: "/dashboard/settings" },
    { label: "Billing & plan", icon: "card", href: "/dashboard/settings", trailing: "$29 / mo" },
  ],
  signOutHref = "/auth",
  width = 244,
  className = "",
}: SidebarProps) {
  const pathname = usePathname();
  const resolvedActive = active ?? activeSidebarKeyFromPath(pathname);
  const [open, setOpen] = React.useState(false);
  const [ws, setWs] = React.useState(workspaces[0]?.id);

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
              const on = it.key && it.key === resolvedActive;
              return (
                <Link
                  key={it.key}
                  className={cn("mx-side__link", on && "is-active")}
                  href={it.href || "#"}
                  aria-current={on ? "page" : undefined}
                >
                  <SidebarGlyph name={it.icon} />
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
                    <SidebarGlyph name={m.icon} strokeWidth={1.9} />
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
                          <span className="mx-side__wscheck">
                            <SidebarGlyph name="check" strokeWidth={1.9} />
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              <div className="mx-side__menugrp">
                <Link
                  className="mx-side__menuitem mx-side__menuitem--danger"
                  href={signOutHref}
                >
                  <SidebarGlyph name="logout" strokeWidth={1.9} />
                  Sign out
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
          <span className="mx-side__chev">
            <SidebarGlyph name="chevron" strokeWidth={2} />
          </span>
        </button>
      </div>
    </aside>
  );
}
