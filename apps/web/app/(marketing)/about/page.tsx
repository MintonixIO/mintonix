import type { Metadata } from "next";
import Link from "next/link";
import { Mail, MessageSquare } from "lucide-react";
import { AboutContactForm } from "@/components/marketing/about-contact-form";

export const metadata: Metadata = {
  title: "About",
  description:
    "Mintonix turns badminton footage into a record you can study — rally by rally, shot by shot.",
};

export default function AboutPage() {
  return (
    <div>
      {/* Hero */}
      <section className="relative">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(110% 55% at 50% -10%, rgba(54,147,255,0.16), transparent 56%)",
          }}
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(rgba(54,147,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(54,147,255,0.05) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
            maskImage:
              "radial-gradient(80% 45% at 50% 0%, #000 30%, transparent 78%)",
            WebkitMaskImage:
              "radial-gradient(80% 45% at 50% 0%, #000 30%, transparent 78%)",
          }}
        />
        <div className="relative mx-auto max-w-[1080px] px-8 pt-[84px] text-center">
          <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--accent)]">
            About Mintonix
          </div>
          <h1 className="mx-auto max-w-[20ch] font-display text-[clamp(34px,5vw,56px)] font-semibold leading-[1.06] tracking-[-0.03em] text-[var(--text-strong)] text-balance">
            We watch every rally so the game gives up its secrets.
          </h1>
          <p className="mx-auto mt-5 max-w-[56ch] text-[17px] leading-[1.6] text-[var(--text-secondary)]">
            Mintonix began with a simple frustration: the most important moments
            in badminton vanish the instant they happen. We build the engine that
            turns footage into a record you can study — rally by rally, shot by
            shot.
          </p>
        </div>
      </section>

      {/* Story */}
      <section className="mx-auto max-w-[1080px] px-8 pt-24">
        <div className="grid items-start gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          <div className="lg:sticky lg:top-24">
            <div className="mb-3.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--accent)]">
              Our story
            </div>
            <h2 className="font-display text-[clamp(26px,3.4vw,40px)] font-semibold leading-[1.1] tracking-[-0.025em] text-[var(--text-strong)] text-balance">
              From a courtside laptop to a full analysis engine.
            </h2>
          </div>
          <div className="flex flex-col gap-[22px] text-base leading-[1.7] text-[var(--text-secondary)]">
            <p>
              In 2023 I was coaching juniors and re-watching match footage by
              hand — scrubbing back and forth, pausing on a smash, trying to
              remember where a player stood three shots earlier. The footage held
              every answer, but extracting it took hours, and the insight faded
              before the next session.
            </p>
            <p>
              So I built a tool to do the watching for me. The first version just
              segmented rallies. Then it traced the shuttle, then the players,
              then the patterns between them. Each layer turned a hunch into a
              number, and a number into a coaching decision.
            </p>
            <p>
              Today Mintonix is used by players, coaches, and federations who
              want the same thing I wanted — to{" "}
              <span className="text-[var(--text-strong)]">see clearly</span>.
              It&apos;s still just me: one person, based in the United States,
              working to the global tour calendar, and still watching a lot of
              badminton.
            </p>
          </div>
        </div>
      </section>

      {/* Contact */}
      <section
        id="contact"
        className="mx-auto max-w-[1080px] scroll-mt-20 px-8 pb-[120px] pt-[110px]"
      >
        <div className="max-w-[60ch]">
          <div className="mb-3.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--accent)]">
            Contact
          </div>
          <h2 className="font-display text-[clamp(28px,3.6vw,44px)] font-semibold leading-[1.08] tracking-[-0.025em] text-[var(--text-strong)] text-balance">
            Talk to the person behind the engine.
          </h2>
          <p className="mt-[18px] max-w-[54ch] text-base leading-[1.6] text-[var(--text-secondary)]">
            Pick a topic so I know what it&apos;s about — support, sales, or the
            data side. US-based, replying in English or 中文, usually within one
            business day. Every message comes straight to me.
          </p>
        </div>

        <div className="mt-11 grid items-start gap-7 lg:grid-cols-[1.55fr_1fr]">
          <AboutContactForm />

          <div className="space-y-3">
            {[
              {
                icon: Mail,
                t: "Email",
                d: "hello@mintonix.com",
                href: "mailto:hello@mintonix.com",
              },
              {
                icon: MessageSquare,
                t: "Support",
                d: "In-app help for Pro seats",
                href: "/dashboard/help-support",
              },
            ].map((c) => (
              <Link
                key={c.t}
                href={c.href}
                className="flex items-start gap-3 rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[var(--shadow-edge)] transition-colors hover:border-[var(--border-strong)]"
              >
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-[var(--border)] bg-[var(--accent-soft)] text-[var(--accent)]">
                  <c.icon className="h-4 w-4" />
                </span>
                <div>
                  <div className="font-display text-[14px] font-semibold text-[var(--text-strong)]">
                    {c.t}
                  </div>
                  <div className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
                    {c.d}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
