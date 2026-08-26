import { describe, expect, it } from "vitest";
import {
  abbrevVariants,
  buildAbbrevCanonicalMap,
  canonicalDisplayName,
  givenInitials,
  isAbbrevGiven,
  playerIdAliases,
} from "./name-identity";
import { playerIdFromName } from "./parse";
import { applyCanonicalNames, bestH2hPair, resolvePlayerId } from "./query";
import type { CatalogMatch } from "./types";

function match(
  partial: Partial<CatalogMatch> & {
    id: string;
    team1: string[];
    team2: string[];
    team1Ids: string[];
    team2Ids: string[];
  },
): CatalogMatch {
  return {
    tournamentRaw: "",
    event: "2026 Test Open",
    year: 2026,
    disc: "MD",
    round: "Final",
    matchDate: "2026-08-12",
    team1Countries: [null, null],
    team2Countries: [null, null],
    games: [{ t1: 21, t2: 15 }, { t1: 21, t2: 18 }],
    winner: 1,
    result: "completed",
    threeGames: false,
    comeback: false,
    status: "pending",
    sourceUrl: null,
    durationSec: null,
    createdAt: "2026-08-12T00:00:00Z",
    ...partial,
  };
}

describe("abbreviation identity", () => {
  it("treats hyphen initials as abbreviated", () => {
    expect(isAbbrevGiven("w-h")).toBe(true);
    expect(isAbbrevGiven("s f")).toBe(true);
    expect(isAbbrevGiven("yf")).toBe(true);
    expect(isAbbrevGiven("won-ho")).toBe(false);
    expect(isAbbrevGiven("yufei")).toBe(false);
  });

  it("initials from hyphenated and pinyin given names", () => {
    expect(givenInitials("won-ho")).toBe("wh");
    expect(givenInitials("sze fei")).toBe("sf");
    expect(givenInitials("yufei")).toBe("yf");
    expect(givenInitials("se-young")).toBe("sy");
    // boyang → byn (yang as y+ng); BY still maps via unique subsequence
    expect(givenInitials("boyang").startsWith("by")).toBe(true);
  });

  it("maps unique abbrev onto the full name, same country", () => {
    const map = buildAbbrevCanonicalMap([
      { name: "Kim Won-ho", country: "KOR" },
      { name: "Kim W-h", country: "KOR" },
      { name: "Kim Yu-jung", country: "KOR" },
      { name: "Kim Y-j", country: "KOR" },
    ]);
    expect(canonicalDisplayName("Kim W-h", "KOR", map)).toBe("Kim Won-ho");
    expect(canonicalDisplayName("Kim Y-j", "KOR", map)).toBe("Kim Yu-jung");
    expect(playerIdFromName("Kim W-h", "KOR")).not.toBe(
      playerIdFromName("Kim Won-ho", "KOR"),
    );
  });

  it("does not merge when two full names share initials", () => {
    const map = buildAbbrevCanonicalMap([
      { name: "Sung Yu-hsuan", country: "TPE" },
      { name: "Sung Yi-hao", country: "TPE" },
      { name: "Sung Y-h", country: "TPE" },
    ]);
    expect(canonicalDisplayName("Sung Y-h", "TPE", map)).toBe("Sung Y-h");
  });

  it("keeps Chen Yu CHN vs TPE split", () => {
    const map = buildAbbrevCanonicalMap([
      { name: "Chen Yu", country: "CHN" },
      { name: "Chen Yu", country: "TPE" },
    ]);
    expect(map.size).toBe(0);
  });

  it("rewrites match rosters so pair H2H ids match", () => {
    const a = match({
      id: "full",
      team1: ["Kim Won-ho", "Seo Seung-jae"],
      team2: ["Goh Sze Fei", "Nur Izzuddin"],
      team1Ids: [
        playerIdFromName("Kim Won-ho", "KOR"),
        playerIdFromName("Seo Seung-jae", "KOR"),
      ],
      team2Ids: [
        playerIdFromName("Goh Sze Fei", "MAS"),
        playerIdFromName("Nur Izzuddin", "MAS"),
      ],
      team1Countries: ["kor", "kor"],
      team2Countries: ["mas", "mas"],
    });
    const b = match({
      id: "abbr",
      team1: ["Kim W-h", "Seo S-j"],
      team2: ["Goh S F", "Nur Izzuddin"],
      team1Ids: [
        playerIdFromName("Kim W-h", "KOR"),
        playerIdFromName("Seo S-j", "KOR"),
      ],
      team2Ids: [
        playerIdFromName("Goh S F", "MAS"),
        playerIdFromName("Nur Izzuddin", "MAS"),
      ],
      team1Countries: ["kor", "kor"],
      team2Countries: ["mas", "mas"],
    });
    const [full, abbr] = applyCanonicalNames([a, b]);
    expect(full.team1Ids).toEqual(abbr.team1Ids);
    expect(abbr.team1).toEqual(["Kim Won-ho", "Seo Seung-jae"]);
  });

  it("resolves abbreviated player ids after the merge", () => {
    const players = [
      {
        id: playerIdFromName("Kim Won-ho", "KOR"),
        name: "Kim Won-ho",
        country: "kor",
      },
    ];
    const short = playerIdFromName("Kim W-h", "KOR");
    expect(playerIdAliases("Kim Won-ho", "kor")).toContain(short);
    expect(resolvePlayerId(short, players).match?.id).toBe(players[0].id);
  });

  it("picks the H2H pair with the most meetings", () => {
    const a = "an-se-young--kor";
    const b = "chen-yufei--chn";
    const c = "other--jpn";
    const list = [
      match({
        id: "1",
        team1: ["An"],
        team2: ["Chen"],
        team1Ids: [a],
        team2Ids: [b],
        disc: "WS",
      }),
      match({
        id: "2",
        team1: ["An"],
        team2: ["Chen"],
        team1Ids: [a],
        team2Ids: [b],
        disc: "WS",
      }),
      match({
        id: "3",
        team1: ["An"],
        team2: ["X"],
        team1Ids: [a],
        team2Ids: [c],
        disc: "WS",
      }),
    ];
    expect(bestH2hPair(list)).toEqual({ a, b });
  });

  it("emits wikipedia-style variants", () => {
    expect(abbrevVariants("Kim Won-ho").some((v) => /w-h/i.test(v))).toBe(true);
    expect(abbrevVariants("Chen Yufei").some((v) => /yf/i.test(v))).toBe(true);
  });
});
