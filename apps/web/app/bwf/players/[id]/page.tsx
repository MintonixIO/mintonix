import { notFound } from "next/navigation";
import { BwfErrorState } from "@/components/bwf/error-state";
import {
  HomonymDisambiguation,
  PlayerProfile,
} from "@/components/bwf/player-profile";
import {
  getPlayerById,
  getPlayerMatches,
  listPlayerHomonyms,
} from "@/lib/bwf/catalog";
import { catalogUserError } from "@/lib/bwf/errors";
import type { CatalogMatch, CatalogPlayer, DirectoryPlayer } from "@/lib/bwf/types";

export const revalidate = 300;

export default async function BwfPlayerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let profile: CatalogPlayer | null = null;
  let matches: CatalogMatch[] = [];
  let homonyms: DirectoryPlayer[] = [];
  let error: string | null = null;

  try {
    profile = await getPlayerById(id);
    if (profile) {
      matches = await getPlayerMatches(profile.id, 40);
    } else {
      homonyms = await listPlayerHomonyms(id);
    }
  } catch (err) {
    error = catalogUserError(err, "bwf/player-detail");
  }

  if (error) {
    return <BwfErrorState title="Could not load player" message={error} />;
  }
  if (!profile) {
    if (homonyms.length > 1) {
      return <HomonymDisambiguation queryId={id} candidates={homonyms} />;
    }
    notFound();
  }

  return <PlayerProfile profile={profile} matches={matches} />;
}
