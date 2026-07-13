import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Replay",
  description:
    "Watch any match from any angle with Mintonix Replay — reconstructed rallies, free camera placement.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
