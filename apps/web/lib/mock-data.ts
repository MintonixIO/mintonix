import type { VideoCardData } from "@/components/app/video-card";

export const pipelineVideos: VideoCardData[] = [
  {
    id: "1",
    title: "Club finals — Court 2",
    players: "Koster vs Nguyen",
    event: "Velocity Club · MS",
    duration: "48:12",
    status: "analyzing",
    progress: 62,
    date: "Today",
    tags: ["singles", "1080p"],
  },
  {
    id: "2",
    title: "U19 sparring set",
    players: "Park / Lee vs Chen / Wu",
    event: "National Team · MD",
    duration: "36:40",
    status: "queued",
    date: "Today",
    tags: ["doubles"],
  },
];

export const recentVideos: VideoCardData[] = [
  {
    id: "3",
    title: "Axelsen vs Momota",
    players: "V. Axelsen vs K. Momota",
    event: "All England · MS SF",
    duration: "1:12:04",
    status: "ready",
    href: "/video-analysis",
    date: "Mon",
    tags: ["BWF", "MS"],
  },
  {
    id: "4",
    title: "League night — Court 1",
    players: "Koster vs Alvarez",
    event: "Velocity Club · MS",
    duration: "41:22",
    status: "ready",
    href: "/video-analysis",
    date: "Sun",
    tags: ["singles"],
  },
  {
    id: "5",
    title: "Training block B",
    players: "Squad · multi-rally",
    event: "Practice · mixed",
    duration: "22:08",
    status: "ready",
    href: "/video-analysis",
    date: "Sat",
    tags: ["drills"],
  },
];

export const blogPosts = [
  {
    slug: "rally-length-trends",
    title: "Rally length is rising — what the data says",
    excerpt:
      "Across 2,400 recent MS matches, average rally length is up 0.6 shots. Here's where the extra strokes are coming from.",
    date: "2026-06-18",
    category: "Insights",
    readTime: "6 min",
  },
  {
    slug: "smash-speed-baselines",
    title: "Smash speed baselines by level",
    excerpt:
      "Club, college, and pro smash distributions — and how to set thresholds that actually surface winners.",
    date: "2026-06-04",
    category: "Coaching",
    readTime: "5 min",
  },
  {
    slug: "highlight-workflows",
    title: "Building shareable reels in under a minute",
    excerpt:
      "A coach workflow: filter by outcome and speed, trim the noise, and ship a link before the next session.",
    date: "2026-05-22",
    category: "Product",
    readTime: "4 min",
  },
  {
    slug: "court-heatmaps",
    title: "Reading court heatmaps without the noise",
    excerpt:
      "Zone intensity is only useful when you normalize for rally count. A short guide to what the grid is telling you.",
    date: "2026-05-10",
    category: "Insights",
    readTime: "7 min",
  },
];

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
