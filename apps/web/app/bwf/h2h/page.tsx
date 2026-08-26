import type { Metadata } from "next";
import { BwfErrorState } from "@/components/bwf/error-state";
import { H2hView } from "@/components/bwf/h2h-view";
import {
  getDefaultH2hIds,
  getDirectoryPlayers,
  getH2h,
  searchDirectoryPlayers,
} from "@/lib/bwf/catalog";
import { catalogUserError } from "@/lib/bwf/errors";
import { resolvePlayerId } from "@/lib/bwf/query";
import type {
  DirectoryPlayer,
  H2hPickerPlayer,
  H2hResult,
} from "@/lib/bwf/types";


export const metadata: Metadata = {
  title: "BWF head-to-head",
  description: "Head-to-head meetings computed from the BWF match catalog.",
};

export const revalidate = 300;

const SEED_LIMIT = 80;

function resolveCatalogId(
  raw: string | undefined,
  directory: DirectoryPlayer[],
): string {
  if (!raw) return "";
  const hit = resolvePlayerId(raw, directory);
  if (hit.match) return hit.match.id;
  return directory.some((p) => p.id === raw) ? raw : "";
}

function toPicker(p: {
  id: string;
  name: string;
  matches: number;
  disc: DirectoryPlayer["disc"];
  country?: string | null;
}): H2hPickerPlayer {
  return {
    id: p.id,
    name: p.name,
    matches: p.matches,
    disc: p.disc,
    country: p.country ?? null,
  };
}

export default async function BwfH2hPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string; a2?: string; b2?: string }>;
}) {
  const sp = await searchParams;
  let picker: H2hPickerPlayer[] = [];
  let aId = "";
  let bId = "";
  let a2Id = "";
  let b2Id = "";
  let h2h: H2hResult | null = null;
  let error: string | null = null;
  let empty = false;

  try {
    const directory = await getDirectoryPlayers();
    if (directory.length === 0) {
      empty = true;
    } else {
      const seed = await searchDirectoryPlayers("", SEED_LIMIT);
      const byId = new Map(directory.map((p) => [p.id, p]));
      const hasQuery = Boolean(sp.a || sp.b || sp.a2 || sp.b2);

      aId = resolveCatalogId(sp.a, directory);
      bId = resolveCatalogId(sp.b, directory);
      if (!hasQuery) {
        const defaults = await getDefaultH2hIds();
        aId = defaults?.a ?? "";
        bId = defaults?.b && defaults.b !== aId ? defaults.b : "";
      }
      if (bId === aId) bId = "";
      a2Id = resolveCatalogId(sp.a2, directory);
      b2Id = resolveCatalogId(sp.b2, directory);
      if (a2Id === aId || a2Id === bId) a2Id = "";
      if (b2Id === bId || b2Id === aId || b2Id === a2Id) b2Id = "";

      const seedIds = new Set(seed.map((p) => p.id));
      picker = seed.map(toPicker);
      for (const id of [aId, bId, a2Id, b2Id]) {
        if (id && !seedIds.has(id)) {
          const p = byId.get(id);
          if (p) picker.unshift(toPicker(p));
        }
      }

      h2h = await getH2h(aId, bId, {
        a2: a2Id || undefined,
        b2: b2Id || undefined,
      });
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
      key={`${aId}:${bId}:${a2Id}:${b2Id}`}
      players={picker}
      initialA={aId}
      initialB={bId}
      initialA2={a2Id}
      initialB2={b2Id}
      a={h2h.a}
      b={h2h.b}
      meetings={h2h.meetings}
      aWins={h2h.aWins}
      bWins={h2h.bWins}
      pairMode={h2h.pairMode}
      pairARating={h2h.pairARating}
      pairBRating={h2h.pairBRating}
      pairAName={
        a2Id ? (picker.find((p) => p.id === a2Id)?.name ?? null) : null
      }
      pairBName={
        b2Id ? (picker.find((p) => p.id === b2Id)?.name ?? null) : null
      }
    />
  );
}
