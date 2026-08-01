import type { Metadata } from "next";
import { BwfErrorState } from "@/components/bwf/error-state";
import { H2hView } from "@/components/bwf/h2h-view";
import {
  getDirectoryPlayers,
  getH2h,
  searchDirectoryPlayers,
} from "@/lib/bwf/catalog";
import { catalogUserError } from "@/lib/bwf/errors";
import type {
  CatalogMatch,
  DirectoryPlayer,
  H2hPickerPlayer,
} from "@/lib/bwf/types";


export const metadata: Metadata = {
  title: "BWF head-to-head",
  description: "Head-to-head meetings computed from the BWF match catalog.",
};

export const revalidate = 300;

const SEED_LIMIT = 80;

function toPicker(p: {
  id: string;
  name: string;
  matches: number;
  disc: DirectoryPlayer["disc"];
}): H2hPickerPlayer {
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
    a: DirectoryPlayer | null;
    b: DirectoryPlayer | null;
    meetings: CatalogMatch[];
    aWins: number;
    bWins: number;
  } | null = null;
  let error: string | null = null;
  let empty = false;

  try {
    const directory = await getDirectoryPlayers();
    if (directory.length === 0) {
      empty = true;
    } else {
      // Slim seed: top players by match count (not the full directory).
      const seed = await searchDirectoryPlayers("", SEED_LIMIT);
      const byId = new Map(directory.map((p) => [p.id, p]));

      const defaultA = seed[0]?.id ?? directory[0].id;
      const defaultB =
        seed.find((p) => p.id !== defaultA)?.id ??
        directory.find((p) => p.id !== defaultA)?.id ??
        defaultA;

      aId = sp.a && byId.has(sp.a) ? sp.a : defaultA;
      bId =
        sp.b && byId.has(sp.b) && sp.b !== aId
          ? sp.b
          : directory.find((p) => p.id !== aId)?.id ?? defaultB;

      const seedIds = new Set(seed.map((p) => p.id));
      picker = seed.map(toPicker);
      // Ensure selected pair is always present in the picker seed.
      for (const id of [aId, bId]) {
        if (!seedIds.has(id)) {
          const p = byId.get(id);
          if (p) picker.unshift(toPicker(p));
        }
      }

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
