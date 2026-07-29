/**
 * Blog content model — catalog + full post bodies for marketing pages.
 */

export type BlogCategory = "Insights" | "Coaching" | "Product" | "Analysis" | "Engineering";

export type BlogBadgeTone = "brand" | "cyan" | "success" | "warning";

export type BlogBodyBlock =
  | { type: "p"; text: string; size?: "lead" | "body"; emphasis?: boolean }
  | {
      type: "rich-p";
      size?: "lead" | "body";
      parts: Array<
        | { kind: "text"; text: string }
        | { kind: "strong"; text: string }
        | { kind: "link"; text: string; href: string }
      >;
    }
  | { type: "h2"; kicker: string; title: string }
  | {
      type: "stats";
      items: Array<{ v: string; label: string; accent?: boolean }>;
    }
  | { type: "quote"; text: string }
  | {
      type: "list";
      items: Array<{ label: string; text: string }>;
    };

export type BlogPost = {
  slug: string;
  title: string;
  /** Catalog card / listing excerpt */
  excerpt: string;
  /** Article lede under the title */
  lead: string;
  category: BlogCategory;
  /** Badge tone for catalog cards */
  tone: BlogBadgeTone;
  readTime: string;
  author: string;
  role: string;
  bio: string;
  /** Display date, e.g. "Jun 16, 2026" */
  date: string;
  /** ISO-ish date for sorting / catalog */
  dateIso: string;
  figureCaption: string;
  relatedSlugs: string[];
  body: BlogBodyBlock[];
};

export const blogPosts: BlogPost[] = [
  {
    slug: "rally-length-trends",
    title:
      "Reading rally tempo: what shot pace tells you before the point ends",
    excerpt:
      "Across 2,400 recent MS matches, average rally length is up 0.6 shots. Here's where the extra strokes are coming from.",
    lead: "Shuttle speed within a rally rises and falls in patterns. We mapped the tempo curve of 4,000 rallies and found where points are actually decided — long before the final stroke lands.",
    category: "Analysis",
    tone: "brand",
    readTime: "8 min read",
    author: "Priya Nadar",
    role: "Performance analyst",
    bio: "Priya builds the rally and tempo models at Mintonix. Former national-level player, now turning footage into the patterns coaches can act on.",
    date: "Jun 16, 2026",
    dateIso: "2026-06-18",
    figureCaption: "fig 01 — rally tempo curve, 4,000 rallies",
    relatedSlugs: [
      "smash-speed-baselines",
      "highlight-workflows",
      "court-heatmaps",
    ],
    body: [
      {
        type: "rich-p",
        size: "lead",
        parts: [
          {
            kind: "text",
            text: "Every rally has a rhythm. Watch enough of them and you start to feel it — a slow exchange of clears, a sudden acceleration, then the stroke that ends it. The question we set out to answer was whether that feel could be measured, and whether the measurement arrived ",
          },
          { kind: "strong", text: "before" },
          { kind: "text", text: " the point did." },
        ],
      },
      {
        type: "p",
        text: "It can. Across 4,000 singles rallies, shuttle speed traces a repeatable curve: a calm opening, a steep mid-rally ramp, and a final spike that is almost always a consequence — not a cause — of the point being won. By the time the speed peaks, the rally is usually already decided. This note walks through the pattern behind rally tempo.",
      },
      {
        type: "h2",
        kicker: "01 — The shape of a rally",
        title: "The tempo curve, stroke by stroke",
      },
      {
        type: "p",
        text: "We normalised every rally to its length and averaged shuttle speed at each relative stroke. The result is strikingly consistent. The opening four strokes sit in a narrow band — players probing, not committing. Then, somewhere around the rally's midpoint, the curve bends sharply upward.",
      },
      {
        type: "stats",
        items: [
          { v: "9.4", label: "avg rally length" },
          { v: "+38%", label: "mid-rally speed ramp", accent: true },
          { v: "72%", label: "decided before peak" },
        ],
      },
      {
        type: "p",
        text: "That bend is the moment of intent. One player has decided to take control of the rally, and the speed of their strokes reflects it. The opponent's reply speed lags by one to two strokes — a measurable tell that they are reacting rather than dictating.",
      },
      {
        type: "h2",
        kicker: "02 — Where points are decided",
        title: "The lag is the signal",
      },
      {
        type: "rich-p",
        parts: [
          {
            kind: "text",
            text: "When we line up the two players' speed curves against each other, the gap between them predicts the outcome better than the peak speed itself. The player who first opens a sustained speed advantage — and holds it for three or more strokes — wins the rally ",
          },
          { kind: "strong", text: "72% of the time" },
          { kind: "text", text: "." },
        ],
      },
      {
        type: "quote",
        text: "The smash doesn't win the point. It confirms a point that the tempo decided three strokes earlier.",
      },
      {
        type: "p",
        text: "This reframes how we think about the highlight reel. The 330 km/h smash is the visible climax, but the rally was lost in the quiet acceleration that forced the defender out of position. That's the stroke a coach should be watching.",
      },
      {
        type: "list",
        items: [
          {
            label: "Watch the ramp, not the peak.",
            text: "The decisive stroke is usually the one that breaks the opening band.",
          },
          {
            label: "Track reply lag.",
            text: "A defender consistently one stroke behind on speed is being dictated to.",
          },
          {
            label: "Three-stroke advantage.",
            text: "A sustained edge, not a single fast shot, is what correlates with winning.",
          },
        ],
      },
      {
        type: "h2",
        kicker: "03 — What this means for you",
        title: "Tempo in your own matches",
      },
      {
        type: "p",
        text: "Every match you upload to Mintonix gets the same tempo curve. You'll see your own ramp point, your reply lag against each opponent, and the rallies where a sustained speed advantage turned into a won point. It's the pattern behind the score — and now it's measurable in minutes.",
      },
      {
        type: "rich-p",
        parts: [
          {
            kind: "text",
            text: "Upload a match to see your tempo curve, or browse the ",
          },
          { kind: "link", text: "BWF library", href: "/features/bwf" },
          {
            kind: "text",
            text: " to study how the best players in the world shape a rally.",
          },
        ],
      },
    ],
  },
  {
    slug: "smash-speed-baselines",
    title: "What 12,000 smashes reveal about court positioning",
    excerpt:
      "Club, college, and pro smash distributions — and how to set thresholds that actually surface winners.",
    lead: "Smash speed alone is a vanity metric. Pair it with where the shuttle left the racket and where the defender stood, and the same 12,000 smashes start to tell a positioning story.",
    category: "Analysis",
    tone: "brand",
    readTime: "6 min read",
    author: "Marcus Feld",
    role: "Sports scientist",
    bio: "Marcus models shot geometry and defensive coverage for Mintonix. He previously worked with national federations on biomechanics pipelines.",
    date: "Jun 9, 2026",
    dateIso: "2026-06-04",
    figureCaption: "fig 01 — smash origin × landing density",
    relatedSlugs: [
      "rally-length-trends",
      "court-heatmaps",
      "highlight-workflows",
    ],
    body: [
      {
        type: "p",
        size: "lead",
        text: "Coaches love a peak smash number. Players do too. But when we plotted 12,000 smashes across club, college, and tour footage, the speed distribution was less interesting than the court geometry around the contact.",
      },
      {
        type: "p",
        text: "The fastest smashes cluster in a surprisingly narrow band of body positions — front foot planted, racket path through a high contact, opponent already stretched. The ones that actually win points look different from the ones that only look fast on a radar gun.",
      },
      {
        type: "h2",
        kicker: "01 — Baselines by level",
        title: "Club, college, and pro distributions",
      },
      {
        type: "stats",
        items: [
          { v: "218", label: "club avg km/h" },
          { v: "268", label: "college avg km/h", accent: true },
          { v: "312", label: "tour avg km/h" },
        ],
      },
      {
        type: "p",
        text: "Absolute speed rises with level, but the gap between a player's median and their 90th percentile shrinks on tour. Pros are consistently fast; club players spike. That changes how you set highlight filters — a fixed 300 km/h threshold is almost empty at club level and almost noise on tour.",
      },
      {
        type: "h2",
        kicker: "02 — Positioning, not peak",
        title: "Where winners actually start",
      },
      {
        type: "quote",
        text: "A 290 km/h smash into open court beats a 330 into a set defender. Speed is the amplifier, not the decision.",
      },
      {
        type: "list",
        items: [
          {
            label: "Normalize by level.",
            text: "Set thresholds relative to a player's own distribution, not a global number.",
          },
          {
            label: "Tag open-court winners separately.",
            text: "Filter on defender distance at contact, not only shuttle speed.",
          },
          {
            label: "Watch the setup stroke.",
            text: "Most winning smashes are prepared two shots earlier by a forcing clear or tight net.",
          },
        ],
      },
      {
        type: "rich-p",
        parts: [
          {
            kind: "text",
            text: "In Mintonix, smash filters combine speed, outcome, and court zone so a reel of ",
          },
          { kind: "strong", text: "winners that mattered" },
          {
            kind: "text",
            text: " is one gesture away — not a dump of every hard hit.",
          },
        ],
      },
    ],
  },
  {
    slug: "highlight-workflows",
    title: "Inside the rally graph: how Mintonix segments a match",
    excerpt:
      "A coach workflow: filter by outcome and speed, trim the noise, and ship a link before the next session.",
    lead: "A match is not a video file. Under the hood it's a graph of rallies, strokes, and outcomes — and that graph is what makes one-tap highlight reels possible.",
    category: "Engineering",
    tone: "cyan",
    readTime: "11 min read",
    author: "Devon Hsu",
    role: "Staff engineer",
    bio: "Devon leads the rally segmentation and highlight pipeline at Mintonix. Previously built real-time sports graphics systems.",
    date: "Jun 2, 2026",
    dateIso: "2026-05-22",
    figureCaption: "fig 01 — rally graph excerpt, singles final",
    relatedSlugs: [
      "rally-length-trends",
      "smash-speed-baselines",
      "court-heatmaps",
    ],
    body: [
      {
        type: "p",
        size: "lead",
        text: "When you open the highlight builder and filter for smashes over 300 km/h that ended as winners, you're not scrubbing a timeline. You're querying a graph that was built the moment analysis finished.",
      },
      {
        type: "h2",
        kicker: "01 — From pixels to nodes",
        title: "How a match becomes a graph",
      },
      {
        type: "p",
        text: "Segmentation finds serve-to-dead-shuttle boundaries, shot classification names each contact, and player tracking attaches who hit what. Each rally becomes a node; each stroke an edge with speed, type, and landing zone. Outcomes hang off the terminal stroke.",
      },
      {
        type: "stats",
        items: [
          { v: "~6 min", label: "upload to graph" },
          { v: "27", label: "fields per stroke", accent: true },
          { v: "1 link", label: "to share a reel" },
        ],
      },
      {
        type: "h2",
        kicker: "02 — Coach workflow",
        title: "Filter, assemble, send",
      },
      {
        type: "list",
        items: [
          {
            label: "Pick criteria, not clips.",
            text: "Shot type, speed floor, outcome — stack filters until the count matches what you want to review.",
          },
          {
            label: "Let the graph order them.",
            text: "Reels stay in match order by default so narrative context survives the cut.",
          },
          {
            label: "Ship a link before the next session.",
            text: "Share respects library permissions; revoke anytime.",
          },
        ],
      },
      {
        type: "quote",
        text: "The highlight reel is a saved query over the rally graph — not a pile of exported MP4s.",
      },
      {
        type: "rich-p",
        parts: [
          {
            kind: "text",
            text: "That's why building a reel in Mintonix feels instant: the expensive work already happened during analysis. The builder is just a focused view of the same data you use in ",
          },
          {
            kind: "link",
            text: "video analysis",
            href: "/features/video-analysis",
          },
          { kind: "text", text: "." },
        ],
      },
    ],
  },
  {
    slug: "court-heatmaps",
    title: "Drop, clear, or drive: decoding the third shot",
    excerpt:
      "Zone intensity is only useful when you normalize for rally count. A short guide to what the grid is telling you.",
    lead: "The third shot after the serve sets the rally's geometry. Heatmaps make that choice visible — but only if you know what the grid is actually counting.",
    category: "Coaching",
    tone: "success",
    readTime: "7 min read",
    author: "Lena Okafor",
    role: "Head of coaching content",
    bio: "Lena designs coach-facing analysis workflows at Mintonix. She coached collegiate doubles for eight seasons before joining full-time.",
    date: "May 19, 2026",
    dateIso: "2026-05-10",
    figureCaption: "fig 01 — third-shot landing zones, MS sample",
    relatedSlugs: [
      "smash-speed-baselines",
      "rally-length-trends",
      "highlight-workflows",
    ],
    body: [
      {
        type: "p",
        size: "lead",
        text: "Serve, return, then the shot that decides whether the rally stays calm or detonates. Coaches talk about the third shot constantly; heatmaps finally let you count it without scrubbing an entire match by hand.",
      },
      {
        type: "h2",
        kicker: "01 — Read the grid",
        title: "Intensity is not the same as intent",
      },
      {
        type: "p",
        text: "A bright corner can mean a player loves that zone — or that they were forced there for thirty rallies. Always normalize by rally count and by who initiated. Raw dwell time without context is how heatmaps get misread.",
      },
      {
        type: "stats",
        items: [
          { v: "41%", label: "3rd shots to backcourt" },
          { v: "33%", label: "to mid / drive line", accent: true },
          { v: "26%", label: "tight net replies" },
        ],
      },
      {
        type: "h2",
        kicker: "02 — Drop, clear, or drive",
        title: "Three shapes, three stories",
      },
      {
        type: "list",
        items: [
          {
            label: "Drop.",
            text: "Steals tempo when the returner is deep; heatmap shows front-court landing clusters after weak lifts.",
          },
          {
            label: "Clear.",
            text: "Resets geometry; look for rear-court density paired with high reply lag on the next stroke.",
          },
          {
            label: "Drive.",
            text: "Keeps the rally flat; mid-court heat with low shuttle height is the signature.",
          },
        ],
      },
      {
        type: "quote",
        text: "The third shot is a choice about whose legs the next five strokes will burn.",
      },
      {
        type: "rich-p",
        parts: [
          {
            kind: "text",
            text: "In your own matches, filter third shots by type and overlay the defender's position. Patterns that feel like \"bad luck\" often show up as the same zone, week after week — exactly what ",
          },
          { kind: "link", text: "movement heatmaps", href: "/features/video-analysis" },
          { kind: "text", text: " were built to surface." },
        ],
      },
    ],
  },
];

export function getPostBySlug(slug: string): BlogPost | undefined {
  return blogPosts.find((p) => p.slug === slug);
}

export function getRelatedPosts(post: BlogPost, limit = 3): BlogPost[] {
  const bySlug = new Map(blogPosts.map((p) => [p.slug, p]));
  const fromRelated = post.relatedSlugs
    .map((s) => bySlug.get(s))
    .filter((p): p is BlogPost => p != null && p.slug !== post.slug);

  if (fromRelated.length >= limit) return fromRelated.slice(0, limit);

  const extras = blogPosts.filter(
    (p) => p.slug !== post.slug && !fromRelated.some((r) => r.slug === p.slug),
  );
  return [...fromRelated, ...extras].slice(0, limit);
}

/** Catalog-shaped entries for listings (compatible with older mock-data consumers). */
export const blogCatalogEntries = blogPosts.map((p) => ({
  slug: p.slug,
  title: p.title,
  excerpt: p.excerpt,
  date: p.dateIso,
  category: p.category,
  readTime: p.readTime.replace(/ read$/i, ""),
  author: p.author,
  tone: p.tone,
}));
