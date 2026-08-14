import type { Metadata } from "next";
import { MatchViewer } from "@/components/match-viewer/match-viewer";

export const metadata: Metadata = {
  title: "Match viewer · demo",
  description:
    "Scrub a full badminton match: broadcast, corner orbit, and player POV with rally-level analysis.",
  robots: { index: false, follow: false },
};

/** Standalone demo — synthetic full-match analysis + sample YouTube broadcast. */
export default function MatchViewerDemoPage() {
  return (
    <MatchViewer
      backHref="/bwf/matches"
      backLabel="Back to BWF matches"
      demoAnalysis
    />
  );
}
