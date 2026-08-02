import { Rss } from "lucide-react";

export const metadata = { title: "Changelog" };

type ChangeType = "New" | "Improved" | "Fixed";

const TYPE_STYLES: Record<ChangeType, { fg: string; bg: string; bd: string }> =
  {
    New: {
      fg: "#7fd7ff",
      bg: "rgba(80,222,255,0.12)",
      bd: "rgba(80,222,255,0.30)",
    },
    Improved: {
      fg: "#5ba8ff",
      bg: "rgba(255,255,255,0.04)",
      bd: "color-mix(in srgb, var(--brand) 30%, transparent)",
    },
    Fixed: {
      fg: "#7ee0bf",
      bg: "rgba(45,212,167,0.12)",
      bd: "rgba(45,212,167,0.30)",
    },
  };

const RELEASES: {
  version: string;
  date: string;
  latest?: boolean;
  title: string;
  summary: string;
  privateNote?: boolean;
  changes: { type: ChangeType; text: string }[];
}[] = [
  {
    version: "v0.9",
    date: "Aug 1, 2026",
    latest: true,
    title: "Public BWF catalog",
    summary:
      "The live site is a free BWF match analysis catalog — scores, players, H2H, and YouTube links. Private workspace tools remain preview/roadmap.",
    changes: [
      {
        type: "New",
        text: "BWF home, matches, players, and head-to-head powered by the Supabase catalog.",
      },
      {
        type: "Improved",
        text: "Marketing repositioned around BWF analysis (no account CTA funnel).",
      },
      {
        type: "Improved",
        text: "Player directory server pagination and rate-limited search APIs.",
      },
      {
        type: "Fixed",
        text: "Mobile marketing navigation via hamburger menu.",
      },
    ],
  },
  {
    version: "notes · private tools",
    date: "2026 (not live)",
    privateNote: true,
    title: "Private analysis stack — design notes only",
    summary:
      "Historical design notes for a future private product. None of these ship on the public site today.",
    changes: [
      {
        type: "New",
        text: "Planned: saveable highlight presets and team libraries (not available).",
      },
      {
        type: "Improved",
        text: "Planned: court calibration and tracking confidence UI for private uploads.",
      },
      {
        type: "New",
        text: "Planned: head-to-head heatmap exports in a private analysis workspace.",
      },
    ],
  },
];

// Public changelog prioritizes the live BWF catalog.
export default function ChangelogPage() {
  return (
    <div>
      <section className="relative">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: "var(--hero-wash)",
          }}
        />
        <div className="relative mx-auto max-w-[880px] px-5 pt-20 sm:px-8 sm:pt-[84px]">
          <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--accent)]">
            Changelog
          </div>
          <h1 className="font-display text-[clamp(34px,5vw,52px)] font-semibold leading-[1.06] tracking-[-0.03em] text-[var(--text-strong)] text-balance">
            What's new in Mintonix.
          </h1>
          <p className="mt-[18px] max-w-[54ch] text-[17px] leading-[1.6] text-[var(--text-secondary)]">
            Public BWF releases are listed below. Email updates are planned —
            there is no signup yet.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <span className="font-mono text-[12px] text-[var(--text-muted)]">
              Email updates coming later
            </span>
            <span className="inline-flex items-center gap-1.5 text-[13px] text-[var(--text-muted)]">
              <Rss className="h-[15px] w-[15px] text-[var(--accent)]" />
              Public BWF releases first
            </span>
          </div>
        </div>
      </section>

      <section className="relative mx-auto max-w-[880px] px-5 pb-[120px] pt-16 sm:px-8">
        {RELEASES.map((r) => (
          <div
            key={r.version}
            className="grid gap-7 pb-12 max-md:grid-cols-1 md:grid-cols-[168px_1fr]"
          >
            <div className="md:sticky md:top-24 md:self-start">
              <div className="mb-2.5 inline-flex items-center gap-2">
                <span className="h-[9px] w-[9px] rounded-full bg-[var(--accent)] shadow-[0_0_0_4px_rgba(255,255,255,0.05)]" />
                <span className="font-mono text-[15px] font-semibold tracking-[-0.01em] text-[var(--text-strong)]">
                  {r.version}
                </span>
              </div>
              <div className="font-mono text-[12px] text-[var(--text-muted)]">
                {r.date}
              </div>
              {r.latest ? (
                <span className="mt-3 inline-flex h-[19px] items-center rounded-full bg-[var(--brand)] px-[9px] font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--text-on-blue,#fff)]">
                  Latest
                </span>
              ) : null}
              {r.privateNote ? (
                <span className="mt-3 inline-flex h-[19px] items-center rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-[9px] font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
                  Not live
                </span>
              ) : null}
            </div>

            <article className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-[clamp(20px,3vw,28px)] shadow-[var(--shadow-edge)]">
              <h2 className="font-display text-[clamp(20px,2.6vw,26px)] font-semibold leading-[1.15] tracking-[-0.02em] text-[var(--text-strong)] text-balance">
                {r.title}
              </h2>
              <p className="mt-2.5 text-[14.5px] leading-[1.6] text-[var(--text-secondary)]">
                {r.summary}
              </p>
              <div className="mt-5 flex flex-col gap-3">
                {r.changes.map((c) => {
                  const s = TYPE_STYLES[c.type];
                  return (
                    <div key={c.text} className="flex items-start gap-3">
                      <span
                        className="mt-px inline-flex h-5 min-w-[64px] flex-none items-center justify-center rounded-full border px-2 font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em]"
                        style={{
                          color: s.fg,
                          background: s.bg,
                          borderColor: s.bd,
                        }}
                      >
                        {c.type}
                      </span>
                      <span className="text-[14px] leading-[1.55] text-[var(--text-secondary)]">
                        {c.text}
                      </span>
                    </div>
                  );
                })}
              </div>
            </article>
          </div>
        ))}

        <div className="flex items-center gap-3 pt-2 md:pl-[196px]">
          <span className="h-[7px] w-[7px] rounded-full bg-[var(--border-strong)]" />
          <span className="text-[13px] text-[var(--text-muted)]">
            Public BWF catalog shipping starts at v0.9 — earlier private-tool
            notes are not product history.
          </span>
        </div>
      </section>
    </div>
  );
}
