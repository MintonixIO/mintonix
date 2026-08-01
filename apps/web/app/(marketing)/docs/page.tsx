import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "Mintonix docs — BWF catalog guide is live; private upload docs are planned.",
};

export default function DocsPage() {
  return (
    <div className="mx-auto max-w-[800px] px-6 py-20 sm:px-8">
      <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--accent-soft)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--accent)]">
        <BookOpen className="h-3.5 w-3.5" />
        Docs
      </div>
      <h1 className="font-display text-[clamp(32px,4vw,44px)] font-semibold tracking-[-0.03em] text-[var(--text-strong)]">
        Documentation
      </h1>
      <p className="mt-4 max-w-[56ch] text-[16px] leading-[1.65] text-[var(--text-secondary)]">
        Full product docs are still coming. What ships today is the public{" "}
        <strong className="font-medium text-[var(--text-strong)]">
          BWF match catalog
        </strong>{" "}
        — browse matches, players, and head-to-head with no account.
      </p>

      <div className="mt-10 space-y-4">
        <article className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-6">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-[11px] border border-[var(--border)] bg-[var(--accent-soft)] text-[var(--accent)]">
              <Trophy className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-display text-lg font-semibold text-[var(--text-strong)]">
                BWF catalog (live)
              </h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-[14.5px] leading-[1.55] text-[var(--text-secondary)]">
                <li>
                  Open{" "}
                  <Link href="/bwf" className="text-[var(--text-link)] hover:underline">
                    /bwf
                  </Link>{" "}
                  for boards and featured matches.
                </li>
                <li>
                  Filter the match library by discipline, event, and video
                  availability.
                </li>
                <li>
                  Player profiles and H2H are derived from catalog match rows
                  (name-based identity).
                </li>
                <li>
                  Match video uses allowlisted YouTube URLs when present — not
                  processed CDN assets yet.
                </li>
              </ul>
              <div className="mt-5">
                <Button href="/bwf" size="md">
                  Open the catalog
                </Button>
              </div>
            </div>
          </div>
        </article>

        <article className="rounded-[14px] border border-dashed border-[var(--border)] bg-[var(--surface-1)]/60 p-6">
          <h2 className="font-display text-lg font-semibold text-[var(--text-strong)]">
            Private uploads & analysis (planned)
          </h2>
          <p className="mt-2 text-[14.5px] leading-[1.55] text-[var(--text-secondary)]">
            Court calibration, upload pipelines, highlight reels, and team
            workspaces are not documented here yet because they are not part of
            the public BWF experience. Prefer the{" "}
            <Link
              href="/about#contact"
              className="text-[var(--text-link)] hover:underline"
            >
              contact form
            </Link>{" "}
            if you need early access details.
          </p>
        </article>
      </div>
    </div>
  );
}
