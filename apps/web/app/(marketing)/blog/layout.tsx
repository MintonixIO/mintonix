import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Mintonix marketing blog — analysis notes, product updates, and badminton insight.",
};

export default function BlogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
