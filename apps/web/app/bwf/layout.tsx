import type { Metadata } from "next";
import { BwfShell } from "@/components/bwf/shell";
import { getStaticSearchIndex } from "@/lib/bwf/catalog";
import { catalogUserError } from "@/lib/bwf/errors";
import type { SearchHit } from "@/lib/bwf/types";

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
  let searchIndex: SearchHit[] = [];
  try {
    searchIndex = await getStaticSearchIndex();
  } catch (err) {
    catalogUserError(err, "bwf/layout-search");
    searchIndex = [];
  }

  return <BwfShell searchIndex={searchIndex}>{children}</BwfShell>;
}
