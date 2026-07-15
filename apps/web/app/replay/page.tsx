import type { Metadata } from "next";
import { ReplayApp } from "@/components/replay/replay-app";

export const metadata: Metadata = {
  title: "Replay",
  robots: { index: false, follow: false },
};

export default function ReplayPage() {
  return <ReplayApp />;
}
