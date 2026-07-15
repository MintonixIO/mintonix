import type { Metadata } from "next";
import { HelpSupportApp } from "@/components/help-support/help-support-app";

export const metadata: Metadata = { title: "Help & support" };

export default function HelpSupportPage() {
  return <HelpSupportApp />;
}
