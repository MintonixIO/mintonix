import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AuthDone({ title }: { title: string }) {
  return (
    <div className="mx-screen text-center" data-screen-label="Done">
      <div className="mx-pop mx-auto mb-[22px] flex h-16 w-16 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--accent-soft)] text-[var(--accent)]">
        <Check className="h-[30px] w-[30px]" aria-hidden />
      </div>
      <h2 className="font-display text-[28px] font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
        {title}
      </h2>
      <p className="mx-auto mt-2.5 mb-3 max-w-[36ch] text-[14.5px] leading-[1.6] text-[var(--text-secondary)]">
        This sign-up flow is a UI preview only — no real account was created.
        The live product today is the free BWF match catalog.
      </p>
      <Button href="/bwf" variant="primary" size="lg" block>
        Open BWF catalog
      </Button>
      <Button href="/" variant="ghost" size="md" className="mt-3.5">
        Back to home
      </Button>
    </div>
  );
}
