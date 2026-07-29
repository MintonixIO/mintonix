export function BwfErrorState({
  title = "Catalog temporarily unavailable",
  message,
}: {
  title?: string;
  message?: string;
}) {
  return (
    <section className="rounded-[14px] border border-[rgba(244,81,92,0.35)] bg-[rgba(244,81,92,0.08)] px-6 py-12 text-center">
      <h1 className="font-display text-xl font-semibold text-[var(--text-strong)]">
        {title}
      </h1>
      <p className="mx-auto mt-2 max-w-[48ch] text-[13.5px] leading-relaxed text-[var(--text-secondary)]">
        {message ||
          "We could not load the BWF match catalog right now. Please try again in a moment."}
      </p>
    </section>
  );
}
