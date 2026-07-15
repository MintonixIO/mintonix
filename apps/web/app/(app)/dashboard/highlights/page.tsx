import type { Metadata } from "next";
import { HighlightsApp } from "@/components/highlights/highlights-app";

export const metadata: Metadata = { title: "Highlights" };

export default function HighlightsPage() {
  return <HighlightsApp />;
}
