import Link from "next/link";
import type { BlogBodyBlock } from "@/lib/blog/posts";

function Paragraph({
  children,
  size = "body",
}: {
  children: React.ReactNode;
  size?: "lead" | "body";
}) {
  if (size === "lead") {
    return (
      <p className="mb-[22px] text-[19px] leading-[1.66] text-[var(--text-strong)]">
        {children}
      </p>
    );
  }
  return (
    <p className="mb-[22px] text-[17px] leading-[1.72] text-[var(--text-secondary)]">
      {children}
    </p>
  );
}

export function BlogBody({ blocks }: { blocks: BlogBodyBlock[] }) {
  return (
    <div className="mx-prose mx-auto mt-12 max-w-[760px] px-8">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "p":
            return (
              <Paragraph key={i} size={block.size ?? "body"}>
                {block.text}
              </Paragraph>
            );
          case "rich-p":
            return (
              <Paragraph key={i} size={block.size ?? "body"}>
                {block.parts.map((part, j) => {
                  if (part.kind === "strong") {
                    return (
                      <strong
                        key={j}
                        className="font-semibold text-[var(--text-strong)]"
                      >
                        {part.text}
                      </strong>
                    );
                  }
                  if (part.kind === "link") {
                    return (
                      <Link
                        key={j}
                        href={part.href}
                        className="border-b border-[rgba(54,147,255,0.4)] text-[var(--brand,#3693ff)] no-underline"
                      >
                        {part.text}
                      </Link>
                    );
                  }
                  return <span key={j}>{part.text}</span>;
                })}
              </Paragraph>
            );
          case "h2":
            return (
              <h2
                key={i}
                className="mt-11 font-display text-[26px] font-semibold leading-[1.18] tracking-[-0.02em] text-[var(--text-strong)]"
              >
                <span className="mb-2.5 block font-mono text-[11px] font-normal uppercase tracking-[0.14em] text-[var(--brand,#3693ff)]">
                  {block.kicker}
                </span>
                {block.title}
              </h2>
            );
          case "stats":
            return (
              <div
                key={i}
                className="my-8 grid grid-cols-3 gap-px overflow-hidden rounded-[13px] border border-[var(--border)] bg-[var(--border-subtle)]"
              >
                {block.items.map((s) => (
                  <div
                    key={s.label}
                    className="bg-[var(--surface-1)] px-5 py-[22px]"
                  >
                    <div
                      className={`font-display text-[30px] font-semibold tracking-[-0.02em] tabular-nums ${
                        s.accent
                          ? "text-[var(--brand,#3693ff)]"
                          : "text-[var(--text-strong)]"
                      }`}
                    >
                      {s.v}
                    </div>
                    <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>
            );
          case "quote":
            return (
              <blockquote
                key={i}
                className="my-8 border-l-[3px] border-[var(--brand,#3693ff)] py-1 pl-6 font-display text-[22px] leading-[1.4] tracking-[-0.015em] text-[var(--text-strong)]"
              >
                {block.text}
              </blockquote>
            );
          case "list":
            return (
              <ul
                key={i}
                className="mb-6 flex list-none flex-col gap-3 p-0"
              >
                {block.items.map((item) => (
                  <li
                    key={item.label}
                    className="relative pl-6 text-[16.5px] leading-[1.62] text-[var(--text-secondary)] before:absolute before:left-1 before:top-[11px] before:h-1.5 before:w-1.5 before:rounded-sm before:bg-[var(--brand,#3693ff)]"
                  >
                    <strong className="font-semibold text-[var(--text-strong)]">
                      {item.label}
                    </strong>{" "}
                    {item.text}
                  </li>
                ))}
              </ul>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
