"use client";

import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Gauge,
  LineChart,
  Target,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { blogPosts } from "@/lib/mock-data";

const ICONS: LucideIcon[] = [Activity, BarChart3, Gauge, LineChart, Target, Zap];

const POSTS = blogPosts.map((p, i) => ({
  ...p,
  author: p.author ?? (i % 2 === 0 ? "Viktor Koster" : "Aya Chen"),
  figure: `0${i + 1}`,
  icon: ICONS[i % ICONS.length],
  tone: (p.tone ??
    (["brand", "success", "cyan", "warning"] as const)[i % 4]) as
    | "brand"
    | "success"
    | "cyan"
    | "warning",
}));

export function BlogCatalog() {
  const [category, setCategory] = useState("all");

  const filtered = useMemo(() => {
    if (category === "all") return POSTS;
    return POSTS.filter(
      (p) => p.category.toLowerCase() === category.toLowerCase(),
    );
  }, [category]);

  const featured = POSTS[0];
  const grid = filtered.filter(
    (p) => p.slug !== featured.slug || category !== "all",
  );

  return (
    <>
      <section className="mx-auto max-w-[1320px] px-8 pt-10">
        <div className="flex flex-wrap items-center gap-4 border-b border-[var(--border-subtle)] pb-[18px]">
          <Tabs
            variant="pill"
            value={category}
            onChange={setCategory}
            items={[
              { value: "all", label: "All" },
              { value: "analysis", label: "Analysis" },
              { value: "coaching", label: "Coaching" },
              { value: "engineering", label: "Engineering" },
            ]}
          />
          <div className="flex-1" />
          <span className="font-mono text-[11px] tracking-wide text-[var(--text-muted)]">
            {filtered.length} posts
          </span>
        </div>
      </section>

      {category === "all" ||
      featured.category.toLowerCase() === category ? (
        <section className="mx-auto max-w-[1320px] px-8 pt-7">
          <Link
            href={`/blog/${featured.slug}`}
            className="group grid overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-lg),var(--shadow-edge)] transition-transform hover:-translate-y-0.5 hover:border-[var(--border-strong)] md:grid-cols-[1.15fr_1fr]"
          >
            <div
              className="relative flex min-h-[280px] items-center justify-center border-b border-[var(--border-subtle)] bg-[var(--bg-sunken)] md:min-h-[340px] md:border-b-0 md:border-r"
              style={{
                backgroundImage:
                  "radial-gradient(120% 90% at 30% 0%, rgba(54,147,255,0.20), transparent 60%), linear-gradient(rgba(54,147,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(54,147,255,0.06) 1px, transparent 1px)",
                backgroundSize: "auto, 40px 40px, 40px 40px",
              }}
            >
              <featured.icon
                className="h-16 w-16 text-[rgba(54,147,255,0.55)]"
                strokeWidth={1.25}
              />
              <span className="absolute bottom-4 left-[18px] font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-faint)]">
                fig — {featured.figure}
              </span>
              <span className="absolute left-[18px] top-[18px]">
                <Badge tone="brand" pill>
                  Featured
                </Badge>
              </span>
            </div>
            <div className="flex flex-col p-8 md:p-[34px]">
              <div className="flex items-center gap-2.5">
                <Badge tone={featured.tone}>{featured.category}</Badge>
                <span className="font-mono text-[11px] text-[var(--text-muted)]">
                  {featured.readTime}
                </span>
              </div>
              <h2 className="mt-[18px] font-display text-[clamp(24px,2.4vw,32px)] font-semibold leading-[1.12] tracking-[-0.025em] text-[var(--text-strong)] text-balance">
                {featured.title}
              </h2>
              <p className="mt-3.5 text-[15.5px] leading-[1.62] text-[var(--text-secondary)]">
                {featured.excerpt}
              </p>
              <div className="flex-1" />
              <div className="mt-7 flex items-center gap-2.5 border-t border-[var(--border-subtle)] pt-[22px]">
                <Avatar name={featured.author} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium text-[var(--text-strong)]">
                    {featured.author}
                  </div>
                  <div className="mt-px font-mono text-[11px] text-[var(--text-muted)]">
                    {featured.date}
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-[var(--brand)]">
                  Read
                  <ArrowRight className="h-[15px] w-[15px] transition-transform group-hover:translate-x-0.5" />
                </span>
              </div>
            </div>
          </Link>
        </section>
      ) : null}

      <section className="mx-auto max-w-[1320px] px-8 pt-[22px]">
        {grid.length ? (
          <div className="grid gap-[18px] sm:grid-cols-2 xl:grid-cols-3">
            {grid.map((p) => (
              <Link
                key={p.slug}
                href={`/blog/${p.slug}`}
                className="group flex flex-col overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-edge)] transition-transform hover:-translate-y-0.5 hover:border-[var(--border-strong)]"
              >
                <div
                  className="relative flex h-[168px] items-center justify-center border-b border-[var(--border-subtle)] bg-[var(--bg-sunken)]"
                  style={{
                    backgroundImage:
                      "radial-gradient(120% 100% at 70% 0%, rgba(54,147,255,0.16), transparent 60%), linear-gradient(rgba(54,147,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(54,147,255,0.05) 1px, transparent 1px)",
                    backgroundSize: "auto, 34px 34px, 34px 34px",
                  }}
                >
                  <p.icon
                    className="h-10 w-10 text-[rgba(54,147,255,0.5)]"
                    strokeWidth={1.25}
                  />
                  <span className="absolute bottom-3 left-3.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--text-faint)]">
                    fig — {p.figure}
                  </span>
                </div>
                <div className="flex flex-1 flex-col px-5 pb-5 pt-[18px]">
                  <div className="flex items-center gap-2">
                    <Badge tone={p.tone}>{p.category}</Badge>
                    <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
                      {p.readTime}
                    </span>
                  </div>
                  <h3 className="mt-3 font-display text-lg font-semibold leading-[1.22] tracking-[-0.015em] text-[var(--text-strong)] text-balance">
                    {p.title}
                  </h3>
                  <p className="mt-2 text-[13.5px] leading-[1.55] text-[var(--text-secondary)]">
                    {p.excerpt}
                  </p>
                  <div className="flex-1" />
                  <div className="mt-5 flex items-center gap-2 border-t border-[var(--border-subtle)] pt-[15px]">
                    <Avatar name={p.author} size={26} />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--text-secondary)]">
                      {p.author}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-[var(--text-muted)]">
                      {p.date}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-[14px] border border-dashed border-[var(--border)] px-6 py-16 text-center text-[var(--text-muted)]">
            <div className="font-display text-base text-[var(--text-secondary)]">
              Nothing here yet.
            </div>
            <div className="mt-1.5 text-[13.5px]">
              No posts in this category — check back soon.
            </div>
          </div>
        )}
      </section>

      <section className="mx-auto max-w-[1320px] px-8 pb-24 pt-24">
        <div className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-8 shadow-[var(--shadow-edge)] md:p-11">
          <div
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{
              background:
                "radial-gradient(80% 120% at 100% 0%, rgba(54,147,255,0.16), transparent 55%)",
            }}
          />
          <div className="relative grid items-center gap-8 md:grid-cols-[1.1fr_1fr]">
            <div>
              <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.13em] text-[var(--brand)]">
                Get it in your inbox
              </div>
              <h2 className="font-display text-[clamp(24px,3vw,34px)] font-semibold tracking-[-0.025em] text-[var(--text-strong)]">
                Shipping notes — coming later.
              </h2>
              <p className="mt-3 max-w-[46ch] text-[14.5px] leading-[1.6] text-[var(--text-secondary)]">
                Match-reading notes, product shipping logs, and the occasional
                dataset — only when it&apos;s worth the inbox slot.
              </p>
            </div>
            <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4">
              <p className="text-[13.5px] leading-relaxed text-[var(--text-secondary)]">
                Email notes are planned — there is no mailing list signup yet.
                Follow the{" "}
                <a href="/changelog" className="text-[var(--text-link)] hover:underline">
                  changelog
                </a>{" "}
                for public BWF releases.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
