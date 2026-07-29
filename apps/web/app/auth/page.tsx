"use client";

import { Suspense } from "react";
import { AuthApp } from "@/components/auth/auth-app";

export default function AuthPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-[var(--bg-base)] text-[var(--text-muted)]">
          Loading…
        </main>
      }
    >
      <AuthApp />
    </Suspense>
  );
}
