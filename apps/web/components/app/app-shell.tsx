"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/ui/sidebar";
import {
  appMenu,
  appSidebarSections,
  appUsage,
  appUser,
  appWorkspaces,
} from "@/lib/nav";

function activeFromPath(pathname: string) {
  if (pathname.startsWith("/library")) return "library";
  if (pathname.startsWith("/analysis")) return "analysis";
  if (pathname.startsWith("/highlights")) return "highlights";
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/help-support")) return "help";
  if (pathname.startsWith("/compare")) return "analysis";
  return "dashboard";
}

/**
 * Persistent app chrome: sidebar stays mounted while Next.js swaps page content.
 * Deep tools (calibration, video-analysis, replay, bwf, auth) live outside (app).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-dvh bg-[var(--bg-base)] text-[var(--text-primary)]">
      <Sidebar
        active={activeFromPath(pathname)}
        sections={appSidebarSections}
        user={appUser}
        usage={appUsage}
        workspaces={appWorkspaces}
        menu={appMenu}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden">
        {children}
      </div>
    </div>
  );
}
