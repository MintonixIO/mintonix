import type { Metadata } from "next";
import { AppShell } from "@/components/app/app-shell";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

/**
 * App shell: persistent sidebar + main content region under /dashboard/*.
 * Deep product surfaces (calibration, video-analysis, replay, bwf, auth)
 * live outside this group so they render full-bleed without a second shell.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
