import type { ReactNode } from "react";
import Link from "next/link";
import { Calendar, FileText } from "lucide-react";

export const metadata = { title: "Terms" };

const TOC = [
  { id: "t-accept", label: "1. Acceptance" },
  { id: "t-account", label: "2. Your account" },
  { id: "t-content", label: "3. Your content" },
  { id: "t-acceptable", label: "4. Acceptable use" },
  { id: "t-plans", label: "5. Plans & billing" },
  { id: "t-ip", label: "6. Intellectual property" },
  { id: "t-termination", label: "7. Termination" },
  { id: "t-warranty", label: "8. Disclaimers" },
  { id: "t-liability", label: "9. Liability" },
  { id: "t-changes", label: "10. Changes & contact" },
] as const;

function Section({
  id,
  num,
  title,
  children,
  className = "mt-9",
}: {
  id: string;
  num: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div id={id} className={`scroll-mt-[88px] ${className}`}>
      <h2 className="mb-3.5 flex items-baseline gap-3 font-display text-[clamp(20px,2.6vw,26px)] font-semibold leading-[1.2] tracking-[-0.02em] text-[var(--text-strong)]">
        <span className="font-mono text-[14px] font-semibold text-[var(--accent)]">
          {num}
        </span>
        {title}
      </h2>
      {children}
    </div>
  );
}

function P({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3.5 text-[15px] leading-[1.72] text-[var(--text-secondary)]">
      {children}
    </p>
  );
}

export default function TermsPage() {
  return (
    <div>
      <section className="relative">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(100% 50% at 50% -10%, rgba(54,147,255,0.13), transparent 56%)",
          }}
        />
        <div className="relative mx-auto max-w-[1080px] px-8 pt-20">
          <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--accent)]">
            Legal
          </div>
          <h1 className="font-display text-[clamp(32px,4.6vw,48px)] font-semibold leading-[1.06] tracking-[-0.03em] text-[var(--text-strong)]">
            Terms of Service
          </h1>
      <div className="mb-8 rounded-[12px] border border-[rgba(54,147,255,0.28)] bg-[rgba(54,147,255,0.08)] px-4 py-3 text-[13.5px] leading-[1.55] text-[var(--text-secondary)]">
        <strong className="font-medium text-[var(--text-strong)]">Scope note. </strong>
        These terms cover the intended Mintonix product. The live public experience is the BWF match catalog. Features that require an account or paid plan are not offered until they ship.
      </div>

          <p className="mt-4 max-w-[60ch] text-[16px] leading-[1.6] text-[var(--text-secondary)]">
            The agreement between you and Mintonix when you use the service.
            We&apos;ve kept it readable — but it is still the binding version.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-[var(--text-muted)]">
              <Calendar className="h-3.5 w-3.5 text-[var(--accent)]" />
              Effective June 1, 2026
            </span>
            <span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-[var(--text-muted)]">
              <FileText className="h-3.5 w-3.5 text-[var(--accent)]" />
              Version 2.1
            </span>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1080px] px-8 pb-[120px] pt-12">
        <div className="grid items-start gap-12 lg:grid-cols-[220px_1fr]">
          <nav className="sticky top-24 hidden lg:block">
            <div className="px-3 pb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
              Sections
            </div>
            <div className="flex flex-col">
              {TOC.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className="rounded-lg border-l-2 border-transparent px-3 py-[7px] text-[13px] leading-[1.4] text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:bg-white/[0.03] hover:text-[var(--text-strong)]"
                >
                  {item.label}
                </a>
              ))}
            </div>
          </nav>

          <div className="max-w-[64ch]">
            <p className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3.5 text-[14px] text-[var(--text-muted)]">
              By creating an account or using Mintonix, you agree to these Terms.
              If you are using Mintonix on behalf of an organization, you
              represent that you have authority to bind that organization.
            </p>

            <Section id="t-accept" num="01" title="Acceptance of terms" className="mt-7">
              <P>
                These Terms of Service govern your access to and use of
                Mintonix&apos;s websites, applications, and analysis services (the
                &quot;Service&quot;). By accessing or using the Service, you agree
                to be bound by these Terms and by our{" "}
                <Link href="/privacy" className="text-[var(--text-link)] hover:underline">
                  Privacy Policy
                </Link>
                .
              </P>
            </Section>

            <Section id="t-account" num="02" title="Your account">
              <P>
                You must provide accurate information when creating an account and
                keep it current. You are responsible for activity under your
                account and for keeping your credentials secure. Notify us
                promptly of any unauthorized use.
              </P>
              <P>
                You must be at least 16 years old, or the age of digital consent
                in your country, to use the Service.
              </P>
            </Section>

            <Section id="t-content" num="03" title="Your content">
              <P>
                <strong className="font-semibold text-[var(--text-strong)]">
                  You keep ownership of your footage and data.
                </strong>{" "}
                You grant Mintonix a limited license to store, process, and
                display your content solely to provide the Service to you and
                anyone you share it with.
              </P>
              <P>
                You represent that you have the rights necessary to upload your
                content and that it does not infringe the rights of others. You
                are responsible for obtaining any consents required to record and
                analyze the people who appear in your footage.
              </P>
            </Section>

            <Section id="t-acceptable" num="04" title="Acceptable use">
              <P>You agree not to:</P>
              <ul className="mb-3.5 flex list-none flex-col gap-[9px] p-0">
                {[
                  "Upload content you do not have the right to use, or that is unlawful.",
                  "Attempt to reverse engineer, disrupt, or overload the Service.",
                  "Resell or redistribute the Service or its analysis without authorization.",
                  "Use the Service to harass, surveil, or harm others.",
                ].map((text) => (
                  <li
                    key={text}
                    className="relative pl-[22px] text-[15px] leading-[1.66] text-[var(--text-secondary)] before:absolute before:left-0.5 before:top-[9px] before:h-1.5 before:w-1.5 before:rounded-full before:bg-[var(--accent)]"
                  >
                    {text}
                  </li>
                ))}
              </ul>
            </Section>

            <Section id="t-plans" num="05" title="Plans & billing">
              <P>
                Paid plans are billed in advance on a recurring basis. Pro
                includes a monthly upload allowance; usage beyond it is metered
                and billed at the end of the cycle, as described on our{" "}
                <Link href="/pricing" className="text-[var(--text-link)] hover:underline">
                  pricing page
                </Link>
                .
              </P>
              <P>
                Upgrades take effect immediately and are prorated; downgrades take
                effect at the end of the current billing period. Fees are
                non-refundable except where required by law. You may cancel at any
                time and retain access through the paid period.
              </P>
            </Section>

            <Section id="t-ip" num="06" title="Intellectual property">
              <P>
                The Service, including its software, design, and the BWF reference
                library we provide, is owned by Mintonix and protected by
                intellectual property laws. These Terms grant you no rights in our
                trademarks or branding.
              </P>
            </Section>

            <Section id="t-termination" num="07" title="Termination">
              <P>
                You may stop using the Service and close your account at any time.
                We may suspend or terminate access if you materially breach these
                Terms or use the Service in a way that risks harm to others or to
                the Service. On termination, the license you granted us ends and
                we delete your content as described in the Privacy Policy.
              </P>
            </Section>

            <Section id="t-warranty" num="08" title="Disclaimers">
              <P>
                The Service is provided &quot;as is.&quot; Analysis is generated
                automatically and may contain inaccuracies; it is a tool to
                support your judgment, not a substitute for it. We do not warrant
                that the Service will be uninterrupted or error-free.
              </P>
            </Section>

            <Section id="t-liability" num="09" title="Limitation of liability">
              <P>
                To the maximum extent permitted by law, Mintonix is not liable for
                indirect, incidental, or consequential damages, and our total
                liability for any claim is limited to the amount you paid us for
                the Service in the twelve months before the claim.
              </P>
            </Section>

            <Section id="t-changes" num="10" title="Changes & contact">
              <P>
                We may update these Terms from time to time. If we make material
                changes, we&apos;ll notify you in-product or by email before they
                take effect. Continued use after changes means you accept the
                updated Terms.
              </P>
              <P>
                Questions? Reach us at{" "}
                <a
                  href="mailto:legal@mintonix.io"
                  className="text-[var(--text-link)] hover:underline"
                >
                  legal@mintonix.io
                </a>{" "}
                or through the{" "}
                <Link href="/about#contact" className="text-[var(--text-link)] hover:underline">
                  contact form
                </Link>
                .
              </P>
            </Section>
          </div>
        </div>
      </section>
    </div>
  );
}
