import type { Metadata } from "next";
import { BwfShell } from "@/components/bwf/shell";

export const metadata: Metadata = {
  title: "BWF match library",
  description:
    "Browse finished BWF matches from the Mintonix catalog — scores, players, tournaments, and video links.",
};

export const revalidate = 300;

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <BwfShell>{children}</BwfShell>;
}
