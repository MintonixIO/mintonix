import type { Metadata } from "next";
import { BlogCatalog } from "@/components/marketing/blog-catalog";

export const metadata: Metadata = {
  title: "Blog",
  description: "Notes on badminton analysis, BWF data, and Mintonix product updates.",
};

export default function BlogPage() {
  return (
    <div>
      <section className="relative">
        <div
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              "linear-gradient(rgba(54,147,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(54,147,255,0.05) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
            maskImage:
              "radial-gradient(90% 80% at 50% 0%, #000 30%, transparent 78%)",
            WebkitMaskImage:
              "radial-gradient(90% 80% at 50% 0%, #000 30%, transparent 78%)",
          }}
        />
        <div className="relative mx-auto max-w-[1320px] px-8 pt-[76px]">
          <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.13em] text-[var(--brand)]">
            The Mintonix blog
          </div>
          <h1 className="max-w-[18ch] font-display text-[clamp(34px,5vw,60px)] font-semibold leading-[1.05] tracking-[-0.03em] text-[var(--text-strong)] text-balance">
            Notes from the engine room.
          </h1>
          <p className="mt-5 max-w-[56ch] text-[clamp(15px,1.5vw,17px)] leading-[1.6] text-[var(--text-secondary)]">
            How we read a match — rally tempo, shot mix, court coverage, and the
            engineering behind the numbers. Written for players and coaches who
            want the pattern behind the score.
          </p>
        </div>
      </section>

      <BlogCatalog />
    </div>
  );
}
