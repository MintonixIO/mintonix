import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";
import type { CatalogSnapshot } from "./catalog";
import { mapDbMatch, type DbMatchRow } from "./parse";
import {
  aggregatePlayers,
  applyInferredCountries,
  buildCatalogStats,
  pickPlayerRating,
  toDirectoryPlayer,
} from "./query";
import type { Disc, FormRating } from "./types";

function loadRows(): DbMatchRow[] {
  const file = path.join(process.cwd(), ".preview/catalog-rows.json");
  const raw = readFileSync(file, "utf8");
  return JSON.parse(raw) as DbMatchRow[];
}

function ratingsFromMatches(
  matches: ReturnType<typeof applyInferredCountries>,
): {
  ratingsByKey: Map<string, FormRating>;
  individualsByKey: Map<string, FormRating>;
} {
  const ratingsByKey = new Map<string, FormRating>();
  const individualsByKey = new Map<string, FormRating>();
  const players = aggregatePlayers(matches);
  for (const p of players) {
    const disc = (p.disc ?? p.discs[0] ?? "MS") as Disc;
    const wr = p.matches > 0 ? p.wins / p.matches : 0.5;
    const mu = 1450 + wr * 200 + Math.log1p(p.matches) * 18;
    const rd = Math.max(45, 120 - p.matches);
    const rating: FormRating = {
      disc,
      kind: "player",
      mu,
      rd,
      rankScore: mu - 2 * rd,
      peakMu: mu + 40,
      matches: p.matches,
      webId: p.id,
      name: p.name,
    };
    ratingsByKey.set(`${p.id}|${disc}`, rating);
    if (p.discs.some((d) => d === "MD" || d === "WD" || d === "XD")) {
      const partnerDisc = p.discs.find((d) => d === "MD" || d === "WD" || d === "XD") ?? disc;
      individualsByKey.set(`${p.id}|${partnerDisc}`, {
        disc: partnerDisc,
        kind: "individual",
        mu: mu / 50,
        exposure: mu / 50 - 0.4,
        matches: p.matches,
      });
    }
  }
  // Pair boards: one synthetic rating per frequent doubles pairing.
  const pairCounts = new Map<string, { n: number; disc: Disc }>();
  for (const m of matches) {
    if (!m.disc || m.team1Ids.length < 2 || m.team2Ids.length < 2) continue;
    for (const ids of [m.team1Ids, m.team2Ids]) {
      const key = `${[...ids].sort().join("--")}|${m.disc}`;
      const cur = pairCounts.get(key) ?? { n: 0, disc: m.disc };
      cur.n += 1;
      pairCounts.set(key, cur);
    }
  }
  for (const [key, { n, disc }] of pairCounts) {
    if (n < 4) continue;
    const mu = 1500 + Math.log1p(n) * 30;
    ratingsByKey.set(key, {
      disc,
      kind: "pair",
      mu,
      rd: 70,
      rankScore: mu - 140,
      peakMu: mu + 20,
      matches: n,
      webId: key.split("|")[0],
      name: key
        .split("|")[0]
        .split("--")
        .filter((p) => p.length > 3)
        .map((p) => p.replace(/-/g, " "))
        .join(" / "),
    });
  }
  return { ratingsByKey, individualsByKey };
}

export function loadPreviewSnapshot(): CatalogSnapshot {
  const matches = applyInferredCountries(loadRows().map(mapDbMatch));
  const { ratingsByKey, individualsByKey } = ratingsFromMatches(matches);
  const full = aggregatePlayers(matches);
  const directoryPlayers = full.map((p) => ({
    ...toDirectoryPlayer(p),
    rating: pickPlayerRating(p, ratingsByKey),
  }));
  const stats = buildCatalogStats(matches, directoryPlayers);
  return { matches, directoryPlayers, stats, ratingsByKey, individualsByKey };
}
