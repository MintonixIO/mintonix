import Link from "next/link";
import { Calendar, FileText } from "lucide-react";

export const metadata = { title: "Privacy" };

const TOC = [
  { id: "p-overview", label: "Overview" },
  { id: "p-collect", label: "What we collect" },
  { id: "p-footage", label: "Your footage" },
  { id: "p-use", label: "How we use data" },
  { id: "p-sharing", label: "Sharing & disclosure" },
  { id: "p-rights", label: "Your rights" },
  { id: "p-security", label: "Security & retention" },
  { id: "p-contact", label: "Contact" },
] as const;

const RIGHTS = [
  {
    name: "Access",
    desc: "Get a copy of the personal data and content associated with your account.",
  },
  {
    name: "Correction",
    desc: "Update inaccurate account information at any time from settings.",
  },
  {
    name: "Deletion",
    desc: "Delete individual matches, or close your account and remove all associated content.",
  },
  {
    name: "Portability",
    desc: "Export your matches and analysis in a machine-readable format.",
  },
  {
    name: "Objection",
    desc: "Opt out of non-essential analytics without losing access to the product.",
  },
] as const;

export default function PrivacyPage() {
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
            Privacy Policy
          </h1>
      <div className="mb-8 rounded-[12px] border border-[rgba(54,147,255,0.28)] bg-[rgba(54,147,255,0.08)] px-4 py-3 text-[13.5px] leading-[1.55] text-[var(--text-secondary)]">
        <strong className="font-medium text-[var(--text-strong)]">Scope note. </strong>
        This policy describes the intended product. The public site today is the free BWF catalog; account features, uploads, and billing described below may not be live yet.
      </div>

          <p className="mt-4 max-w-[60ch] text-[16px] leading-[1.6] text-[var(--text-secondary)]">
            How Mintonix collects, uses, and protects your footage and account
            data — in plain terms, with the legal detail where it matters.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-[var(--text-muted)]">
              <Calendar className="h-3.5 w-3.5 text-[var(--accent)]" />
              Last updated June 1, 2026
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
              On this page
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

          <div className="mx-legal max-w-[64ch]">
            <div id="p-overview" className="scroll-mt-[88px]">
              <h2 className="mb-3.5 font-display text-[clamp(20px,2.6vw,26px)] font-semibold leading-[1.2] tracking-[-0.02em] text-[var(--text-strong)]">
                Overview
              </h2>
              <p className="mb-3.5 text-[15px] leading-[1.72] text-[var(--text-secondary)]">
                Mintonix turns match footage into analysis. To do that we store
                the videos and data you upload, the account that owns them, and a
                record of how the engine processed them. This policy explains
                exactly what that means, what we never do with your data, and the
                controls you have over it.
              </p>
              <p className="mb-3.5 text-[15px] leading-[1.72] text-[var(--text-secondary)]">
                We designed Mintonix so that{" "}
                <strong className="font-semibold text-[var(--text-strong)]">
                  your footage is yours
                </strong>
                . We do not sell it, we do not use it to train models for other
                customers, and we delete it when you ask us to.
              </p>
            </div>

            <div id="p-collect" className="mt-9 scroll-mt-[88px]">
              <h2 className="mb-3.5 font-display text-[clamp(20px,2.6vw,26px)] font-semibold leading-[1.2] tracking-[-0.02em] text-[var(--text-strong)]">
                What we collect
              </h2>
              <h3 className="mb-2 mt-[22px] font-display text-[16px] font-semibold text-[var(--text-strong)]">
                Account information
              </h3>
              <p className="mb-3.5 text-[15px] leading-[1.72] text-[var(--text-secondary)]">
                When you create an account we collect your name, email address,
                and — for team plans — your club or organization. If you pay for
                a plan, our payment processor handles your card details; we never
                see or store the full card number.
              </p>
              <h3 className="mb-2 mt-[22px] font-display text-[16px] font-semibold text-[var(--text-strong)]">
                Content you upload
              </h3>
              <p className="mb-3.5 text-[15px] leading-[1.72] text-[var(--text-secondary)]">
                This is your match footage and any shot-data exports you provide,
                plus the analysis Mintonix generates from them: rallies, shot
                types, tracking data, heatmaps, and highlight reels.
              </p>
              <h3 className="mb-2 mt-[22px] font-display text-[16px] font-semibold text-[var(--text-strong)]">
                Usage data
              </h3>
              <p className="mb-3.5 text-[15px] leading-[1.72] text-[var(--text-secondary)]">
                We record basic, privacy-respecting product analytics — which
                features are used and aggregate performance metrics — to keep the
                engine fast and decide what to build next. This data is not tied
                to the content of your footage.
              </p>
            </div>

            <div id="p-footage" className="mt-9 scroll-mt-[88px]">
              <h2 className="mb-3.5 font-display text-[clamp(20px,2.6vw,26px)] font-semibold leading-[1.2] tracking-[-0.02em] text-[var(--text-strong)]">
                Your footage
              </h2>
              <p className="mb-3.5 text-[15px] leading-[1.72] text-[var(--text-secondary)]">
                Footage is the most sensitive thing you trust us with, so it gets
                its own section:
              </p>
              <ul className="mb-3.5 flex list-none flex-col gap-[9px] p-0">
                {[
                  {
                    label: "Processing only.",
                    text: "We use your footage solely to produce the analysis you requested and to operate features you turn on, such as shared team libraries.",
                  },
                  {
                    label: "No cross-customer training.",
                    text: "Your footage is never used to train models that serve other customers.",
                  },
                  {
                    label: "You control sharing.",
                    text: "A match is private until you create a share link or add it to a shared library. You can revoke a link at any time.",
                  },
                  {
                    label: "You control deletion.",
                    text: "Deleting a match removes the video, its analysis, and any derived clips from active storage, and from backups within 30 days.",
                  },
                ].map((item) => (
                  <li
                    key={item.label}
                    className="relative pl-[22px] text-[15px] leading-[1.66] text-[var(--text-secondary)] before:absolute before:left-0.5 before:top-[9px] before:h-1.5 before:w-1.5 before:rounded-full before:bg-[var(--accent)]"
                  >
                    <strong className="font-semibold text-[var(--text-strong)]">
                      {item.label}
                    </strong>{" "}
                    {item.text}
                  </li>
                ))}
              </ul>
            </div>

            <div id="p-use" className="mt-9 scroll-mt-[88px]">
              <h2 className="mb-3.5 font-display text-[clamp(20px,2.6vw,26px)] font-semibold leading-[1.2] tracking-[-0.02em] text-[var(--text-strong)]">
                How we use data
              </h2>
              <p className="mb-3.5 text-[15px] leading-[1.72] text-[var(--text-secondary)]">
                We use the data described above to:
              </p>
              <ul className="mb-3.5 flex list-none flex-col gap-[9px] p-0">
                {[
                  "Provide and operate the analysis engine and your account.",
                  "Generate the rallies, metrics, heatmaps, and highlight reels you ask for.",
                  "Maintain security, prevent abuse, and meet legal obligations.",
                  "Improve product performance and reliability using aggregate, de-identified signals.",
                ].map((text) => (
                  <li
                    key={text}
                    className="relative pl-[22px] text-[15px] leading-[1.66] text-[var(--text-secondary)] before:absolute before:left-0.5 before:top-[9px] before:h-1.5 before:w-1.5 before:rounded-full before:bg-[var(--accent)]"
                  >
                    {text}
                  </li>
                ))}
              </ul>
            </div>

            <div id="p-sharing" className="mt-9 scroll-mt-[88px]">
              <h2 className="mb-3.5 font-display text-[clamp(20px,2.6vw,26px)] font-semibold leading-[1.2] tracking-[-0.02em] text-[var(--text-strong)]">
                Sharing & disclosure
              </h2>
              <p className="mb-3.5 text-[15px] leading-[1.72] text-[var(--text-secondary)]">
                We share data only in these limited cases:
              </p>
              <ul className="mb-3.5 flex list-none flex-col gap-[9px] p-0">
                {[
                  {
                    label: "Service providers",
                    text: "— vetted vendors who help us run Mintonix (cloud hosting, payment processing), bound by contract to protect your data.",
                  },
                  {
                    label: "At your direction",
                    text: "— when you create a share link, invite teammates, or connect an integration.",
                  },
                  {
                    label: "Legal requirements",
                    text: "— when compelled by valid legal process, limited to what is required.",
                  },
                ].map((item) => (
                  <li
                    key={item.label}
                    className="relative pl-[22px] text-[15px] leading-[1.66] text-[var(--text-secondary)] before:absolute before:left-0.5 before:top-[9px] before:h-1.5 before:w-1.5 before:rounded-full before:bg-[var(--accent)]"
                  >
                    <strong className="font-semibold text-[var(--text-strong)]">
                      {item.label}
                    </strong>{" "}
                    {item.text}
                  </li>
                ))}
              </ul>
              <p className="mb-3.5 text-[15px] leading-[1.72] text-[var(--text-secondary)]">
                We do{" "}
                <strong className="font-semibold text-[var(--text-strong)]">
                  not
                </strong>{" "}
                sell personal information or footage to anyone.
              </p>
            </div>

            <div id="p-rights" className="mt-9 scroll-mt-[88px]">
              <h2 className="mb-3.5 font-display text-[clamp(20px,2.6vw,26px)] font-semibold leading-[1.2] tracking-[-0.02em] text-[var(--text-strong)]">
                Your rights
              </h2>
              <p className="mb-3.5 text-[15px] leading-[1.72] text-[var(--text-secondary)]">
                Depending on where you live, you may have the following rights.
                You can exercise any of them from your account settings or by
                contacting us.
              </p>
              <div className="my-1 mb-3.5 overflow-hidden rounded-xl border border-[var(--border)]">
                {RIGHTS.map((r, i) => (
                  <div
                    key={r.name}
                    className="grid gap-4 bg-[var(--surface-1)] px-4 py-[13px] sm:grid-cols-[150px_1fr]"
                    style={{
                      borderTop:
                        i === 0 ? undefined : "1px solid var(--border-subtle)",
                    }}
                  >
                    <span className="text-[13.5px] font-semibold text-[var(--text-strong)]">
                      {r.name}
                    </span>
                    <span className="text-[13.5px] leading-[1.55] text-[var(--text-secondary)]">
                      {r.desc}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div id="p-security" className="mt-9 scroll-mt-[88px]">
              <h2 className="mb-3.5 font-display text-[clamp(20px,2.6vw,26px)] font-semibold leading-[1.2] tracking-[-0.02em] text-[var(--text-strong)]">
                Security & retention
              </h2>
              <p className="mb-3.5 text-[15px] leading-[1.72] text-[var(--text-secondary)]">
                Footage and account data are encrypted in transit and at rest.
                Access is restricted to the systems and staff that need it to
                operate the service, and is logged.
              </p>
              <p className="mb-3.5 text-[15px] leading-[1.72] text-[var(--text-secondary)]">
                We keep your content for as long as your account is active. When
                you delete a match or close your account, we remove the associated
                content from active systems immediately and from backups within 30
                days, except where we are legally required to retain certain
                records.
              </p>
            </div>

            <div id="p-contact" className="mt-9 scroll-mt-[88px]">
              <h2 className="mb-3.5 font-display text-[clamp(20px,2.6vw,26px)] font-semibold leading-[1.2] tracking-[-0.02em] text-[var(--text-strong)]">
                Contact
              </h2>
              <p className="mb-3.5 text-[15px] leading-[1.72] text-[var(--text-secondary)]">
                Questions about privacy, or want to exercise a right? Reach our
                team at{" "}
                <a
                  href="mailto:privacy@mintonix.io"
                  className="text-[var(--text-link)] hover:underline"
                >
                  privacy@mintonix.io
                </a>
                , or through the{" "}
                <Link
                  href="/about#contact"
                  className="text-[var(--text-link)] hover:underline"
                >
                  contact form
                </Link>
                . We&apos;re based in the United States and reply in English or
                中文, typically within one business day.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
