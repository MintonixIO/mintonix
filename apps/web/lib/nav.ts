export const marketingNavItems = [
  { label: "Pricing", href: "/pricing" },
  { label: "Blog", href: "/blog" },
  { label: "About", href: "/about" },
] as const;

export const marketingFeatured = {
  label: "BWF",
  href: "/bwf",
  icon: "trophy" as const,
};

export const footerColumns = [
  {
    heading: "Product",
    links: [
      { label: "BWF catalog", href: "/bwf" },
      { label: "Matches", href: "/bwf/matches" },
      { label: "Players", href: "/bwf/players" },
      { label: "Head-to-head", href: "/bwf/h2h" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { label: "Blog", href: "/blog" },
      { label: "Pricing", href: "/pricing" },
      { label: "Changelog", href: "/changelog" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Contact", href: "/about#contact" },
    ],
  },
];

export const footerSocial = [] as { type: "x" | "youtube" | "github"; href: string }[];

export const footerLegal = [
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
];

export const appSidebarSections: {
  label: string;
  items: { key: string; label: string; icon: string; href: string }[];
}[] = [
  {
    label: "Workspace",
    items: [
      { key: "dashboard", label: "Dashboard", icon: "dashboard", href: "/dashboard" },
      { key: "library", label: "Library", icon: "library", href: "/dashboard/library" },
      { key: "analysis", label: "Analysis", icon: "analysis", href: "/dashboard/analysis" },
      { key: "highlights", label: "Highlights", icon: "highlights", href: "/dashboard/highlights" },
    ],
  },
  {
    label: "Account",
    items: [
      { key: "settings", label: "Settings", icon: "settings", href: "/dashboard/settings" },
      { key: "help", label: "Help & support", icon: "help", href: "/dashboard/help-support" },
    ],
  },
];

/** Path prefixes that should light a different sidebar key (e.g. compare lives under analysis). */
export const appNavActiveAliases: { prefix: string; key: string }[] = [
  { prefix: "/dashboard/compare", key: "analysis" },
];

/**
 * Resolve sidebar active key from pathname.
 * Longest matching item href wins; exact `/dashboard` only matches home.
 */
export function activeSidebarKeyFromPath(pathname: string): string {
  for (const alias of appNavActiveAliases) {
    if (pathname === alias.prefix || pathname.startsWith(`${alias.prefix}/`)) {
      return alias.key;
    }
  }
  const items = appSidebarSections.flatMap((s) => [...s.items]);
  let best: { key: string; len: number } | null = null;
  for (const it of items) {
    const href = it.href;
    const match =
      href === "/dashboard"
        ? pathname === "/dashboard" || pathname === "/dashboard/"
        : pathname === href || pathname.startsWith(`${href}/`);
    if (match && (!best || href.length > best.len)) {
      best = { key: it.key, len: href.length };
    }
  }
  return best?.key ?? "dashboard";
}

export const appUser = {
  name: "Viktor Koster",
  role: "Coach · Pro",
  initials: "VK",
  email: "viktor@velocitybc.com",
  plan: "Pro",
};

export const appUsage = {
  resetLabel: "Resets 1 Jul",
  minutesUsed: 428,
  minutesLimit: 600,
  storageUsed: 18.4,
  storageLimit: 100,
  storageUnit: "GB",
};

export const appWorkspaces = [
  { id: "velocity", initials: "VB", name: "Velocity Badminton Club", accent: true },
  { id: "national", initials: "NT", name: "National Team — U19" },
];

export const appMenu = [
  { label: "View profile", icon: "user" as const, href: "/dashboard/settings" },
  { label: "Account settings", icon: "sliders" as const, href: "/dashboard/settings" },
  { label: "Billing & plan", icon: "card" as const, href: "/dashboard/settings", trailing: "$29 / mo" },
];
