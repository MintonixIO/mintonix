import { Sidebar } from "@/components/ui/sidebar";
import {
  appMenu,
  appSidebarSections,
  appUsage,
  appUser,
  appWorkspaces,
} from "@/lib/nav";

/**
 * Persistent app chrome: sidebar stays mounted while Next.js swaps page content.
 * Deep tools (calibration, video-analysis, replay, bwf, auth) live outside (app).
 * Active nav is resolved from the pathname inside Sidebar.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-[var(--bg-base)] text-[var(--text-primary)]">
      <Sidebar
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
