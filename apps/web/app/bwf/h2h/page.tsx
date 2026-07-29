import { BwfErrorState } from "@/components/bwf/error-state";
import { H2hView } from "@/components/bwf/h2h-view";
import { getCatalogPlayers, getH2h } from "@/lib/bwf/catalog";
import { catalogUserError } from "@/lib/bwf/errors";
import type {
  CatalogMatch,
  CatalogPlayer,
  H2hPickerPlayer,
} from "@/lib/bwf/types";

export const revalidate = 300;

function toPicker(p: CatalogPlayer): H2hPickerPlayer {
  return {
    id: p.id,
    name: p.name,
    matches: p.matches,
    disc: p.disc,
  };
}

export default async function BwfH2hPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const sp = await searchParams;
  let picker: H2hPickerPlayer[] = [];
  let aId = "";
  let bId = "";
  let h2h: {
    a: CatalogPlayer | null;
    b: CatalogPlayer | null;
    meetings: CatalogMatch[];
    aWins: number;
    bWins: number;
  } | null = null;
  let error: string | null = null;
  let empty = false;

  try {
    const players = await getCatalogPlayers();
    if (players.length === 0) {
      empty = true;
    } else {
      picker = players.map(toPicker);
      const defaultA = players[0].id;
      const defaultB =
        players.find((p) => p.id !== defaultA)?.id ?? defaultA;
      aId = sp.a && players.some((p) => p.id === sp.a) ? sp.a : defaultA;
      bId =
        sp.b && players.some((p) => p.id === sp.b) && sp.b !== aId
          ? sp.b
          : players.find((p) => p.id !== aId)?.id ?? defaultB;
      h2h = await getH2h(aId, bId);
    }
  } catch (err) {
    error = catalogUserError(err, "bwf/h2h");
  }

  if (empty) {
    return (
      <BwfErrorState
        title="No players yet"
        message="The BWF catalog has no match rows to derive players from."
      />
    );
  }

  if (error || !h2h) {
    return <BwfErrorState message={error ?? undefined} />;
  }

  return (
    <H2hView
      key={`${aId}:${bId}`}
      players={picker}
      initialA={aId}
      initialB={bId}
      a={h2h.a}
      b={h2h.b}
      meetings={h2h.meetings}
      aWins={h2h.aWins}
      bWins={h2h.bWins}
    />
  );
}
