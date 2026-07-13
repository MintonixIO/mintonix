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
      { label: "Video analysis", href: "/features/video-analysis" },
      { label: "Highlights", href: "/features/highlights" },
      { label: "Dashboard", href: "/features/dashboard" },
      { label: "BWF library", href: "/features/bwf" },
      { label: "Replay", href: "/features/replay" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { label: "Blog", href: "/blog" },
      { label: "Documentation", href: "/docs" },
      { label: "Pricing", href: "/pricing" },
      { label: "Changelog", href: "/changelog" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Contact", href: "/about#contact" },
      { label: "Careers", href: "#" },
    ],
  },
];

export const footerSocial = [
  { type: "x" as const, href: "#" },
  { type: "youtube" as const, href: "#" },
  { type: "github" as const, href: "#" },
];

export const footerLegal = [
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Status", href: "#" },
];

export const appSidebarSections = [
  {
    label: "Workspace",
    items: [
      { key: "dashboard", label: "Dashboard", icon: "dashboard", href: "/dashboard" },
      { key: "library", label: "Library", icon: "library", href: "/library" },
      { key: "analysis", label: "Analysis", icon: "analysis", href: "/analysis" },
      { key: "highlights", label: "Highlights", icon: "highlights", href: "/highlights" },
    ],
  },
  {
    label: "Account",
    items: [
      { key: "settings", label: "Settings", icon: "settings", href: "/settings" },
      { key: "help", label: "Help & support", icon: "help", href: "/help-support" },
    ],
  },
];

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
  { label: "View profile", icon: "user", href: "/settings" },
  { label: "Account settings", icon: "sliders", href: "/settings" },
  { label: "Billing & plan", icon: "card", href: "/settings", trailing: "$29 / mo" },
];
