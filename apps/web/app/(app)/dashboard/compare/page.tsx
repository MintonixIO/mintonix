import type { Metadata } from "next";
import { CompareApp } from "@/components/compare/compare-app";

export const metadata: Metadata = { title: "Compare" };

export default function ComparePage() {
  return <CompareApp />;
}
