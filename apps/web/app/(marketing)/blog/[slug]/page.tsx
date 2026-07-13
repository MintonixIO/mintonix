import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  Crosshair,
  GitBranch,
  Link as LinkIcon,
  Route,
  Share2,
  type LucideIcon,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import { blogPosts } from "@/lib/mock-data";

export function generateStaticParams() {
  return blogPosts.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = blogPosts.find((p) => p.slug === slug);
  return { title: post?.title ?? "Blog" };
}

const RELATED: {
  slug: string;
  category: string;
  tone: "brand" | "cyan" | "success";
  icon: LucideIcon;
  read: string;
  title: string;
  author: string;
  date: string;
}[] = [
  {
    slug: "smash-speed-baselines",
    category: "Analysis",
    tone: "brand",
    icon: Crosshair,
    read: "6 min read",
    title: "What 12,000 smashes reveal about court positioning",
    author: "Marcus Feld",
    date: "Jun 9, 2026",
  },
  {
    slug: "highlight-workflows",
    category: "Engineering",
    tone: "cyan",
    icon: GitBranch,
    read: "11 min read",
    title: "Inside the rally graph: how Mintonix segments a match",
    author: "Devon Hsu",
    date: "Jun 2, 2026",
  },
  {
    slug: "court-heatmaps",
    category: "Coaching",
    tone: "success",
    icon: Route,
    read: "7 min read",
    title: "Drop, clear, or drive: decoding the third shot",
    author: "Lena Okafor",
    date: "May 19, 2026",
  },
];

const FULL_ARTICLE = {
  author: "Priya Nadar",
  role: "Performance analyst",
  date: "Jun 16, 2026",
  category: "Analysis" as const,
  read: "8 min read",
  lead: "Shuttle speed within a rally rises and falls in patterns. We mapped the tempo curve of 4,000 rallies and found where points are actually decided — long before the final stroke lands.",
  bio: "Priya builds the rally and tempo models at Mintonix. Former national-level player, now turning footage into the patterns coaches can act on.",
};

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = blogPosts.find((p) => p.slug === slug);
  if (!post) notFound();

  const title =
    slug === "rally-length-trends"
      ? "Reading rally tempo: what shot pace tells you before the point ends"
      : post.title;
  const lead =
    slug === "rally-length-trends" ? FULL_ARTICLE.lead : post.excerpt;
  const category =
    slug === "rally-length-trends" ? FULL_ARTICLE.category : post.category;
  const read =
    slug === "rally-length-trends" ? FULL_ARTICLE.read : post.readTime;
  const author = FULL_ARTICLE.author;
  const related = RELATED.filter((r) => r.slug !== slug).slice(0, 3);

  return (
    <div>
      <article>
        <header className="relative">
          <div
            className="pointer-events-none absolute inset-0 opacity-50"
            style={{
              backgroundImage:
                "linear-gradient(rgba(54,147,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(54,147,255,0.05) 1px, transparent 1px)",
              backgroundSize: "64px 64px",
              maskImage:
                "radial-gradient(90% 80% at 50% 0%, #000 30%, transparent 78%)",
              WebkitMaskImage:
                "radial-gradient(90% 80% at 50% 0%, #000 30%, transparent 78%)",
            }}
          />
          <div className="relative mx-auto max-w-[760px] px-8 pt-10">
            <Link
              href="/blog"
              className="mb-7 inline-flex items-center gap-1.5 text-[13px] text-[var(--text-muted)] no-underline hover:text-[var(--text-secondary)]"
            >
              <ArrowLeft className="h-[15px] w-[15px]" />
              All posts
            </Link>

            <div className="mb-[18px] flex items-center gap-[11px]">
              <Badge tone="brand">{category}</Badge>
              <span className="font-mono text-[11px] text-[var(--text-muted)]">
                {read}
              </span>
            </div>

            <h1 className="font-display text-[clamp(32px,4.6vw,52px)] font-semibold leading-[1.06] tracking-[-0.03em] text-[var(--text-strong)] text-balance">
              {title}
            </h1>

            <p className="mt-[22px] text-[clamp(16px,1.6vw,19px)] leading-[1.6] text-[var(--text-secondary)] text-pretty">
              {lead}
            </p>

            <div className="mt-[30px] flex items-center gap-3 border-y border-[var(--border-subtle)] py-[22px]">
              <Avatar name={author} size={40} />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium text-[var(--text-strong)]">
                  {author}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-[var(--text-muted)]">
                  {FULL_ARTICLE.role} · {FULL_ARTICLE.date}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <IconButton variant="ghost" label="Share on X">
                  <Share2 className="h-[17px] w-[17px]" />
                </IconButton>
                <IconButton variant="ghost" label="Copy link">
                  <LinkIcon className="h-[17px] w-[17px]" />
                </IconButton>
              </div>
            </div>
          </div>
        </header>

        <div className="mx-auto mt-9 max-w-[920px] px-8">
          <figure className="m-0">
            <div
              className="relative flex h-[clamp(240px,34vw,420px)] items-center justify-center overflow-hidden rounded-2xl border border-[var(--border)] shadow-[var(--shadow-edge)]"
              style={{
                background:
                  "radial-gradient(120% 90% at 40% 0%, rgba(54,147,255,0.18), transparent 60%), linear-gradient(rgba(54,147,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(54,147,255,0.05) 1px, transparent 1px), var(--bg-sunken, #070809)",
                backgroundSize: "auto, 40px 40px, 40px 40px, auto",
              }}
            >
              <Activity
                className="h-[72px] w-[72px] text-[rgba(54,147,255,0.5)]"
                strokeWidth={1.1}
              />
              <span className="absolute bottom-4 left-5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-faint)]">
                fig 01 — rally tempo curve, 4,000 rallies
              </span>
            </div>
          </figure>
        </div>

        <div className="mx-prose mx-auto mt-12 max-w-[760px] px-8">
          <p className="mb-[22px] text-[19px] leading-[1.66] text-[var(--text-strong)]">
            Every rally has a rhythm. Watch enough of them and you start to feel
            it — a slow exchange of clears, a sudden acceleration, then the
            stroke that ends it. The question we set out to answer was whether
            that feel could be measured, and whether the measurement arrived{" "}
            <strong className="font-semibold text-[var(--text-strong)]">
              before
            </strong>{" "}
            the point did.
          </p>

          <p className="mb-[22px] text-[17px] leading-[1.72] text-[var(--text-secondary)]">
            It can. Across 4,000 singles rallies, shuttle speed traces a
            repeatable curve: a calm opening, a steep mid-rally ramp, and a final
            spike that is almost always a consequence — not a cause — of the
            point being won. By the time the speed peaks, the rally is usually
            already decided. This note walks through the pattern behind{" "}
            {post.title.toLowerCase()}.
          </p>

          <h2 className="mt-11 font-display text-[26px] font-semibold leading-[1.18] tracking-[-0.02em] text-[var(--text-strong)]">
            <span className="mb-2.5 block font-mono text-[11px] font-normal uppercase tracking-[0.14em] text-[var(--brand,#3693ff)]">
              01 — The shape of a rally
            </span>
            The tempo curve, stroke by stroke
          </h2>

          <p className="mt-5 mb-[22px] text-[17px] leading-[1.72] text-[var(--text-secondary)]">
            We normalised every rally to its length and averaged shuttle speed at
            each relative stroke. The result is strikingly consistent. The opening
            four strokes sit in a narrow band — players probing, not committing.
            Then, somewhere around the rally&apos;s midpoint, the curve bends
            sharply upward.
          </p>

          <div className="my-8 grid grid-cols-3 gap-px overflow-hidden rounded-[13px] border border-[var(--border)] bg-[var(--border-subtle)]">
            {[
              { v: "9.4", label: "avg rally length", accent: false },
              { v: "+38%", label: "mid-rally speed ramp", accent: true },
              { v: "72%", label: "decided before peak", accent: false },
            ].map((s) => (
              <div key={s.label} className="bg-[var(--surface-1)] px-5 py-[22px]">
                <div
                  className={`font-display text-[30px] font-semibold tracking-[-0.02em] tabular-nums ${
                    s.accent ? "text-[var(--brand,#3693ff)]" : "text-[var(--text-strong)]"
                  }`}
                >
                  {s.v}
                </div>
                <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          <p className="mb-[22px] text-[17px] leading-[1.72] text-[var(--text-secondary)]">
            That bend is the moment of intent. One player has decided to take
            control of the rally, and the speed of their strokes reflects it. The
            opponent&apos;s reply speed lags by one to two strokes — a measurable
            tell that they are reacting rather than dictating.
          </p>

          <h2 className="mt-11 font-display text-[26px] font-semibold leading-[1.18] tracking-[-0.02em] text-[var(--text-strong)]">
            <span className="mb-2.5 block font-mono text-[11px] font-normal uppercase tracking-[0.14em] text-[var(--brand,#3693ff)]">
              02 — Where points are decided
            </span>
            The lag is the signal
          </h2>

          <p className="mt-5 mb-[22px] text-[17px] leading-[1.72] text-[var(--text-secondary)]">
            When we line up the two players&apos; speed curves against each other,
            the gap between them predicts the outcome better than the peak speed
            itself. The player who first opens a sustained speed advantage — and
            holds it for three or more strokes — wins the rally{" "}
            <strong className="font-semibold text-[var(--text-strong)]">
              72% of the time
            </strong>
            .
          </p>

          <blockquote className="my-8 border-l-[3px] border-[var(--brand,#3693ff)] py-1 pl-6 font-display text-[22px] leading-[1.4] tracking-[-0.015em] text-[var(--text-strong)]">
            The smash doesn&apos;t win the point. It confirms a point that the
            tempo decided three strokes earlier.
          </blockquote>

          <p className="mb-[22px] text-[17px] leading-[1.72] text-[var(--text-secondary)]">
            This reframes how we think about the highlight reel. The 330 km/h
            smash is the visible climax, but the rally was lost in the quiet
            acceleration that forced the defender out of position. That&apos;s the
            stroke a coach should be watching.
          </p>

          <ul className="mb-6 flex list-none flex-col gap-3 p-0">
            {[
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
            ].map((item) => (
              <li
                key={item.label}
                className="relative pl-6 text-[16.5px] leading-[1.62] text-[var(--text-secondary)] before:absolute before:left-1 before:top-[11px] before:h-1.5 before:w-1.5 before:rounded-sm before:bg-[var(--brand,#3693ff)]"
              >
                <strong className="font-semibold text-[var(--text-strong)]">
                  {item.label}
                </strong>{" "}
                {item.text}
              </li>
            ))}
          </ul>

          <h2 className="mt-11 font-display text-[26px] font-semibold leading-[1.18] tracking-[-0.02em] text-[var(--text-strong)]">
            <span className="mb-2.5 block font-mono text-[11px] font-normal uppercase tracking-[0.14em] text-[var(--brand,#3693ff)]">
              03 — What this means for you
            </span>
            Tempo in your own matches
          </h2>

          <p className="mt-5 mb-[22px] text-[17px] leading-[1.72] text-[var(--text-secondary)]">
            Every match you upload to Mintonix gets the same tempo curve.
            You&apos;ll see your own ramp point, your reply lag against each
            opponent, and the rallies where a sustained speed advantage turned
            into a won point. It&apos;s the pattern behind the score — and now
            it&apos;s measurable in minutes.
          </p>

          <p className="mb-[22px] text-[17px] leading-[1.72] text-[var(--text-secondary)]">
            Upload a match to see your tempo curve, or browse the{" "}
            <Link
              href="/features/bwf"
              className="border-b border-[rgba(54,147,255,0.4)] text-[var(--brand,#3693ff)] no-underline"
            >
              BWF library
            </Link>{" "}
            to study how the best players in the world shape a rally.
          </p>
        </div>

        <div className="mx-auto mt-14 max-w-[760px] px-8">
          <div className="flex items-start gap-4 rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-6 shadow-[var(--shadow-edge)]">
            <Avatar name={author} size={48} />
            <div className="min-w-0 flex-1">
              <div className="font-display text-[15px] font-semibold text-[var(--text-strong)]">
                {author}
              </div>
              <div className="mt-0.5 font-mono text-[11px] tracking-[0.04em] text-[var(--brand,#3693ff)]">
                {FULL_ARTICLE.role}
              </div>
              <p className="mt-3 text-[14px] leading-[1.62] text-[var(--text-secondary)]">
                {FULL_ARTICLE.bio}
              </p>
            </div>
          </div>
        </div>
      </article>

      <section className="mx-auto mt-[88px] max-w-[1320px] px-8 pb-8">
        <div className="mb-[22px] flex items-baseline gap-3">
          <h2 className="font-display text-[22px] font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
            Keep reading
          </h2>
          <Link href="/blog" className="text-[13px] text-[var(--brand,#3693ff)] no-underline">
            All posts
          </Link>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(312px,1fr))] gap-[18px]">
          {related.map((p) => (
            <Link
              key={p.slug}
              href={`/blog/${p.slug}`}
              className="group flex flex-col overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] no-underline shadow-[var(--shadow-edge)] transition-[transform,border-color] duration-200 hover:-translate-y-[3px] hover:border-[var(--border-strong)]"
            >
              <div
                className="relative flex h-[148px] items-center justify-center border-b border-[var(--border-subtle)]"
                style={{
                  background:
                    "radial-gradient(120% 100% at 70% 0%, rgba(54,147,255,0.16), transparent 60%), linear-gradient(rgba(54,147,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(54,147,255,0.05) 1px, transparent 1px), var(--bg-sunken, #070809)",
                  backgroundSize: "auto, 34px 34px, 34px 34px, auto",
                }}
              >
                <p.icon
                  className="h-[38px] w-[38px] text-[rgba(54,147,255,0.5)]"
                  strokeWidth={1.25}
                />
              </div>
              <div className="flex flex-1 flex-col px-5 pb-5 pt-[18px]">
                <div className="flex items-center gap-[9px]">
                  <Badge tone={p.tone}>{p.category}</Badge>
                  <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
                    {p.read}
                  </span>
                </div>
                <h3 className="mt-[13px] font-display text-[17px] font-semibold leading-[1.24] tracking-[-0.015em] text-[var(--text-strong)] text-balance">
                  {p.title}
                </h3>
                <div className="flex-1" />
                <div className="mt-[18px] flex items-center gap-[9px] border-t border-[var(--border-subtle)] pt-3.5">
                  <Avatar name={p.author} size={24} />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--text-secondary)]">
                    {p.author}
                  </span>
                  <span className="flex-none font-mono text-[11px] text-[var(--text-muted)]">
                    {p.date}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
