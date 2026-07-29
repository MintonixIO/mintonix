import type { MatchStatus } from "./types";

/** Mirrors BadgeTone without importing UI into lib. */
export type StatusTone = "brand" | "success" | "warning" | "danger" | "cyan" | "neutral";

export type StatusPresentation = {
  label: string;
  /** Short label for dense UI (library pills). */
  shortLabel: string;
  tone: StatusTone;
  live: boolean;
};

/** Map pipeline status → UI copy and badge tone. */
export const MATCH_STATUS_UI: Record<MatchStatus, StatusPresentation> = {
  analyzing: {
    label: "Analyzing",
    shortLabel: "Processing",
    tone: "cyan",
    live: true,
  },
  ready: {
    label: "Ready",
    shortLabel: "Analyzed",
    tone: "success",
    live: false,
  },
  queued: {
    label: "Queued",
    shortLabel: "Queued",
    tone: "warning",
    live: false,
  },
  failed: {
    label: "Failed",
    shortLabel: "Failed",
    tone: "danger",
    live: false,
  },
};

export function statusLabel(
  status: MatchStatus,
  variant: "card" | "library" = "card",
): string {
  const p = MATCH_STATUS_UI[status];
  return variant === "library" ? p.shortLabel : p.label;
}

/** Library filter tabs use pipeline statuses + "all". */
export type LibraryStatusFilter = "all" | MatchStatus;

export const LIBRARY_STATUS_TABS: {
  v: LibraryStatusFilter;
  label: string;
}[] = [
  { v: "all", label: "All" },
  { v: "ready", label: "Analyzed" },
  { v: "analyzing", label: "Processing" },
  { v: "queued", label: "Queued" },
];
