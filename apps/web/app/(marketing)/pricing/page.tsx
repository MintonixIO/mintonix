import Link from "next/link";
import { Layers, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pricingRows } from "@/lib/mock-data";

export const metadata = { title: "Pricing" };

function PlanCell({
  children,
  featured,
}: {
  children: React.ReactNode;
  featured?: boolean;
}) {
  return (
    <div
      className={
        featured
          ? "flex items-center justify-center bg-[var(--brand-subtle)] px-3.5 py-3 text-center text-[13px] leading-[1.4] text-[var(--text-primary)]"
          : "flex items-center justify-center px-3.5 py-3 text-center text-[13px] leading-[1.4] text-[var(--text-muted)]"
      }
    >
      {children}
    </div>
  );
}

function SectionRows({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; a: string; b: string; c: string }[];
}) {
  return (
    <>
      <div className="grid grid-cols-[1.5fr_1fr_1.2fr_1fr] border-t border-[var(--border)]">
        <span className="flex items-center px-[22px] pb-2.5 pt-[34px] font-mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
          {title}
        </span>
        <span />
        <span className="bg-[var(--brand-subtle)]" />
        <span />
      </div>
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid grid-cols-[1.5fr_1fr_1.2fr_1fr] border-t border-[var(--border-subtle)] transition-colors hover:bg-[var(--surface-2)]"
        >
          <span className="flex items-center px-[22px] py-3 text-[13.5px] leading-[1.4] text-[var(--text-secondary)]">
            {row.label}
          </span>
          <PlanCell>{row.a}</PlanCell>
          <PlanCell featured>{row.b}</PlanCell>
          <PlanCell>{row.c}</PlanCell>
        </div>
      ))}
    </>
  );
}

const ROADMAP_PLANS = [
  {
    name: "Starter",
    price: "Free",
    note: "Planned personal uploads — not available yet.",
  },
  {
    name: "Pro",
    price: "$19 / seat / mo",
    note: "Planned team seats — contact us for early access.",
  },
  {
    name: "Enterprise",
    price: "Custom",
    note: "Federations & academies — contact sales.",
  },
] as const;

export default function PricingPage() {
  return (
    <div>
      <section className="relative mx-auto max-w-[720px] px-5 pt-20 sm:px-8 sm:pt-[84px]">
        <div className="mb-4 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--accent)]">
          Pricing
        </div>
        <div className="rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-1)] p-6 shadow-[var(--shadow-ring-card)] sm:p-8">
          <div className="flex flex-wrap items-start gap-4">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-[12px] border border-[var(--border)] bg-[var(--accent-soft)] text-[var(--accent)]">
              <Trophy className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1 text-left">
              <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--accent)]">
                Live now
              </div>
              <h1 className="mt-1 font-display text-2xl font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
                BWF catalog — Free
              </h1>
              <p className="mt-2 text-pretty text-sm leading-[1.55] text-[var(--text-secondary)]">
                Matches, players, head-to-head, and allowlisted YouTube sources.
                No sign-in required.
              </p>
              <div className="mt-5">
                <Button href="/bwf" variant="primary" size="lg">
                  Open the BWF catalog
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Mobile stacked roadmap */}
      <section className="relative mx-auto max-w-[720px] px-5 pt-10 sm:px-8 md:hidden">
        <div className="mb-4 text-center font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
          Roadmap (not live)
        </div>
        <div className="grid gap-3">
          {ROADMAP_PLANS.map((plan) => (
            <div
              key={plan.name}
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-5"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-display text-base font-semibold text-[var(--text-strong)]">
                  {plan.name}
                </span>
                <span className="font-mono text-sm tabular-nums text-[var(--text-muted)]">
                  {plan.price}
                </span>
              </div>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                {plan.note}
              </p>
              <Button
                href="/about#contact"
                variant="outline"
                block
                className="mt-4"
              >
                Contact
              </Button>
            </div>
          ))}
        </div>
      </section>

      {/* Desktop comparison */}
      <section className="relative mx-auto hidden max-w-[1140px] px-5 pb-10 pt-14 sm:px-8 md:block">
        <div className="mb-5 text-center">
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
            Roadmap — not live checkout
          </div>
          <h2 className="mt-2 font-display text-xl font-semibold text-[var(--text-strong)] sm:text-2xl">
            Future private-analysis plans
          </h2>
          <p className="mx-auto mt-2 max-w-[48ch] text-pretty text-sm text-[var(--text-secondary)]">
            Indicative only. Contact us for teams or early access — do not
            expect self-serve billing today.
          </p>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[760px] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] opacity-95 shadow-[var(--shadow-ring-card)]">
            <div className="grid grid-cols-[1.5fr_1fr_1.2fr_1fr] bg-[var(--surface-2)]">
              <div className="flex flex-col justify-end p-[26px_22px]">
                <div className="mb-2 inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                  <Layers className="h-[13px] w-[13px]" />
                  Compare (roadmap)
                </div>
                <div className="font-display text-xl font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
                  Private product later
                </div>
                <p className="mt-1.5 text-[12.5px] leading-[1.5] text-[var(--text-muted)]">
                  Not available for purchase on this site.
                </p>
              </div>

              <div className="flex flex-col border-l border-[var(--border-subtle)] p-[26px_18px]">
                <div className="font-display text-base font-semibold text-[var(--text-strong)]">
                  Starter
                </div>
                <div className="my-3 font-display text-[32px] font-semibold tracking-[-0.03em] tabular-nums text-[var(--text-strong)]">
                  Free
                </div>
                <div className="min-h-[34px] text-xs leading-[1.45] text-[var(--text-muted)]">
                  Planned personal uploads.
                </div>
                <div className="mt-auto pt-[18px]">
                  <Button href="/about#contact" variant="outline" block>
                    Ask about access
                  </Button>
                </div>
              </div>

              <div className="relative flex flex-col border-x border-[var(--border-subtle)] bg-[var(--surface-2)] p-[26px_18px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-base font-semibold text-[var(--text-strong)]">
                    Pro
                  </span>
                  <span className="inline-flex min-h-6 items-center rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
                    Planned
                  </span>
                </div>
                <div className="my-3 flex items-baseline gap-1">
                  <span className="font-display text-[32px] font-semibold tracking-[-0.03em] tabular-nums text-[var(--text-strong)]">
                    $19
                  </span>
                  <span className="text-[13px] text-[var(--text-muted)]">
                    /seat / mo
                  </span>
                </div>
                <div className="min-h-[34px] text-xs leading-[1.45] text-[var(--text-muted)]">
                  Planned team seats + minutes.
                </div>
                <div className="mt-auto pt-[18px]">
                  <Button href="/about#contact" variant="outline" block>
                    Contact us
                  </Button>
                </div>
              </div>

              <div className="flex flex-col border-l border-[var(--border-subtle)] p-[26px_18px]">
                <div className="font-display text-base font-semibold text-[var(--text-strong)]">
                  Enterprise
                </div>
                <div className="my-3 font-display text-[32px] font-semibold tracking-[-0.03em] text-[var(--text-strong)]">
                  Custom
                </div>
                <div className="min-h-[34px] text-xs leading-[1.45] text-[var(--text-muted)]">
                  Federations & academies.
                </div>
                <div className="mt-auto pt-[18px]">
                  <Button href="/about#contact" variant="secondary" block>
                    Contact sales
                  </Button>
                </div>
              </div>
            </div>

            <SectionRows title="Usage & limits" rows={pricingRows.usage} />
            <SectionRows title="Analysis" rows={pricingRows.analysis} />
            <SectionRows title="Platform" rows={pricingRows.platform} />
          </div>
        </div>
        <p className="mt-3 text-center text-xs text-[var(--text-faint)]">
          Figures are placeholders for a future private product.
        </p>
      </section>

      <section className="mx-auto max-w-[800px] px-5 pb-24 pt-6 sm:px-8 sm:pt-10">
        <h2 className="text-center font-display text-[28px] font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
          FAQ
        </h2>
        <div className="mt-8 grid gap-3">
          {[
            {
              q: "Is the BWF catalog free?",
              a: "Yes. Browse matches, players, and head-to-head with no account.",
            },
            {
              q: "Can I buy Pro or Starter here?",
              a: "Not yet. Those rows describe a planned private product. Contact us for early access conversations.",
            },
            {
              q: "Where do I start?",
              a: "Open the BWF catalog from the home page or the Open BWF control in the nav.",
            },
          ].map((item) => (
            <details
              key={item.q}
              className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] px-5 py-4"
            >
              <summary className="min-h-11 cursor-pointer list-none font-medium text-[var(--text-strong)] outline-none focus-visible:shadow-[var(--ring)]">
                {item.q}
              </summary>
              <p className="mt-2 text-sm leading-[1.55] text-[var(--text-secondary)]">
                {item.a}
              </p>
            </details>
          ))}
        </div>
        <div className="mt-8 text-center">
          <Link
            href="/bwf"
            className="text-sm text-[var(--text-link)] hover:underline"
          >
            Go to the BWF catalog →
          </Link>
        </div>
      </section>
    </div>
  );
}
