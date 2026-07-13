"use client";

import Link from "next/link";
import {
  Activity,
  BookOpen,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Crosshair,
  LifeBuoy,
  Mail,
  Rocket,
  Search,
  SearchX,
  Shield,
  SlidersHorizontal,
  UploadCloud,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { AppTopbar } from "@/components/app/app-topbar";

const FAQS = [
  {
    q: "What video formats and sizes can I upload?",
    a: "Mintonix accepts MP4, MOV, and MKV files up to 8 GB, at 1080p or 4K. For best tracking, upload a single stable camera angle of the full court.",
  },
  {
    q: "How long does analysis take?",
    a: 'Most singles matches finish in 8–15 minutes depending on length and resolution. You can leave the page — uploads keep processing and appear under "In the pipeline" on your dashboard.',
  },
  {
    q: "How do I create a highlight reel?",
    a: "Open any analyzed match and choose New highlight, then set a clip filter — shot type, rally length, or speed. Mintonix assembles matching clips into a reel you can trim and share.",
  },
  {
    q: "Can I change or cancel my plan?",
    a: "Yes. Go to Settings → Billing & plan to upgrade, downgrade, or cancel. Changes take effect at the start of your next billing cycle, and unused analysis minutes roll over once.",
  },
  {
    q: "Who can see my uploaded footage?",
    a: "Only you and the members of your workspace. Footage and highlights are private by default; sharing a reel generates a link you control and can revoke anytime.",
  },
  {
    q: "How is shot speed measured?",
    a: "Speed is estimated from shuttle tracking across calibrated court dimensions. Running the calibration step on your camera angle improves accuracy for smash and clear speeds.",
  },
];

const TOPICS = [
  {
    icon: Rocket,
    title: "Getting started",
    desc: "Set up your workspace and analyze a first match.",
    count: 8,
    href: "/docs",
  },
  {
    icon: UploadCloud,
    title: "Uploading footage",
    desc: "Formats, camera angles, and file limits.",
    count: 6,
    href: "/docs",
  },
  {
    icon: SlidersHorizontal,
    title: "Analysis & highlights",
    desc: "Clip filters, shot speed, and reels.",
    count: 11,
    href: "/docs",
  },
  {
    icon: Crosshair,
    title: "Calibration",
    desc: "Improve tracking accuracy on your court.",
    count: 5,
    href: "/calibration",
  },
  {
    icon: CreditCard,
    title: "Billing & plans",
    desc: "Subscriptions, minutes, and invoices.",
    count: 7,
    href: "/settings",
  },
  {
    icon: Shield,
    title: "Account & privacy",
    desc: "Members, sharing, and data controls.",
    count: 9,
    href: "/privacy",
  },
];

export default function HelpSupportPage() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Record<number, boolean>>({});

  const q = query.trim().toLowerCase();
  const hasQuery = q.length > 0;

  const faqs = useMemo(() => {
    return FAQS.map((f, i) => ({ ...f, i })).filter(
      (f) => !hasQuery || `${f.q} ${f.a}`.toLowerCase().includes(q),
    );
  }, [q, hasQuery]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <AppTopbar
        title="Help & support"
        showSearch={false}
        showBell={false}
        showAccount={false}
        actions={
          <Link
            href="/about#contact"
            className="inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface-1)] px-[15px] text-[13.5px] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]"
          >
            <Mail className="h-4 w-4" />
            Contact the team
          </Link>
        }
      />

      <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-[26px] p-7">
        <section className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] px-8 pt-[38px] pb-[34px]">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(80% 130% at 50% -10%, rgba(54,147,255,0.16), transparent 58%)",
            }}
          />
          <div className="relative mx-auto max-w-[620px] text-center">
            <div className="mb-3.5 font-mono text-[11px] tracking-[0.14em] text-[var(--accent)] uppercase">
              Help center
            </div>
            <h1 className="font-display text-[clamp(26px,3.4vw,34px)] leading-[1.1] font-semibold tracking-[-0.02em] text-balance text-[var(--text-strong)]">
              How can we help, Viktor?
            </h1>
            <p className="mt-3 mb-[22px] text-[14.5px] leading-relaxed text-[var(--text-secondary)]">
              Search the guides, browse a topic, or reach a human — most
              questions are answered in a minute.
            </p>
            <label className="mx-auto flex h-[50px] max-w-[520px] items-center gap-[11px] rounded-xl border border-[var(--border-strong)] bg-[var(--ink-850,#0d0e12)] px-4 shadow-[var(--shadow-md)]">
              <Search className="h-[18px] w-[18px] shrink-0 text-[var(--accent)]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search help articles…"
                className="min-w-0 flex-1 border-none bg-transparent text-[15px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-faint)]"
              />
              {hasQuery ? (
                <button
                  type="button"
                  aria-label="Clear"
                  onClick={() => setQuery("")}
                  className="inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] text-[var(--text-muted)]"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </label>
          </div>
        </section>

        {!hasQuery ? (
          <section className="flex flex-col gap-3.5">
            <h2 className="font-display text-base font-semibold tracking-[-0.01em] text-[var(--text-strong)]">
              Browse by topic
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {TOPICS.map((t) => {
                const Icon = t.icon;
                return (
                  <Link
                    key={t.title}
                    href={t.href}
                    className="flex flex-col gap-[11px] rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-[18px] shadow-[var(--shadow-edge)] transition-all hover:-translate-y-0.5 hover:border-[var(--border-strong)]"
                  >
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-[11px] border border-[var(--border)] bg-[var(--accent-soft)] text-[var(--accent)]">
                      <Icon className="h-[19px] w-[19px]" />
                    </span>
                    <span>
                      <span className="block text-[14.5px] font-semibold text-[var(--text-strong)]">
                        {t.title}
                      </span>
                      <span className="mt-0.5 block text-[13px] leading-relaxed text-[var(--text-secondary)]">
                        {t.desc}
                      </span>
                    </span>
                    <span className="font-mono text-[11px] text-[var(--text-muted)]">
                      {t.count} articles
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        ) : null}

        <section className="flex flex-col gap-3.5">
          <div className="flex items-center gap-2.5">
            <h2 className="font-display text-base font-semibold tracking-[-0.01em] text-[var(--text-strong)]">
              {hasQuery ? "Search results" : "Frequently asked"}
            </h2>
            <span className="font-mono text-xs text-[var(--text-muted)]">
              {hasQuery
                ? `${faqs.length} ${faqs.length === 1 ? "result" : "results"}`
                : `${faqs.length} articles`}
            </span>
          </div>

          {faqs.length > 0 ? (
            <div className="flex flex-col gap-2.5">
              {faqs.map((f) => {
                const isOpen = !!open[f.i] || hasQuery;
                return (
                  <div
                    key={f.i}
                    className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-1)]"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setOpen((s) => ({ ...s, [f.i]: !s[f.i] }))
                      }
                      className="flex w-full items-center gap-3.5 px-[18px] py-4 text-left"
                    >
                      <span className="min-w-0 flex-1 text-[14.5px] font-medium text-[var(--text-strong)]">
                        {f.q}
                      </span>
                      {isOpen ? (
                        <ChevronUp className="h-[18px] w-[18px] shrink-0 text-[var(--text-muted)]" />
                      ) : (
                        <ChevronDown className="h-[18px] w-[18px] shrink-0 text-[var(--text-muted)]" />
                      )}
                    </button>
                    {isOpen ? (
                      <div className="px-[18px] pb-[17px] text-[13.5px] leading-[1.65] text-[var(--text-secondary)]">
                        {f.a}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-[13px] border border-dashed border-[var(--border)] bg-[var(--surface-1)] p-[22px]">
              <span className="inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] bg-[var(--accent-soft)] text-[var(--accent)]">
                <SearchX className="h-[18px] w-[18px]" />
              </span>
              <div>
                <div className="text-sm font-medium text-[var(--text-strong)]">
                  No articles match &ldquo;{query}&rdquo;
                </div>
                <div className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
                  Try a different term, or{" "}
                  <Link
                    href="/about#contact"
                    className="text-[var(--text-link)]"
                  >
                    message the team
                  </Link>
                  .
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="grid grid-cols-1 gap-4 pb-3 sm:grid-cols-2 xl:grid-cols-3">
          <Link
            href="/about#contact"
            className="flex items-start gap-3.5 rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-5 hover:border-[var(--border-strong)]"
          >
            <span className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[11px] border border-[var(--border)] bg-[var(--accent-soft)] text-[var(--accent)]">
              <LifeBuoy className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-[14.5px] font-semibold text-[var(--text-strong)]">
                Email support
              </span>
              <span className="mt-0.5 block text-[13px] leading-relaxed text-[var(--text-secondary)]">
                support@mintonix.com · replies within one business day
              </span>
            </span>
          </Link>
          <Link
            href="/docs"
            className="flex items-start gap-3.5 rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-5 hover:border-[var(--border-strong)]"
          >
            <span className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[11px] border border-[var(--border)] bg-[var(--accent-soft)] text-[var(--accent)]">
              <BookOpen className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-[14.5px] font-semibold text-[var(--text-strong)]">
                Documentation
              </span>
              <span className="mt-0.5 block text-[13px] leading-relaxed text-[var(--text-secondary)]">
                Guides, the analysis API, and clip-filter recipes
              </span>
            </span>
          </Link>
          <div className="flex items-start gap-3.5 rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-5">
            <span className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[11px] border border-[var(--border)] bg-[var(--success-bg)] text-[var(--success-500)]">
              <Activity className="h-5 w-5" />
            </span>
            <span>
              <span className="flex items-center gap-2 text-[14.5px] font-semibold text-[var(--text-strong)]">
                System status
                <span className="h-[7px] w-[7px] rounded-full bg-[var(--success-500)] shadow-[0_0_0_3px_var(--success-bg)]" />
              </span>
              <span className="mt-0.5 block text-[13px] leading-relaxed text-[var(--text-secondary)]">
                All systems operational · analysis queue normal
              </span>
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
