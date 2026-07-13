import Link from "next/link";
import { Layers } from "lucide-react";
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
          ? "flex items-center justify-center px-3.5 py-3 text-center text-[13px] leading-[1.4] text-[var(--text-primary)] bg-[rgba(54,147,255,0.05)]"
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
        <span className="flex items-center px-[22px] pb-2.5 pt-[34px] font-mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
          {title}
        </span>
        <span />
        <span className="bg-[rgba(54,147,255,0.05)]" />
        <span />
      </div>
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid grid-cols-[1.5fr_1fr_1.2fr_1fr] border-t border-[var(--border-subtle)] transition-colors hover:bg-[rgba(54,147,255,0.045)]"
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

export default function PricingPage() {
  return (
    <div>
      <section className="relative">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(110% 55% at 50% -10%, rgba(54,147,255,0.16), transparent 56%)",
          }}
        />
        <div className="relative mx-auto max-w-[1100px] px-8 pt-[84px] text-center">
          <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--accent)]">
            Pricing
          </div>
          <h1 className="mx-auto max-w-[18ch] font-display text-[clamp(34px,5vw,56px)] font-semibold leading-[1.06] tracking-[-0.03em] text-[var(--text-strong)] text-balance">
            Start free. Pay only for what you analyze.
          </h1>
          <p className="mx-auto mt-5 max-w-[54ch] text-[17px] leading-[1.6] text-[var(--text-secondary)]">
            Three plans, one engine. Begin on Starter, scale on Pro with
            pay-as-you-go uploads, and bring your whole federation on Enterprise.
          </p>
        </div>
      </section>

      <section className="relative mx-auto max-w-[1140px] px-8 pb-10 pt-14">
        <div className="overflow-x-auto">
          <div className="min-w-[760px] overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-edge)]">
            <div className="grid grid-cols-[1.5fr_1fr_1.2fr_1fr] bg-[var(--surface-2)]">
              <div className="flex flex-col justify-end p-[26px_22px]">
                <div className="mb-2 inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--accent)]">
                  <Layers className="h-[13px] w-[13px]" />
                  Compare plans
                </div>
                <div className="font-display text-xl font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
                  Find your fit
                </div>
                <p className="mt-1.5 text-[12.5px] leading-[1.5] text-[var(--text-muted)]">
                  No credit card to start. Cancel anytime.
                </p>
              </div>

              <div className="flex flex-col border-l border-[var(--border-subtle)] p-[26px_18px]">
                <div className="font-display text-base font-semibold text-[var(--text-strong)]">
                  Starter
                </div>
                <div className="my-3 font-display text-[32px] font-semibold tracking-[-0.03em] text-[var(--text-strong)]">
                  Free
                </div>
                <div className="min-h-[34px] text-xs leading-[1.45] text-[var(--text-muted)]">
                  For players exploring the engine.
                </div>
                <div className="mt-auto pt-[18px]">
                  <Link href="/auth" className="flex">
                    <Button variant="outline" block>
                      Get started
                    </Button>
                  </Link>
                </div>
              </div>

              <div className="relative flex flex-col border-x border-[rgba(54,147,255,0.28)] border-t-2 border-t-[var(--brand)] bg-[linear-gradient(180deg,rgba(54,147,255,0.18),rgba(54,147,255,0.07))] p-[26px_18px] shadow-[0_-10px_40px_-12px_rgba(54,147,255,0.45)]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-base font-semibold text-[var(--text-strong)]">
                    Pro
                  </span>
                  <span className="inline-flex h-[19px] items-center rounded-full bg-[var(--brand)] px-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-white">
                    Popular
                  </span>
                </div>
                <div className="my-3 flex items-baseline gap-1">
                  <span className="font-display text-[32px] font-semibold tracking-[-0.03em] text-[var(--text-strong)]">
                    $19
                  </span>
                  <span className="text-[13px] text-[var(--text-muted)]">
                    /seat / mo
                  </span>
                </div>
                <div className="min-h-[34px] text-xs leading-[1.45] text-[var(--accent)]">
                  + pay-as-you-go uploads beyond your monthly allowance.
                </div>
                <div className="mt-auto pt-[18px]">
                  <Link href="/auth" className="flex">
                    <Button variant="primary" block>
                      Start free trial
                    </Button>
                  </Link>
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
                  For federations, academies & teams.
                </div>
                <div className="mt-auto pt-[18px]">
                  <Link href="/about#contact" className="flex">
                    <Button variant="secondary" block>
                      Contact sales
                    </Button>
                  </Link>
                </div>
              </div>
            </div>

            <SectionRows title="Usage & limits" rows={pricingRows.usage} />
            <SectionRows title="Analysis" rows={pricingRows.analysis} />
            <SectionRows title="Platform" rows={pricingRows.platform} />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[800px] px-8 pb-24 pt-10">
        <h2 className="text-center font-display text-[28px] font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
          FAQ
        </h2>
        <div className="mt-8 grid gap-3">
          {[
            {
              q: "Do I need a credit card for Starter?",
              a: "No. Starter is free with monthly analysis minutes. Upgrade when you need more capacity.",
            },
            {
              q: "What counts as an analysis minute?",
              a: "The duration of footage Mintonix processes. Watching replays and browsing the BWF library does not consume minutes.",
            },
            {
              q: "Can I share matches with athletes on free seats?",
              a: "Shared links work on every plan. Starter includes a monthly link allowance; Pro and Enterprise are unlimited.",
            },
          ].map((item) => (
            <div
              key={item.q}
              className="rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-5 shadow-[var(--shadow-edge)]"
            >
              <div className="font-display text-[15px] font-semibold text-[var(--text-strong)]">
                {item.q}
              </div>
              <p className="mt-2 text-[14px] leading-[1.6] text-[var(--text-secondary)]">
                {item.a}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
