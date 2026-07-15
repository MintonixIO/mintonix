import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Info,
  MessageCircle,
  Search,
} from "lucide-react";

export const metadata = { title: "Documentation" };

const SIDEBAR = [
  {
    group: "Getting started",
    items: [
      { label: "Quickstart", href: "#", active: false },
      { label: "Upload your first match", href: "#d-formats", active: true },
      { label: "Calibrating your court", href: "#", active: false },
    ],
  },
  {
    group: "Analysis",
    items: [
      { label: "Rallies & shots", href: "#", active: false },
      { label: "Heatmaps", href: "#", active: false },
      { label: "Head-to-head", href: "#", active: false },
      { label: "Highlight reels", href: "#", active: false },
    ],
  },
  {
    group: "Workspace",
    items: [
      { label: "Dashboard", href: "#", active: false },
      { label: "Shared libraries", href: "#", active: false },
      { label: "Sharing & links", href: "#", active: false },
    ],
  },
  {
    group: "Developers",
    items: [
      { label: "API reference", href: "#", active: false },
      { label: "Webhooks", href: "#", active: false },
      { label: "Rate limits", href: "#", active: false },
    ],
  },
] as const;

const FORMATS = [
  {
    name: "Video",
    detail: "MP4, MOV, or MKV up to 4K. A fixed, full-court camera tracks best.",
  },
  {
    name: "Shot-data exports",
    detail: "CSV or JSON from supported sensors and timing systems.",
  },
  {
    name: "Direct capture",
    detail: "Stream from a connected court camera on Enterprise plans.",
  },
] as const;

const STEPS = [
  {
    n: "1",
    title: "Drop in your footage",
    body: "Drag a file onto the dashboard, or click Upload. Large files resume automatically if your connection drops.",
  },
  {
    n: "2",
    title: "Mintonix analyzes",
    body: "The engine segments rallies, tracks the shuttle and players, and builds metrics. A typical match is ready in a few minutes.",
  },
  {
    n: "3",
    title: "Review & share",
    body: "Open the match to scrub rallies, read heatmaps, and assemble highlight reels — then share with a single link.",
  },
] as const;

const TOC = [
  { id: "d-formats", label: "Supported formats" },
  { id: "d-steps", label: "The three steps" },
  { id: "d-api", label: "Uploading via the API" },
  { id: "d-share", label: "Sharing the result" },
] as const;

export default function DocsPage() {
  return (
    <section className="mx-auto max-w-[1320px] px-8 pb-[120px] pt-10">
      <div className="grid items-start gap-11 grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_200px]">
        {/* Sidebar */}
        <aside className="sticky top-[88px] hidden lg:block">
          <div className="relative mb-[18px]">
            <Search className="pointer-events-none absolute left-[11px] top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-[var(--text-faint)]" />
            <input
              placeholder="Search docs"
              readOnly
              className="h-[38px] w-full rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] py-0 pl-[34px] pr-3 font-sans text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            />
          </div>
          <nav className="flex flex-col gap-[22px]">
            {SIDEBAR.map((g) => (
              <div key={g.group}>
                <div className="px-3 pb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
                  {g.group}
                </div>
                <div className="flex flex-col gap-px">
                  {g.items.map((it) => (
                    <a
                      key={it.label}
                      href={it.href}
                      className={
                        it.active
                          ? "flex items-center gap-[9px] rounded-lg bg-[var(--accent-soft)] px-3 py-[7px] text-[13.5px] leading-[1.4] text-[var(--text-strong)] no-underline"
                          : "flex items-center gap-[9px] rounded-lg px-3 py-[7px] text-[13.5px] leading-[1.4] text-[var(--text-muted)] no-underline transition-colors hover:bg-white/[0.03] hover:text-[var(--text-strong)]"
                      }
                    >
                      {it.label}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        {/* Article */}
        <article className="mx-doc min-w-0 max-w-[72ch]">
          <div className="mb-[18px] flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--text-muted)]">
            <span>Documentation</span>
            <ChevronRight className="h-[13px] w-[13px]" />
            <span>Getting started</span>
            <ChevronRight className="h-[13px] w-[13px]" />
            <span className="text-[var(--text-secondary)]">
              Upload your first match
            </span>
          </div>

          <h1 className="font-display text-[clamp(30px,4vw,40px)] font-semibold leading-[1.08] tracking-[-0.03em] text-[var(--text-strong)]">
            Upload your first match
          </h1>
          <p className="mt-3.5 text-[16.5px] leading-[1.6] text-[var(--text-secondary)]">
            From raw footage to a fully analyzed match in three steps. This guide
            covers supported formats, what happens during processing, and how to
            share the result.
          </p>

          <div className="mt-[26px] mb-1 flex gap-3 rounded-xl border border-[rgba(54,147,255,0.28)] bg-[var(--accent-soft)] px-4 py-3.5">
            <Info className="mt-0.5 h-[17px] w-[17px] flex-none text-[var(--accent)]" />
            <p className="m-0 text-[14px] leading-[1.6] text-[var(--text-secondary)]">
              No footage handy? Every account starts with the full{" "}
              <Link
                href="/features/bwf"
                className="text-[var(--text-link)] hover:underline"
              >
                BWF match library
              </Link>{" "}
              — open any match to explore the analysis without uploading a thing.
            </p>
          </div>

          <h2
            id="d-formats"
            className="mb-3.5 mt-[38px] scroll-mt-[88px] font-display text-[clamp(22px,2.8vw,28px)] font-semibold leading-[1.18] tracking-[-0.02em] text-[var(--text-strong)]"
          >
            Supported formats
          </h2>
          <p className="mb-3.5 text-[15px] leading-[1.72] text-[var(--text-secondary)]">
            Mintonix accepts standard video files and shot-data exports. For best
            tracking results, film from a fixed camera with the full court in
            frame.
          </p>
          <ul className="mb-3.5 flex list-none flex-col gap-[9px] p-0">
            {FORMATS.map((f) => (
              <li
                key={f.name}
                className="relative flex items-baseline gap-2.5 text-[15px] leading-[1.6] text-[var(--text-secondary)]"
              >
                <Check className="mt-0.5 h-[15px] w-[15px] flex-none translate-y-0.5 text-[#2dd4a7]" />
                <span>
                  <strong className="font-semibold text-[var(--text-strong)]">
                    {f.name}
                  </strong>{" "}
                  — {f.detail}
                </span>
              </li>
            ))}
          </ul>

          <h2
            id="d-steps"
            className="mb-3.5 mt-[38px] scroll-mt-[88px] font-display text-[clamp(22px,2.8vw,28px)] font-semibold leading-[1.18] tracking-[-0.02em] text-[var(--text-strong)]"
          >
            The three steps
          </h2>
          <div className="my-1 mb-2 flex flex-col gap-3.5">
            {STEPS.map((s) => (
              <div
                key={s.n}
                className="flex items-start gap-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] px-[18px] py-4"
              >
                <span className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--accent-soft)] font-mono text-[13px] font-semibold text-[var(--accent)]">
                  {s.n}
                </span>
                <div className="min-w-0">
                  <div className="font-display text-[15px] font-semibold text-[var(--text-strong)]">
                    {s.title}
                  </div>
                  <p className="mt-1 text-[14px] leading-[1.6] text-[var(--text-secondary)]">
                    {s.body}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <h2
            id="d-api"
            className="mb-3.5 mt-[38px] scroll-mt-[88px] font-display text-[clamp(22px,2.8vw,28px)] font-semibold leading-[1.18] tracking-[-0.02em] text-[var(--text-strong)]"
          >
            Uploading via the API
          </h2>
          <p className="mb-3.5 text-[15px] leading-[1.72] text-[var(--text-secondary)]">
            Prefer to automate it? Push a match straight to your library with a
            single request. Generate a key in{" "}
            <code className="rounded-[5px] border border-[var(--border-subtle)] bg-[var(--surface-2)] px-1.5 py-px font-mono text-[13px] text-[var(--text-primary)]">
              Settings → API
            </code>{" "}
            first.
          </p>
          <div className="my-1 mb-2 overflow-hidden rounded-xl border border-[var(--border)] bg-[#0d0e12]">
            <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3.5 py-2.5">
              <span className="h-[9px] w-[9px] rounded-full bg-[#f4515c]" />
              <span className="h-[9px] w-[9px] rounded-full bg-[#fbbf24]" />
              <span className="h-[9px] w-[9px] rounded-full bg-[#2dd4a7]" />
              <span className="ml-1.5 font-mono text-[11px] text-[var(--text-muted)]">
                upload.sh
              </span>
            </div>
            <pre className="m-0 overflow-x-auto px-[18px] py-4 font-mono text-[12.5px] leading-[1.7] text-[var(--text-primary)]">
              <span className="text-[var(--text-muted)]">
                # Upload a match file to your library
              </span>
              {"\n"}
              curl -X POST https://api.mintonix.com/v1/matches \{`\n`}
              {"  "}-H{" "}
              <span className="text-[#7ee0bf]">
                &quot;Authorization: Bearer $MINTONIX_KEY&quot;
              </span>{" "}
              \{`\n`}
              {"  "}-F{" "}
              <span className="text-[#7ee0bf]">
                &quot;file=@axelsen-vs-momota.mp4&quot;
              </span>{" "}
              \{`\n`}
              {"  "}-F{" "}
              <span className="text-[#7ee0bf]">
                &quot;title=Axelsen vs Momota&quot;
              </span>
            </pre>
          </div>
          <p className="mb-3.5 text-[15px] leading-[1.72] text-[var(--text-secondary)]">
            The response includes a{" "}
            <code className="rounded-[5px] border border-[var(--border-subtle)] bg-[var(--surface-2)] px-1.5 py-px font-mono text-[13px] text-[var(--text-primary)]">
              match_id
            </code>{" "}
            you can poll for processing status, or open directly in the dashboard
            once analysis completes.
          </p>

          <h2
            id="d-share"
            className="mb-3.5 mt-[38px] scroll-mt-[88px] font-display text-[clamp(22px,2.8vw,28px)] font-semibold leading-[1.18] tracking-[-0.02em] text-[var(--text-strong)]"
          >
            Sharing the result
          </h2>
          <p className="mb-3.5 text-[15px] leading-[1.72] text-[var(--text-secondary)]">
            When analysis finishes, open the match and choose{" "}
            <strong className="font-semibold text-[var(--text-strong)]">
              Share
            </strong>
            . Mintonix generates a link that respects your library permissions —
            anyone with the link sees the same rallies, heatmaps, and reels, no
            account required. Revoke it any time from the same menu.
          </p>

          <div className="mt-11 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <a
              href="#"
              className="flex flex-col gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] px-[18px] py-4 no-underline transition-colors hover:border-[var(--border-strong)]"
            >
              <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
                <ArrowLeft className="h-[13px] w-[13px]" />
                Previous
              </span>
              <span className="text-[14.5px] font-semibold text-[var(--text-strong)]">
                Quickstart
              </span>
            </a>
            <a
              href="#"
              className="flex flex-col items-end gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] px-[18px] py-4 text-right no-underline transition-colors hover:border-[var(--border-strong)]"
            >
              <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
                Next
                <ArrowRight className="h-[13px] w-[13px]" />
              </span>
              <span className="text-[14.5px] font-semibold text-[var(--text-strong)]">
                Calibrating your court
              </span>
            </a>
          </div>
        </article>

        {/* On this page */}
        <nav className="sticky top-[88px] hidden xl:block">
          <div className="px-3 pb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
            On this page
          </div>
          <div className="flex flex-col">
            {TOC.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="rounded-lg border-l-2 border-transparent px-3 py-1.5 text-[12.5px] leading-[1.4] text-[var(--text-muted)] no-underline transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]"
              >
                {item.label}
              </a>
            ))}
          </div>
          <div className="mx-3 mt-[18px] border-t border-[var(--border-subtle)] pt-4">
            <Link
              href="/about#contact"
              className="inline-flex items-center gap-1.5 text-[12.5px] text-[var(--text-muted)] no-underline hover:text-[var(--text-strong)]"
            >
              <MessageCircle className="h-3.5 w-3.5 text-[var(--accent)]" />
              Ask the team
            </Link>
          </div>
        </nav>
      </div>
    </section>
  );
}
