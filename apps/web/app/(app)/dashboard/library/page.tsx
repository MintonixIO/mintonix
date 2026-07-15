import type { Metadata } from "next";
import { LibraryApp } from "@/components/library/library-app";

export const metadata: Metadata = { title: "Library" };

export default function LibraryPage() {
  return <LibraryApp />;
}
