import type { Metadata } from "next";
import { after } from "next/server";
import { BwfShell } from "@/components/bwf/shell";
import { warmCatalogSnapshot } from "@/lib/bwf/catalog";
import { catalogUserError } from "@/lib/bwf/errors";

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
  after(() =>
    warmCatalogSnapshot().catch((err) => {
      catalogUserError(err, "bwf/layout-warm");
    }),
  );

  return <BwfShell>{children}</BwfShell>;
}
