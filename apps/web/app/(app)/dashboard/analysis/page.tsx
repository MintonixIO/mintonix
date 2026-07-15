import type { Metadata } from "next";
import { AnalysisApp } from "@/components/analysis/analysis-app";

export const metadata: Metadata = { title: "Analysis" };

export default function AnalysisPage() {
  return <AnalysisApp />;
}
