import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/marketing/reveal";
import { cn } from "@/lib/utils";

type Cta = {
  href: string;
  label: string;
  variant?: "primary" | "outline" | "ghost";
};

/** Top hero: eyebrow, title, body, CTAs + optional media / side content. */
export function FeatureHero({
  eyebrow,
  EyebrowIcon,
  title,
  body,
  ctas,
  children,
  align = "left",
  glow,
  eyebrowClassName,
  titleClassName,
  className,
  contentClassName,
  gridClassName = "grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14",
  maxWidthClassName = "max-w-[1320px]",
  /** When true, children render outside the inner padded container (e.g. full-bleed strip). */
  bleedChildren = false,
}: {
  eyebrow: string;
  EyebrowIcon?: LucideIcon;
  title: ReactNode;
  body: ReactNode;
  ctas?: Cta[];
  children?: ReactNode;
  align?: "left" | "center";
  /** Radial glow background (CSS background value) */
  glow?: string;
  eyebrowClassName?: string;
  titleClassName?: string;
  className?: string;
  contentClassName?: string;
  gridClassName?: string;
  maxWidthClassName?: string;
  bleedChildren?: boolean;
}) {
  const centered = align === "center";

  const copy = (
    <HeroCopy
      eyebrow={eyebrow}
      EyebrowIcon={EyebrowIcon}
      title={title}
      body={body}
      ctas={ctas}
      centered={centered}
      eyebrowClassName={eyebrowClassName}
      titleClassName={titleClassName}
    />
  );

  return (
    <section className={cn("relative", className)}>
      {glow ? (
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: glow }}
        />
      ) : null}
      <div
        className={cn(
          "relative mx-auto px-8",
          maxWidthClassName,
          centered ? "pt-24" : "pt-[92px]",
          contentClassName,
        )}
      >
        {children && !centered && !bleedChildren ? (
          <div className={gridClassName}>
            {copy}
            {children}
          </div>
        ) : (
          <div className={cn(centered && "mx-auto max-w-[900px] text-center")}>
            {copy}
            {!bleedChildren ? children : null}
          </div>
        )}
      </div>
      {bleedChildren ? children : null}
    </section>
  );
}

function HeroCopy({
  eyebrow,
  EyebrowIcon,
  title,
  body,
  ctas,
  centered,
  eyebrowClassName,
  titleClassName,
}: {
  eyebrow: string;
  EyebrowIcon?: LucideIcon;
  title: ReactNode;
  body: ReactNode;
  ctas?: Cta[];
  centered: boolean;
  eyebrowClassName?: string;
  titleClassName?: string;
}) {
  return (
    <div>
      <div
        className={cn(
          "inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em]",
          eyebrowClassName ??
            "bg-[var(--accent-soft)] text-[var(--accent)]",
        )}
      >
        {EyebrowIcon ? <EyebrowIcon className="h-3.5 w-3.5" /> : null}
        {eyebrow}
      </div>
      <h1
        className={cn(
          "mt-[22px] font-display text-[clamp(36px,5vw,60px)] font-semibold leading-[1.04] tracking-[-0.03em] text-[var(--text-strong)] text-balance",
          centered && "mx-auto",
          titleClassName,
        )}
      >
        {title}
      </h1>
      <p
        className={cn(
          "mt-5 max-w-[50ch] text-[clamp(15px,1.5vw,18px)] leading-[1.62] text-[var(--text-secondary)]",
          centered && "mx-auto max-w-[52ch]",
        )}
      >
        {body}
      </p>
      {ctas && ctas.length > 0 ? (
        <div
          className={cn(
            "mt-8 flex flex-wrap gap-3",
            centered && "justify-center",
          )}
        >
          {ctas.map((c) => (
            <Button
              key={c.href + c.label}
              href={c.href}
              size="lg"
              variant={
                c.variant === "outline"
                  ? "outline"
                  : c.variant === "ghost"
                    ? "ghost"
                    : "primary"
              }
            >
              {c.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Section of value cards (icon + title + body). */
export function FeatureValueGrid({
  items,
  columns = 3,
  className,
  cardClassName,
  iconWrapClassName,
}: {
  items: Array<{
    icon?: LucideIcon;
    title: string;
    body: string;
    meta?: ReactNode;
  }>;
  columns?: 2 | 3 | 4;
  className?: string;
  cardClassName?: string;
  iconWrapClassName?: string;
}) {
  const cols =
    columns === 2
      ? "sm:grid-cols-2"
      : columns === 4
        ? "sm:grid-cols-2 lg:grid-cols-4"
        : "sm:grid-cols-2 lg:grid-cols-3";

  return (
    <div className={cn("grid gap-4", cols, className)}>
      {items.map((item) => (
        <Reveal
          key={item.title}
          className={cn(
            "rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-[22px] transition-transform hover:-translate-y-0.5",
            cardClassName,
          )}
        >
          {item.icon ? (
            <span
              className={cn(
                "inline-flex h-10 w-10 items-center justify-center rounded-[11px] border border-[var(--border)] bg-[var(--accent-soft)] text-[var(--accent)]",
                iconWrapClassName,
              )}
            >
              <item.icon className="h-[19px] w-[19px]" strokeWidth={1.75} />
            </span>
          ) : null}
          <h3
            className={cn(
              "font-display text-base font-semibold text-[var(--text-strong)]",
              item.icon ? "mt-4" : undefined,
            )}
          >
            {item.title}
          </h3>
          <p className="mt-1.5 text-[13.5px] leading-[1.55] text-[var(--text-secondary)]">
            {item.body}
          </p>
          {item.meta}
        </Reveal>
      ))}
    </div>
  );
}

/** Section wrapper with optional Reveal header (eyebrow + title). */
export function FeatureSection({
  eyebrow,
  title,
  description,
  children,
  className,
  headerClassName,
  maxWidthClassName = "max-w-[1180px]",
  align = "left",
  eyebrowClassName,
  headerAside,
}: {
  eyebrow?: string;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  headerClassName?: string;
  maxWidthClassName?: string;
  align?: "left" | "center";
  eyebrowClassName?: string;
  headerAside?: ReactNode;
}) {
  const centered = align === "center";

  return (
    <section
      className={cn("mx-auto px-8", maxWidthClassName, className)}
    >
      {title || eyebrow ? (
        <Reveal
          className={cn(
            "mb-10 max-w-[640px]",
            centered && "mx-auto mb-[52px] max-w-[620px] text-center",
            headerAside && "mb-10 flex flex-wrap items-end justify-between gap-4 max-w-none",
            headerClassName,
          )}
        >
          <div className={cn(headerAside && "max-w-[640px]")}>
            {eyebrow ? (
              <div
                className={cn(
                  "mb-3.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--accent)]",
                  eyebrowClassName,
                )}
              >
                {eyebrow}
              </div>
            ) : null}
            {title ? (
              <h2 className="font-display text-[clamp(28px,3.4vw,42px)] font-semibold leading-[1.1] tracking-[-0.025em] text-[var(--text-strong)] text-balance">
                {title}
              </h2>
            ) : null}
            {description ? (
              <div className="mt-4 text-[15.5px] leading-[1.6] text-[var(--text-secondary)]">
                {description}
              </div>
            ) : null}
          </div>
          {headerAside}
        </Reveal>
      ) : null}
      {children}
    </section>
  );
}

/** Bottom CTA band. */
export function FeatureCTA({
  title,
  body,
  ctas,
  children,
  glow,
  className,
  layout = "center",
}: {
  title: ReactNode;
  body?: ReactNode;
  ctas?: Cta[];
  children?: ReactNode;
  glow?: string;
  className?: string;
  layout?: "center" | "split";
}) {
  return (
    <section
      className={cn(
        "mx-auto max-w-[1180px] px-8 pb-[140px] pt-[110px]",
        className,
      )}
    >
      <Reveal
        className={cn(
          "relative rounded-[20px] border border-[var(--border)]",
          layout === "center"
            ? "px-8 py-[72px] text-center"
            : "grid items-center gap-10 p-[52px] md:grid-cols-2",
        )}
        style={{
          background:
            glow ??
            "radial-gradient(120% 140% at 50% -20%, rgba(54,147,255,0.16), transparent 60%), var(--surface-1)",
        }}
      >
        <div>
          <h2
            className={cn(
              "font-display text-[clamp(28px,3.6vw,44px)] font-semibold leading-[1.08] tracking-[-0.03em] text-[var(--text-strong)] text-balance",
              layout === "center"
                ? "mx-auto max-w-[18ch]"
                : "max-w-[16ch] text-[clamp(26px,3.2vw,38px)] tracking-[-0.025em]",
            )}
          >
            {title}
          </h2>
          {body ? (
            <p
              className={cn(
                "mt-4 text-[16px] leading-[1.6] text-[var(--text-secondary)]",
                layout === "center"
                  ? "mx-auto max-w-[48ch]"
                  : "max-w-[46ch] text-[15.5px]",
              )}
            >
              {body}
            </p>
          ) : null}
          {ctas && ctas.length > 0 ? (
            <div
              className={cn(
                "mt-[30px] flex flex-wrap gap-3",
                layout === "center"
                  ? "items-center justify-center"
                  : "mt-[26px]",
              )}
            >
              {ctas.map((c) => (
                <Button
                  key={c.href + c.label}
                  href={c.href}
                  size="lg"
                  variant={
                    c.variant === "outline"
                      ? "outline"
                      : c.variant === "ghost"
                        ? "ghost"
                        : "primary"
                  }
                >
                  {c.label}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
        {children}
      </Reveal>
    </section>
  );
}
