import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, ArrowLeft, Link as LinkIcon, Share2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import { BlogBody } from "@/components/marketing/blog-body";
import {
  blogPosts,
  getPostBySlug,
  getRelatedPosts,
} from "@/lib/blog/posts";

export function generateStaticParams() {
  return blogPosts.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  return { title: post?.title ?? "Blog" };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  const related = getRelatedPosts(post, 3);

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
              <Badge tone="brand">{post.category}</Badge>
              <span className="font-mono text-[11px] text-[var(--text-muted)]">
                {post.readTime}
              </span>
            </div>

            <h1 className="font-display text-[clamp(32px,4.6vw,52px)] font-semibold leading-[1.06] tracking-[-0.03em] text-[var(--text-strong)] text-balance">
              {post.title}
            </h1>

            <p className="mt-[22px] text-[clamp(16px,1.6vw,19px)] leading-[1.6] text-[var(--text-secondary)] text-pretty">
              {post.lead}
            </p>

            <div className="mt-[30px] flex items-center gap-3 border-y border-[var(--border-subtle)] py-[22px]">
              <Avatar name={post.author} size={40} />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium text-[var(--text-strong)]">
                  {post.author}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-[var(--text-muted)]">
                  {post.role} · {post.date}
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
                {post.figureCaption}
              </span>
            </div>
          </figure>
        </div>

        <BlogBody blocks={post.body} />

        <div className="mx-auto mt-14 max-w-[760px] px-8">
          <div className="flex items-start gap-4 rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-6 shadow-[var(--shadow-edge)]">
            <Avatar name={post.author} size={48} />
            <div className="min-w-0 flex-1">
              <div className="font-display text-[15px] font-semibold text-[var(--text-strong)]">
                {post.author}
              </div>
              <div className="mt-0.5 font-mono text-[11px] tracking-[0.04em] text-[var(--brand,#3693ff)]">
                {post.role}
              </div>
              <p className="mt-3 text-[14px] leading-[1.62] text-[var(--text-secondary)]">
                {post.bio}
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
          <Link
            href="/blog"
            className="text-[13px] text-[var(--brand,#3693ff)] no-underline"
          >
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
                <Activity
                  className="h-[38px] w-[38px] text-[rgba(54,147,255,0.5)]"
                  strokeWidth={1.25}
                />
              </div>
              <div className="flex flex-1 flex-col px-5 pb-5 pt-[18px]">
                <div className="flex items-center gap-[9px]">
                  <Badge tone={p.tone}>{p.category}</Badge>
                  <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
                    {p.readTime}
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
