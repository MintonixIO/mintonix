import Link from "next/link";
import {
  FileVideo,
  Folder,
  History,
  Infinity,
  LayoutDashboard,
  Link as LinkIcon,
  Loader,
  Search,
  Share2,
  UploadCloud,
  Users,
  Zap,
} from "lucide-react";
import {
  FeatureCTA,
  FeatureHero,
  FeatureSection,
} from "@/components/marketing/feature-page";
import { Reveal } from "@/components/marketing/reveal";
import { DashboardDemo } from "@/components/marketing/dashboard-demo";

export const metadata = { title: "Dashboard" };

const HERO_STATS = [
  { icon: Folder, big: "1", label: "library for every match" },
  { icon: Zap, big: "6 min", label: "to a full breakdown" },
  { icon: LinkIcon, big: "1 link", label: "to share anything" },
  { icon: Infinity, big: "No cap", label: "on matches you keep" },
];

const STATUSES = [
  { dot: "#2dd4a7", name: "Axelsen vs Momota", color: "#2dd4a7", state: "Analyzed" },
  { dot: "#3693ff", name: "Club ladder · R2", color: "#3693ff", state: "Analyzing 68%" },
  { dot: "#647391", name: "Practice set 14", color: "#647391", state: "Queued" },
];

const RECENTS = [
  { name: "Axelsen vs Momota", ago: "2h" },
  { name: "Semi-final · 2026", ago: "Yesterday" },
  { name: "Training · footwork", ago: "3d" },
];

const TEAM = [
  { in: "VA", bg: "linear-gradient(135deg,#3693ff,#1f5fb0)" },
  { in: "KM", bg: "linear-gradient(135deg,#2dd4a7,#157e63)" },
  { in: "LS", bg: "linear-gradient(135deg,var(--accent),var(--brand))" },
  { in: "TP", bg: "linear-gradient(135deg,#f4515c,#a82b34)" },
];

export default function FeatureDashboardPage() {
  return (
    <div className="overflow-x-clip">
      <div className="border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2.5 text-center text-[12.5px] text-[var(--text-secondary)]">
        <strong className="font-medium text-[var(--text-strong)]">Roadmap / preview.</strong>{" "}
        Not part of the live public product — explore the{" "}
        <Link href="/bwf" className="text-[var(--text-link)] underline-offset-2 hover:underline">
          BWF catalog
        </Link>{" "}
        today.
      </div>
      <FeatureHero
        EyebrowIcon={LayoutDashboard}
        eyebrow="Dashboard"
        titleClassName="max-w-[14ch]"
        title="Every match, in one place."
        body="Planned private workspace: upload footage and it lands as an analyzed match. Watch what's processing, jump into recent breakdowns, search the archive, and share a match with a link — preview only today."
        ctas={[
          { href: "/bwf", label: "Open BWF catalog" },
          { href: "/bwf/matches", label: "Browse matches", variant: "outline" },
        ]}
        glow="radial-gradient(100% 60% at 85% -10%, rgba(255,255,255,0.05), transparent 55%)"
        gridClassName="grid items-center gap-10 lg:grid-cols-[1fr_0.78fr] lg:gap-14"
      >
        <div className="grid grid-cols-2 gap-3.5">
          {HERO_STATS.map((s) => (
            <div
              key={s.label}
              className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-[18px] transition-transform hover:-translate-y-0.5"
            >
              <span className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-[9px] border border-[var(--border)] bg-[var(--accent-soft)] text-[var(--accent)]">
                <s.icon className="h-4 w-4" />
              </span>
              <div className="mt-3.5 font-display text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[var(--text-strong)]">
                {s.big}
              </div>
              <div className="mt-1.5 text-[12.5px] text-[var(--text-muted)]">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </FeatureHero>

      <FeatureSection
        className="relative pt-[72px]"
        maxWidthClassName="max-w-[1256px]"
      >
        <Reveal className="relative">
          <div
            className="pointer-events-none absolute -inset-px rounded-2xl"
            style={{
              boxShadow:
                "0 0 0 1px rgba(255,255,255,0.055), 0 30px 90px rgba(255,255,255,0.045)",
            }}
          />
          <div className="overflow-hidden rounded-[14px] border border-[var(--border)] shadow-[var(--shadow-xl)]">
            <DashboardDemo className="min-h-[560px] rounded-none border-0 shadow-none" />
          </div>
        </Reveal>
      </FeatureSection>

      <FeatureSection
        className="pt-[120px]"
        maxWidthClassName="max-w-[1256px]"
        eyebrow="Your control room"
        title="Everything a match needs, on one screen."
        headerClassName="mb-11 max-w-[640px]"
      >
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Reveal className="flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-6 transition-transform hover:-translate-y-0.5 md:col-span-2">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--border)] bg-[var(--accent-soft)] text-[var(--accent)]">
                <UploadCloud className="h-[18px] w-[18px]" />
              </span>
              <h3 className="font-display text-[17px] font-semibold text-[var(--text-strong)]">
                Drag-and-drop upload
              </h3>
            </div>
            <p className="mt-3 mb-[18px] max-w-[48ch] text-[14px] leading-[1.6] text-[var(--text-secondary)]">
              Drop a video or shot-data export straight onto the dashboard. Large
              files resume on their own if your connection drops.
            </p>
            <div className="mt-auto flex items-center gap-3.5 rounded-xl border-[1.5px] border-dashed border-[var(--border-strong)] bg-[var(--surface-2)] p-[22px]">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] bg-[var(--accent-soft)] text-[var(--accent)]">
                <FileVideo className="h-[19px] w-[19px]" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] text-[var(--text-strong)]">
                  axelsen-vs-momota.mp4
                </div>
                <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-[var(--surface-3,#1b2744)]">
                  <div className="h-full w-[68%] rounded-full bg-[var(--accent)]" />
                </div>
              </div>
              <span className="font-mono text-[12px] tabular-nums text-[var(--accent)]">
                68%
              </span>
            </div>
          </Reveal>

          <Reveal className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-6 transition-transform hover:-translate-y-0.5">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--border)] bg-[var(--accent-soft)] text-[var(--accent)]">
                <Loader className="h-[18px] w-[18px]" />
              </span>
              <h3 className="font-display text-[17px] font-semibold text-[var(--text-strong)]">
                Live status
              </h3>
            </div>
            <p className="mt-3 mb-4 text-[14px] leading-[1.6] text-[var(--text-secondary)]">
              Watch each match move from queued to analyzed in real time.
            </p>
            <div className="flex flex-col gap-[9px]">
              {STATUSES.map((st) => (
                <div
                  key={st.name}
                  className="flex items-center gap-[9px] text-[12.5px]"
                >
                  <span
                    className="h-2 w-2 flex-none rounded-full"
                    style={{ background: st.dot }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[var(--text-strong)]">
                    {st.name}
                  </span>
                  <span
                    className="font-mono text-[11px]"
                    style={{ color: st.color }}
                  >
                    {st.state}
                  </span>
                </div>
              ))}
            </div>
          </Reveal>

          <Reveal className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-6 transition-transform hover:-translate-y-0.5">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--border)] bg-[var(--accent-soft)] text-[var(--accent)]">
                <History className="h-[18px] w-[18px]" />
              </span>
              <h3 className="font-display text-[17px] font-semibold text-[var(--text-strong)]">
                Pick up where you left off
              </h3>
            </div>
            <p className="mt-3 mb-4 text-[14px] leading-[1.6] text-[var(--text-secondary)]">
              Recent matches sit one click from the analysis you were last
              reading.
            </p>
            <div className="flex flex-col gap-[7px]">
              {RECENTS.map((r) => (
                <div
                  key={r.name}
                  className="flex items-center gap-2.5 rounded-[9px] border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2.5 py-2"
                >
                  <span className="h-[26px] w-[26px] flex-none rounded-[7px] border border-[var(--border-subtle)] bg-[linear-gradient(135deg,#16233f,#0d1730)]" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--text-strong)]">
                    {r.name}
                  </span>
                  <span className="font-mono text-[11px] text-[var(--text-muted)]">
                    {r.ago}
                  </span>
                </div>
              ))}
            </div>
          </Reveal>

          <Reveal className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-6 transition-transform hover:-translate-y-0.5 md:col-span-2">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--border)] bg-[var(--accent-soft)] text-[var(--accent)]">
                <Search className="h-[18px] w-[18px]" />
              </span>
              <h3 className="font-display text-[17px] font-semibold text-[var(--text-strong)]">
                Search the whole archive
              </h3>
            </div>
            <p className="mt-3 mb-4 max-w-[52ch] text-[14px] leading-[1.6] text-[var(--text-secondary)]">
              Filter by opponent, date, or tag and the matching matches surface
              instantly — no scrolling through folders.
            </p>
            <div className="flex flex-wrap items-center gap-[9px]">
              <div className="flex h-10 min-w-[180px] flex-1 items-center gap-[9px] rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] px-[13px]">
                <Search className="h-[15px] w-[15px] text-[var(--text-faint)]" />
                <span className="text-[13px] text-[var(--text-muted)]">
                  opponent: Momota
                </span>
              </div>
              <span className="inline-flex h-[30px] items-center gap-1.5 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-[11px] text-[12px] text-[var(--text-strong)]">
                Last 30 days
              </span>
              <span className="inline-flex h-[30px] items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-[11px] text-[12px] text-[var(--text-secondary)]">
                Singles
              </span>
              <span className="inline-flex h-[30px] items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-[11px] text-[12px] text-[var(--text-secondary)]">
                Tagged: review
              </span>
            </div>
          </Reveal>

          <Reveal className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-6 transition-transform hover:-translate-y-0.5">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--border)] bg-[var(--accent-soft)] text-[var(--accent)]">
                <Share2 className="h-[18px] w-[18px]" />
              </span>
              <h3 className="font-display text-[17px] font-semibold text-[var(--text-strong)]">
                Share in a click
              </h3>
            </div>
            <p className="mt-3 text-[14px] leading-[1.6] text-[var(--text-secondary)]">
              One link opens the same rallies, heatmaps, and reels — no account
              needed, revoke any time.
            </p>
          </Reveal>

          <Reveal className="flex flex-wrap items-center gap-[22px] rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-6 transition-transform hover:-translate-y-0.5 md:col-span-2 lg:col-span-3">
            <div className="min-w-[240px] flex-1">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--border)] bg-[var(--accent-soft)] text-[var(--accent)]">
                  <Users className="h-[18px] w-[18px]" />
                </span>
                <h3 className="font-display text-[17px] font-semibold text-[var(--text-strong)]">
                  Shared team libraries
                </h3>
              </div>
              <p className="mt-3 max-w-[52ch] text-[14px] leading-[1.6] text-[var(--text-secondary)]">
                Pool a squad&apos;s matches in one workspace. Coaches upload,
                players review, everyone works from the same analysis.
              </p>
            </div>
            <div className="flex items-center gap-3.5">
              <div className="flex">
                {TEAM.map((t, i) => (
                  <span
                    key={t.in}
                    className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-full border-2 border-[var(--surface-1)] text-[13px] font-semibold text-white"
                    style={{
                      background: t.bg,
                      marginLeft: i === 0 ? 0 : -10,
                    }}
                  >
                    {t.in}
                  </span>
                ))}
              </div>
              <span className="font-mono text-[12px] text-[var(--text-muted)]">
                +9 members
              </span>
            </div>
          </Reveal>
        </div>
      </FeatureSection>

      <FeatureCTA
        title="Your whole season, organized from day one."
        body="Workspace upload is planned — browse the free BWF catalog today."
        ctas={[{ href: "/bwf", label: "Open BWF catalog" }]}
      />
    </div>
  );
}
