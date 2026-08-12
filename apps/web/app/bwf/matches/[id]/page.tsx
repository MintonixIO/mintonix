import { notFound } from "next/navigation";
import { BwfErrorState } from "@/components/bwf/error-state";
import { MatchDetail } from "@/components/bwf/match-detail";
import { getMatchById } from "@/lib/bwf/catalog";
import { catalogUserError } from "@/lib/bwf/errors";
import type { CatalogMatch } from "@/lib/bwf/types";

export const revalidate = 300;

export default async function BwfMatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let match: CatalogMatch | null = null;
  let error: string | null = null;

  try {
    match = await getMatchById(id);
  } catch (err) {
    error = catalogUserError(err, "bwf/match-detail");
  }

  if (error) {
    return <BwfErrorState title="Could not load match" message={error} />;
  }
  if (!match) notFound();

  return <MatchDetail m={match} />;
}
