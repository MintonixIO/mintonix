import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "BWF match library",
  description:
    "Browse BWF singles matches with Mintonix insight, player profiles, and head-to-head compare.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
