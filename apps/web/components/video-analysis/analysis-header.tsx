"use client";

import Link from "next/link";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AnalysisHeader() {
  return (
    <header className="sticky top-0 z-50 flex h-[60px] items-center gap-3.5 border-b border-[var(--border-subtle)] bg-[rgba(10,16,32,0.82)] px-6 backdrop-blur-[14px]">
      <Link
        href="/dashboard"
        aria-label="Back"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]"
      >
        <ArrowLeft className="h-[18px] w-[18px]" />
      </Link>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/assets/logomark.png" alt="Mintonix" className="h-[22px] w-auto" />
      <div className="flex items-center gap-2 font-mono text-xs text-[var(--text-muted)]">
        <span>Library</span>
        <ChevronRight className="h-[13px] w-[13px]" />
        <span className="text-[var(--text-secondary)]">Axelsen vs Momota</span>
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-3 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1">
        <span className="inline-flex items-center gap-1.5 text-[13px] text-[var(--text-strong)]">
          <span className="h-2 w-2 rounded-full bg-[var(--player-a)]" />
          Axelsen
        </span>
        <span className="font-mono text-sm tabular-nums tracking-wide text-[var(--text-strong)]">
          21 – 18
        </span>
        <span className="inline-flex items-center gap-1.5 text-[13px] text-[var(--text-strong)]">
          <span className="h-2 w-2 rounded-full bg-[var(--player-b)]" />
          Momota
        </span>
      </div>
      <Button variant="outline">Export rallies</Button>
    </header>
  );
}
