import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import { PlayerCardPreview } from "@/components/auth/player-card-preview";

export function AuthShell({
  showPitch,
  showCard,
  card,
  children,
}: {
  showPitch: boolean;
  showCard: boolean;
  card: {
    name: string;
    club: string;
    level: string;
    years: string;
    disciplines: string[];
    isPrivate: boolean;
    avatarUrl: string | null;
  };
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen bg-[var(--bg-base)] pt-10 text-[var(--text-primary)]">
      <div className="fixed inset-x-0 top-0 z-50 border-b border-[rgba(54,147,255,0.30)] bg-[rgba(54,147,255,0.10)] px-4 py-2 text-center text-[12.5px] text-[var(--text-secondary)]">
        <strong className="font-medium text-[var(--text-strong)]">Preview only.</strong>{" "}
        Accounts are not live — use the{" "}
        <Link href="/bwf" className="text-[var(--text-link)] underline-offset-2 hover:underline">
          BWF catalog
        </Link>{" "}
        (no sign-in required).
      </div>
      {/* Left brand panel */}
      <aside className="relative hidden min-h-screen w-[46%] max-w-[640px] shrink-0 overflow-hidden border-r border-[var(--border-subtle)] bg-[linear-gradient(180deg,#0c1426_0%,#0a1020_100%)] px-12 py-10 md:flex md:flex-col">
        <div
          className="pointer-events-none absolute inset-0 opacity-90"
          style={{
            background:
              "radial-gradient(120% 60% at 30% -5%, rgba(54,147,255,0.20), transparent 60%)",
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-45"
          style={{
            backgroundImage:
              "linear-gradient(rgba(54,147,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(54,147,255,0.05) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage:
              "radial-gradient(80% 70% at 30% 10%, #000 20%, transparent 80%)",
            WebkitMaskImage:
              "radial-gradient(80% 70% at 30% 10%, #000 20%, transparent 80%)",
          }}
        />
        <div className="relative flex h-full min-h-0 flex-1 flex-col">
          <Link href="/" className="inline-flex w-max items-center gap-2.5">
            <Image
              src="/assets/logomark.png"
              alt="Mintonix"
              width={26}
              height={26}
            />
            <span className="font-display text-[19px] font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
              Mintonix
            </span>
          </Link>

          <div className="flex flex-1 flex-col justify-center py-10">
            {showPitch ? (
              <div className="max-w-[30ch]">
                <div className="mb-[18px] font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--accent)]">
                  Badminton analysis engine
                </div>
                <h1 className="text-balance font-display text-[clamp(30px,3.4vw,44px)] font-semibold leading-[1.08] tracking-[-0.03em] text-[var(--text-strong)]">
                  See every rally. Understand every match.
                </h1>
                <p className="mt-5 text-[15.5px] leading-[1.6] text-[var(--text-secondary)]">
                  Turn your footage into rallies, heatmaps, and head-to-head
                  metrics — all in one library, shareable with a link.
                </p>
                <div className="mt-10 flex gap-7">
                  {[
                    { k: "12k+", v: "matches analyzed" },
                    { k: "38", v: "metrics per rally" },
                    { k: "1", v: "link to share" },
                  ].map((s, i) => (
                    <div key={s.v} className="flex gap-7">
                      {i > 0 ? (
                        <div className="w-px self-stretch bg-[var(--border-subtle)]" />
                      ) : null}
                      <div>
                        <div className="font-mono text-[26px] font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
                          {s.k}
                        </div>
                        <div className="mt-1 text-xs text-[var(--text-muted)]">
                          {s.v}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {showCard ? <PlayerCardPreview {...card} /> : null}
          </div>

          <div className="text-xs text-[var(--text-faint)]">© 2026 Mintonix</div>
        </div>
      </aside>

      {/* Right form */}
      <section className="flex min-h-screen min-w-0 flex-1 items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-[416px]">
          <Link href="/" className="mb-7 flex items-center gap-2.5 md:hidden">
            <Image
              src="/assets/logomark.png"
              alt="Mintonix"
              width={24}
              height={24}
            />
            <span className="font-display text-lg font-semibold text-[var(--text-strong)]">
              Mintonix
            </span>
          </Link>
          {children}
        </div>
      </section>
    </main>
  );
}
