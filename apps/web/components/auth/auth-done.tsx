import Link from "next/link";
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
      <p className="mx-auto mt-2.5 mb-[30px] max-w-[34ch] text-[14.5px] leading-[1.6] text-[var(--text-secondary)]">
        Your player profile is ready. Upload your first match and Mintonix will
        turn it into rallies, heatmaps, and metrics.
      </p>
      <Link href="/dashboard" className="block">
        <Button variant="primary" size="lg" block>
          Go to your dashboard
        </Button>
      </Link>
      <Link href="/" className="mt-3.5 inline-flex justify-center">
        <Button variant="ghost" size="md">
          Back to home
        </Button>
      </Link>
    </div>
  );
}
