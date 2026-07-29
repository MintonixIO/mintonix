/**
 * Marketing / docs fixtures. Match & pipeline data lives in `@/lib/matches`.
 */
export {
  pipelineVideos,
  recentVideos,
  libraryMatches,
  comparePlayers,
} from "@/lib/matches";

/** Re-export catalog entries from the full blog content model. */
export { blogCatalogEntries as blogPosts } from "@/lib/blog/posts";

export const changelogEntries = [
  {
    version: "0.9.2",
    date: "2026-06-28",
    title: "Highlight builder filters",
    items: [
      "Speed threshold slider with live clip count",
      "Shot-type multi-select and outcome segmented control",
      "Shareable reel links with trim markers",
    ],
  },
  {
    version: "0.9.0",
    date: "2026-06-12",
    title: "BWF library beta",
    items: [
      "Browse pro matches with structured shot data",
      "Open any match into analysis without re-upload",
      "Filter by discipline, event, and year",
    ],
  },
  {
    version: "0.8.4",
    date: "2026-05-30",
    title: "Dashboard pipeline",
    items: [
      "Active analysis cards with progress",
      "Jump-back-in row for recent ready matches",
      "Workspace usage meters in the sidebar",
    ],
  },
];

export const pricingRows = {
  usage: [
    { label: "Analysis minutes / month", a: "60", b: "600", c: "Custom" },
    { label: "Storage", a: "5 GB", b: "100 GB", c: "Unlimited" },
    { label: "Pay-as-you-go overage", a: "—", b: "$0.08 / min", c: "Negotiated" },
    { label: "Seats", a: "1", b: "Unlimited", c: "Unlimited" },
    { label: "Shared match links", a: "3 / mo", b: "Unlimited", c: "Unlimited" },
  ],
  analysis: [
    { label: "Rally detection", a: "✓", b: "✓", c: "✓" },
    { label: "Shot classification", a: "Core", b: "Full", c: "Full + custom" },
    { label: "Heatmaps & distributions", a: "✓", b: "✓", c: "✓" },
    { label: "Head-to-head compare", a: "—", b: "✓", c: "✓" },
    { label: "Highlight reels", a: "Basic", b: "Advanced", c: "Advanced + SSO share" },
  ],
  platform: [
    { label: "BWF library access", a: "View", b: "Full", c: "Full + private feeds" },
    { label: "API access", a: "—", b: "Read", c: "Read / write" },
    { label: "SSO / SAML", a: "—", b: "—", c: "✓" },
    { label: "Priority support", a: "—", b: "Email", c: "Dedicated" },
  ],
};

export const docsNav = [
  {
    group: "Get started",
    items: [
      { label: "Introduction", href: "#intro" },
      { label: "Upload your first match", href: "#upload" },
      { label: "Reading the analysis", href: "#analysis" },
    ],
  },
  {
    group: "Features",
    items: [
      { label: "Highlights", href: "#highlights" },
      { label: "Replay", href: "#replay" },
      { label: "BWF library", href: "#bwf" },
    ],
  },
  {
    group: "Account",
    items: [
      { label: "Workspaces", href: "#workspaces" },
      { label: "Billing", href: "#billing" },
    ],
  },
];
