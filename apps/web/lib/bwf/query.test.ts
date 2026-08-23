import { describe, expect, it } from "vitest";
import type { CatalogMatch, CatalogPlayer } from "./types";
import {
  aggregatePlayers,
  applyInferredCountries,
  buildCatalogStats,
  buildSearchHits,
  buildStaticSearchIndex,
  classifyRivals,
  eventSearchHit,
  filterMatches,
  formSortMatches,
  h2hFromMatches,
  isH2hMeeting,
  matchChronologyMs,
  paginateMatches,
  playerSearchHit,
  resolvePlayerId,
  scoreKind,
  resultChip,
  utcIsoWeekStart,
  thisWeekMatches,
  toDirectoryPlayer,
  topPlayersFromList,
  winRateFromRecord,
  pickPairRating,
  ratingsForPlayer,
  groupMatchesByEvent,
  formOrderCaption,
  splitPairWebId,
  buildFormBoard,
  sameFormBand,
} from "./query";

function match(
  partial: Partial<CatalogMatch> & {
    id: string;
    team1Ids: string[];
    team2Ids: string[];
  },
): CatalogMatch {
  return {
    tournamentRaw: "",
    event: "2026 Test Open",
    year: 2026,
    disc: "MS",
    round: "Final",
    matchDate: null,
    team1: partial.team1Ids.map((id) => id),
    team2: partial.team2Ids.map((id) => id),
    team1Countries: partial.team1Ids.map(() => null),
    team2Countries: partial.team2Ids.map(() => null),
    games: [
      { t1: 21, t2: 10 },
      { t1: 21, t2: 12 },
    ],
    winner: 1,
    result: "completed",
    threeGames: false,
    comeback: false,
    status: "pending",
    sourceUrl: null,
    durationSec: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

describe("winRateFromRecord", () => {
  it("uses decided games only", () => {
    expect(winRateFromRecord(2, 2)).toBe(50);
    expect(winRateFromRecord(3, 0)).toBe(100);
    expect(winRateFromRecord(0, 0)).toBe(0);
  });
});

describe("isH2hMeeting / h2hFromMatches", () => {
  const singles = match({
    id: "s1",
    team1Ids: ["alice"],
    team2Ids: ["bob"],
    team1: ["Alice"],
    team2: ["Bob"],
    winner: 1,
  });

  const partnersWin = match({
    id: "d1",
    disc: "MD",
    team1Ids: ["alice", "bob"],
    team2Ids: ["carol", "dave"],
    team1: ["Alice", "Bob"],
    team2: ["Carol", "Dave"],
    winner: 1,
  });

  const partnersLose = match({
    id: "d2",
    disc: "MD",
    team1Ids: ["carol", "dave"],
    team2Ids: ["alice", "bob"],
    team1: ["Carol", "Dave"],
    team2: ["Alice", "Bob"],
    winner: 1, // carol side wins → alice/bob lose
  });

  const incomplete = match({
    id: "s2",
    team1Ids: ["alice"],
    team2Ids: ["bob"],
    team1: ["Alice"],
    team2: ["Bob"],
    games: [{ t1: 21, t2: 15 }],
    winner: null,
  });

  it("singles opposite sides count", () => {
    expect(isH2hMeeting(singles, "alice", "bob")).toBe(true);
    const r = h2hFromMatches([singles], "alice", "bob");
    expect(r.meetings).toHaveLength(1);
    expect(r.aWins).toBe(1);
    expect(r.bWins).toBe(0);
  });

  it("same-side doubles partners are not meetings", () => {
    expect(isH2hMeeting(partnersWin, "alice", "bob")).toBe(false);
    const r = h2hFromMatches([partnersWin, partnersLose], "alice", "bob");
    expect(r.meetings).toHaveLength(0);
    expect(r.aWins).toBe(0);
  });

  it("opposite doubles opponents count", () => {
    expect(isH2hMeeting(partnersWin, "alice", "carol")).toBe(true);
    const r = h2hFromMatches([partnersWin], "alice", "carol");
    expect(r.aWins).toBe(1);
    expect(r.bWins).toBe(0);
  });

  it("incomplete scorelines do not add wins", () => {
    const r = h2hFromMatches([incomplete], "alice", "bob");
    expect(r.meetings).toHaveLength(1);
    expect(r.aWins).toBe(0);
    expect(r.bWins).toBe(0);
  });
});

describe("filterMatches / paginateMatches", () => {
  const list = [
    match({
      id: "1",
      disc: "MS",
      event: "2026 Japan Open",
      team1Ids: ["a"],
      team2Ids: ["b"],
      sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      threeGames: true,
      comeback: true,
    }),
    match({
      id: "2",
      disc: "WS",
      event: "2026 India Open",
      team1Ids: ["c"],
      team2Ids: ["d"],
      year: 2026,
    }),
  ];

  it("filters by disc and video", () => {
    expect(filterMatches(list, { disc: "MS" })).toHaveLength(1);
    expect(filterMatches(list, { hasVideo: true })).toHaveLength(1);
    expect(filterMatches(list, { threeGames: true })).toHaveLength(1);
    expect(filterMatches(list, { q: "japan" })).toHaveLength(1);
  });

  it("filters year, round, comeback, player, non-youtube video", () => {
    const more = [
      ...list,
      match({
        id: "3",
        disc: "MS",
        year: 2025,
        round: "Semifinal",
        team1Ids: ["a"],
        team2Ids: ["e"],
        comeback: true,
        sourceUrl: "https://evil.example/v/abcdefghijk",
      }),
    ];
    expect(filterMatches(more, { year: 2025 })).toHaveLength(1);
    expect(filterMatches(more, { round: "semifinal" })).toHaveLength(1);
    expect(filterMatches(more, { comeback: true }).map((m) => m.id)).toEqual(
      expect.arrayContaining(["1", "3"]),
    );
    // Non-allowlisted URL does not count as hasVideo
    expect(
      filterMatches(more, { hasVideo: true }).every((m) =>
        m.sourceUrl?.includes("youtube"),
      ),
    ).toBe(true);
  });

  it("paginates and clamps page", () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      match({
        id: String(i),
        team1Ids: ["a"],
        team2Ids: ["b"],
      }),
    );
    const page = paginateMatches(many, 99, 24);
    expect(page.page).toBe(page.totalPages);
    expect(page.matches.length).toBeLessThanOrEqual(24);
    expect(page.total).toBe(50);
  });
});

describe("formSortMatches / matchChronologyMs", () => {
  it("prefers matchDate then createdAt descending", () => {
    const a = match({
      id: "old-date",
      team1Ids: ["a"],
      team2Ids: ["b"],
      matchDate: "2026-01-01",
      createdAt: "2026-06-01T00:00:00Z",
    });
    const b = match({
      id: "new-date",
      team1Ids: ["a"],
      team2Ids: ["b"],
      matchDate: "2026-03-01",
      createdAt: "2026-01-01T00:00:00Z",
    });
    const c = match({
      id: "no-date-new",
      team1Ids: ["a"],
      team2Ids: ["b"],
      matchDate: null,
      createdAt: "2026-12-01T00:00:00Z",
    });
    expect(formSortMatches([a, b, c]).map((m) => m.id)).toEqual([
      "no-date-new",
      "new-date",
      "old-date",
    ]);
  });

  it("falls back to createdAt when matchDate is invalid", () => {
    const bad = match({
      id: "bad-date",
      team1Ids: ["a"],
      team2Ids: ["b"],
      matchDate: "not-a-date",
      createdAt: "2026-06-01T00:00:00Z",
    });
    const good = match({
      id: "good-date",
      team1Ids: ["a"],
      team2Ids: ["b"],
      matchDate: "2026-01-01",
      createdAt: "2020-01-01T00:00:00Z",
    });
    expect(Number.isNaN(matchChronologyMs(bad))).toBe(false);
    expect(formSortMatches([good, bad]).map((m) => m.id)).toEqual([
      "bad-date",
      "good-date",
    ]);
  });
});

describe("aggregatePlayers", () => {
  it("computes W–L and win rate on decided only", () => {
    const matches = [
      match({
        id: "1",
        team1Ids: ["alice"],
        team2Ids: ["bob"],
        team1: ["Alice"],
        team2: ["Bob"],
        winner: 1,
        createdAt: "2026-02-01T00:00:00Z",
      }),
      match({
        id: "2",
        team1Ids: ["alice"],
        team2Ids: ["carol"],
        team1: ["Alice"],
        team2: ["Carol"],
        games: [{ t1: 21, t2: 10 }],
        winner: null,
        createdAt: "2026-03-01T00:00:00Z",
      }),
      match({
        id: "3",
        team1Ids: ["bob"],
        team2Ids: ["alice"],
        team1: ["Bob"],
        team2: ["Alice"],
        winner: 1,
        createdAt: "2026-04-01T00:00:00Z",
      }),
    ];
    const players = aggregatePlayers(matches);
    const alice = players.find((p) => p.id === "alice")!;
    expect(alice.matches).toBe(3);
    expect(alice.wins).toBe(1);
    expect(alice.losses).toBe(1);
    expect(alice.winRate).toBe(50);
    // form uses chronology (newest first); no recentMatchIds on CatalogPlayer
    expect(alice.form[0]).toBe("L");
    expect("recentMatchIds" in alice).toBe(false);
    expect(alice.rivals.some((r) => r.id === "bob" && r.meetings === 2)).toBe(
      true,
    );

    const slim = toDirectoryPlayer(alice);
    expect(slim).toEqual({
      id: alice.id,
      name: alice.name,
      country: alice.country,
      disc: alice.disc,
      discs: alice.discs,
      matches: alice.matches,
      wins: alice.wins,
      losses: alice.losses,
      winRate: alice.winRate,
      threeGames: alice.threeGames,
      withVideo: alice.withVideo,
      imageUrl: alice.imageUrl,
      rating: alice.rating,
    });
    expect("form" in slim).toBe(false);
    expect("rivals" in slim).toBe(false);
  });

  it("skips empty name ids", () => {
    const matches = [
      match({
        id: "1",
        team1Ids: [""],
        team2Ids: ["bob"],
        team1: [""],
        team2: ["Bob"],
      }),
    ];
    const players = aggregatePlayers(matches);
    expect(players.find((p) => p.id === "")).toBeUndefined();
  });
});

describe("topPlayersFromList / buildSearchHits", () => {
  const players: CatalogPlayer[] = [
    {
      id: "a",
      name: "Alpha",
      country: "den",
      disc: "MS",
      discs: ["MS"],
      matches: 10,
      wins: 9,
      losses: 1,
      winRate: 90,
      threeGames: 0,
      withVideo: 0,
      form: [],
      rivals: [],
      owns: [],
      struggles: [],
      rating: null,
      individualRating: null,
      ratings: [],
      imageUrl: null,
    },
    {
      id: "b",
      name: "Beta",
      country: "jpn",
      disc: "MS",
      discs: ["MS"],
      matches: 2,
      wins: 2,
      losses: 0,
      winRate: 100,
      threeGames: 0,
      withVideo: 0,
      form: [],
      rivals: [],
      owns: [],
      struggles: [],
      rating: null,
      individualRating: null,
      ratings: [],
      imageUrl: null,
    },
  ];

  it("requires min decided for top list", () => {
    const top = topPlayersFromList(players, { minDecided: 3, limit: 5 });
    expect(top.map((p) => p.id)).toEqual(["a"]);
  });

  it("search empty and mix", () => {
    const matches = [
      match({
        id: "m1",
        team1Ids: ["a"],
        team2Ids: ["b"],
        team1: ["Alpha"],
        team2: ["Beta"],
        event: "2026 Japan Open",
      }),
    ];
    const stats = buildCatalogStats(matches, players);
    expect(buildSearchHits("", players, matches, stats)).toEqual([]);
    const hits = buildSearchHits("japan", players, matches, stats, 10);
    expect(hits.some((h) => h.kind === "Tournament")).toBe(true);
    expect(hits.some((h) => h.kind === "Match")).toBe(true);
  });

  it("search player hits and respects limit", () => {
    const matches = [
      match({
        id: "m1",
        team1Ids: ["a"],
        team2Ids: ["b"],
        team1: ["Alpha"],
        team2: ["Beta"],
        event: "2026 Alpha Cup",
      }),
    ];
    const stats = buildCatalogStats(matches, players);
    const hits = buildSearchHits("alpha", players, matches, stats, 2);
    expect(hits.length).toBeLessThanOrEqual(2);
    expect(hits.some((h) => h.kind === "Player" && h.id === "a")).toBe(true);
  });

  it("applies 3/2/3 primary budgets when all kinds are abundant", () => {
    const manyPlayers: CatalogPlayer[] = Array.from({ length: 10 }, (_, i) => ({
      id: `p${i}`,
      name: `Alpha Player ${i}`,
      country: "chn",
      disc: "MS" as const,
      discs: ["MS" as const],
      matches: 5,
      wins: 3,
      losses: 2,
      winRate: 60,
      threeGames: 0,
      withVideo: 0,
      form: [],
      rivals: [],
      owns: [],
      struggles: [],
      rating: null,
      individualRating: null,
      ratings: [],
      imageUrl: null,
    }));
    const matches = Array.from({ length: 6 }, (_, i) =>
      match({
        id: `m${i}`,
        team1Ids: ["p0"],
        team2Ids: ["p1"],
        team1: ["Alpha Player 0"],
        team2: ["Alpha Player 1"],
        event: `2026 Alpha Open ${i}`,
      }),
    );
    // Force multiple tournament hits under the same query.
    const stats = buildCatalogStats(matches, manyPlayers);
    // Inject extra events sharing "alpha" in the name for budget pressure.
    stats.events = [
      { event: "Alpha Cup A", year: 2026, count: 3 },
      { event: "Alpha Cup B", year: 2026, count: 2 },
      { event: "Alpha Cup C", year: 2026, count: 1 },
      ...stats.events,
    ];
    const hits = buildSearchHits("alpha", manyPlayers, matches, stats, 8);
    const playersHits = hits.filter((h) => h.kind === "Player");
    const tourneyHits = hits.filter((h) => h.kind === "Tournament");
    const matchHits = hits.filter((h) => h.kind === "Match");
    // Primary slot take: 3 + 2 + 3 = 8 exactly when all abundant.
    expect(playersHits.length).toBe(3);
    expect(tourneyHits.length).toBe(2);
    expect(matchHits.length).toBe(3);
    expect(hits).toHaveLength(8);
  });

  it("fills remainder when primary under-fills limit", () => {
    // Only 1 event + 1 match match "zeta"; many players do — remainder fills with players.
    const manyPlayers: CatalogPlayer[] = Array.from({ length: 10 }, (_, i) => ({
      id: `z${i}`,
      name: `Zeta Ace ${i}`,
      country: null,
      disc: "MS" as const,
      discs: ["MS" as const],
      matches: 4,
      wins: 2,
      losses: 2,
      winRate: 50,
      threeGames: 0,
      withVideo: 0,
      form: [],
      rivals: [],
      owns: [],
      struggles: [],
      rating: null,
      individualRating: null,
      ratings: [],
      imageUrl: null,
    }));
    const matches = [
      match({
        id: "zm1",
        team1Ids: ["z0"],
        team2Ids: ["z1"],
        team1: ["Zeta Ace 0"],
        team2: ["Zeta Ace 1"],
        event: "2026 Zeta Open",
      }),
    ];
    const stats = buildCatalogStats(matches, manyPlayers);
    const hits = buildSearchHits("zeta", manyPlayers, matches, stats, 8);
    expect(hits).toHaveLength(8);
    expect(hits.filter((h) => h.kind === "Tournament")).toHaveLength(1);
    expect(hits.filter((h) => h.kind === "Match")).toHaveLength(1);
    expect(hits.filter((h) => h.kind === "Player").length).toBe(6);
  });

  it("playerSearchHit sub format matches static and live paths", () => {
    const hit = playerSearchHit(players[0]);
    const event = eventSearchHit({ event: "2026 Japan Open", count: 4 });
    expect(hit.sub).toBe("DEN · 10 matches · 90% win · MS");
    expect(event.sub).toBe("4 matches");

    const matches = [
      match({
        id: "m1",
        team1Ids: ["a"],
        team2Ids: ["b"],
        team1: ["Alpha"],
        team2: ["Beta"],
        event: "2026 Japan Open",
      }),
    ];
    const stats = buildCatalogStats(matches, players);
    const staticHit = buildStaticSearchIndex(players, stats, {
      playerLimit: 1,
      eventLimit: 1,
    })[0];
    const liveHit = buildSearchHits("alpha", players, matches, stats, 8).find(
      (h) => h.kind === "Player",
    )!;
    expect(staticHit.sub).toBe(hit.sub);
    expect(liveHit.sub).toBe(hit.sub);
  });

  it("buildStaticSearchIndex returns player + event hits without matches", () => {
    const matches = [
      match({
        id: "m1",
        team1Ids: ["a"],
        team2Ids: ["b"],
        team1: ["Alpha"],
        team2: ["Beta"],
        event: "2026 Japan Open",
      }),
    ];
    const stats = buildCatalogStats(matches, players);
    const index = buildStaticSearchIndex(players, stats, {
      playerLimit: 1,
      eventLimit: 1,
    });
    expect(index).toHaveLength(2);
    expect(index[0].kind).toBe("Player");
    expect(index[1].kind).toBe("Tournament");
  });
});

describe("homonym identity", () => {
  it("keeps same name + different country as two players", () => {
    const matches = [
      match({
        id: "1",
        team1Ids: ["chen-yu--chn"],
        team2Ids: ["opp-a"],
        team1: ["Chen Yu"],
        team2: ["Opp A"],
        team1Countries: ["chn"],
        team2Countries: ["jpn"],
      }),
      match({
        id: "2",
        team1Ids: ["chen-yu--tpe"],
        team2Ids: ["opp-b"],
        team1: ["Chen Yu"],
        team2: ["Opp B"],
        team1Countries: ["tpe"],
        team2Countries: ["kor"],
        winner: 2,
      }),
    ];
    const players = aggregatePlayers(matches);
    const chn = players.find((p) => p.id === "chen-yu--chn");
    const tpe = players.find((p) => p.id === "chen-yu--tpe");
    expect(chn).toBeTruthy();
    expect(tpe).toBeTruthy();
    expect(chn!.country).toBe("chn");
    expect(tpe!.country).toBe("tpe");
    expect(chn!.wins).toBe(1);
    expect(tpe!.losses).toBe(1);
  });

  it("fills unique country onto matches missing a flag", () => {
    const raw = [
      match({
        id: "1",
        team1Ids: ["viktor-axelsen--den"],
        team2Ids: ["kodai"],
        team1: ["Viktor Axelsen"],
        team2: ["Kodai"],
        team1Countries: ["den"],
        team2Countries: ["jpn"],
      }),
      match({
        id: "2",
        team1Ids: ["viktor-axelsen"],
        team2Ids: ["lee"],
        team1: ["Viktor Axelsen"],
        team2: ["Lee"],
        team1Countries: [null],
        team2Countries: ["mas"],
      }),
    ];
    const filled = applyInferredCountries(raw);
    expect(filled[1].team1Ids[0]).toBe("viktor-axelsen--den");
    expect(filled[1].team1Countries[0]).toBe("den");
    const players = aggregatePlayers(filled);
    expect(players.filter((p) => p.name === "Viktor Axelsen")).toHaveLength(1);
  });

  it("does not merge true homonyms when a row lacks country", () => {
    const raw = [
      match({
        id: "1",
        team1Ids: ["chen-yu--chn"],
        team2Ids: ["a"],
        team1: ["Chen Yu"],
        team2: ["A"],
        team1Countries: ["chn"],
        team2Countries: ["jpn"],
      }),
      match({
        id: "2",
        team1Ids: ["chen-yu--tpe"],
        team2Ids: ["b"],
        team1: ["Chen Yu"],
        team2: ["B"],
        team1Countries: ["tpe"],
        team2Countries: ["kor"],
      }),
      match({
        id: "3",
        team1Ids: ["chen-yu"],
        team2Ids: ["c"],
        team1: ["Chen Yu"],
        team2: ["C"],
        team1Countries: [null],
        team2Countries: ["ina"],
      }),
    ];
    const filled = applyInferredCountries(raw);
    expect(filled[2].team1Ids[0]).toBe("chen-yu");
    const players = aggregatePlayers(filled);
    expect(players.filter((p) => p.name === "Chen Yu")).toHaveLength(3);
  });

  it("resolvePlayerId disambiguates or unique-fills", () => {
    const people = [
      { id: "chen-yu--chn", name: "Chen Yu", country: "chn" },
      { id: "chen-yu--tpe", name: "Chen Yu", country: "tpe" },
      { id: "viktor-axelsen--den", name: "Viktor Axelsen", country: "den" },
    ];
    const split = resolvePlayerId("chen-yu", people);
    expect(split.match).toBeNull();
    expect(split.candidates).toHaveLength(2);
    const unique = resolvePlayerId("viktor-axelsen", people);
    expect(unique.match?.id).toBe("viktor-axelsen--den");
    const exact = resolvePlayerId("chen-yu--chn", people);
    expect(exact.match?.id).toBe("chen-yu--chn");
  });
});

describe("scoreKind / thisWeek / classifyRivals", () => {
  it("labels 2-0 and 2-1", () => {
    expect(
      scoreKind(
        match({
          id: "s",
          team1Ids: ["a"],
          team2Ids: ["b"],
        }),
      ),
    ).toBe("2-0");
    expect(
      scoreKind(
        match({
          id: "t",
          team1Ids: ["a"],
          team2Ids: ["b"],
          games: [
            { t1: 21, t2: 19 },
            { t1: 19, t2: 21 },
            { t1: 21, t2: 18 },
          ],
          threeGames: true,
        }),
      ),
    ).toBe("2-1");
  });

  it("resultChip prefers walkover / retired over scoreline", () => {
    expect(
      resultChip(
        match({
          id: "wo",
          team1Ids: ["a"],
          team2Ids: ["b"],
          games: [],
          winner: 1,
          result: "walkover",
        }),
      ),
    ).toBe("W/O");
    expect(
      resultChip(
        match({
          id: "rt",
          team1Ids: ["a"],
          team2Ids: ["b"],
          games: [{ t1: 21, t2: 15 }],
          winner: 1,
          result: "retired",
        }),
      ),
    ).toBe("ret.");
  });

  it("thisWeek is the ISO calendar week (Mon–Sun UTC), not a rolling 7 days", () => {
    // Friday 14 Aug 2026 → week is Mon 10 – Sun 16 Aug UTC.
    const now = Date.parse("2026-08-14T12:00:00Z");
    expect(new Date(utcIsoWeekStart(now)).toISOString()).toBe(
      "2026-08-10T00:00:00.000Z",
    );
    const list = [
      match({
        id: "prev-sun",
        team1Ids: ["a"],
        team2Ids: ["b"],
        matchDate: "2026-08-09",
      }),
      match({
        id: "this-mon",
        team1Ids: ["a"],
        team2Ids: ["b"],
        matchDate: "2026-08-10",
      }),
      match({
        id: "this-wed",
        team1Ids: ["a"],
        team2Ids: ["b"],
        matchDate: "2026-08-12",
      }),
      match({
        id: "old",
        team1Ids: ["a"],
        team2Ids: ["b"],
        matchDate: "2026-01-01",
      }),
    ];
    expect(
      thisWeekMatches(list, { now, limit: 10 }).map((m) => m.id),
    ).toEqual(["this-wed", "this-mon"]);
  });

  it("owns requires 4 meetings, 70%+, and same form band", () => {
    const rivals = [
      { id: "x", name: "X", meetings: 4, wins: 4, winRate: 1 },
      { id: "y", name: "Y", meetings: 4, wins: 1, winRate: 0.25 },
      { id: "z", name: "Z", meetings: 2, wins: 2, winRate: 1 },
    ];
    const self = {
      disc: "MS" as const,
      kind: "player" as const,
      mu: 1800,
      rd: 50,
      rankScore: 1700,
      matches: 20,
    };
    const byId = new Map([
      [
        "x",
        {
          disc: "MS" as const,
          kind: "player" as const,
          mu: 1750,
          rd: 50,
          rankScore: 1650,
          matches: 20,
        },
      ],
      [
        "y",
        {
          disc: "MS" as const,
          kind: "player" as const,
          mu: 1780,
          rd: 50,
          rankScore: 1680,
          matches: 20,
        },
      ],
      [
        "z",
        {
          disc: "MS" as const,
          kind: "player" as const,
          mu: 1760,
          rd: 50,
          rankScore: 1660,
          matches: 20,
        },
      ],
    ]);
    const { owns, struggles } = classifyRivals(rivals, self, byId);
    expect(owns.map((r) => r.id)).toEqual(["x"]);
    expect(struggles.map((r) => r.id)).toEqual(["y"]);
  });
});

describe("pair / disc ratings", () => {
  it("looks up pair form in either name order", () => {
    const byKey = new Map([
      [
        "kim-won-ho--kor--seo-seung-jae--kor|MD",
        {
          disc: "MD" as const,
          kind: "pair" as const,
          mu: 1800,
          rd: 50,
          rankScore: 1700,
          matches: 40,
        },
      ],
    ]);
    expect(
      pickPairRating("seo-seung-jae--kor", "kim-won-ho--kor", "MD", byKey)
        ?.rankScore,
    ).toBe(1700);
  });

  it("lists every disc board for a player", () => {
    const byKey = new Map([
      [
        "an-se-young--kor|WS",
        {
          disc: "WS" as const,
          kind: "player" as const,
          mu: 2000,
          matches: 80,
        },
      ],
      [
        "an-se-young--kor|XD",
        {
          disc: "XD" as const,
          kind: "pair" as const,
          mu: 1600,
          matches: 8,
        },
      ],
    ]);
    expect(ratingsForPlayer("an-se-young--kor", byKey).map((r) => r.disc)).toEqual(
      ["WS", "XD"],
    );
  });

  it("splits pair web ids at the unique known-id boundary", () => {
    const ids = new Set(["kim-won-ho--kor", "seo-seung-jae--kor"]);
    expect(
      splitPairWebId("kim-won-ho--kor--seo-seung-jae--kor", ids),
    ).toEqual(["kim-won-ho--kor", "seo-seung-jae--kor"]);
  });

  it("splits pair web ids on name--cc members when the directory is empty", () => {
    expect(
      splitPairWebId("kim-won-ho--kor--seo-seung-jae--kor", new Set()),
    ).toEqual(["kim-won-ho--kor", "seo-seung-jae--kor"]);
  });

  it("builds form boards sorted by rank score", () => {
    const byKey = new Map([
      [
        "a|MS",
        {
          disc: "MS" as const,
          kind: "player" as const,
          mu: 1800,
          rankScore: 1700,
          matches: 40,
          webId: "a",
          name: "Alpha",
        },
      ],
      [
        "b|MS",
        {
          disc: "MS" as const,
          kind: "player" as const,
          mu: 1900,
          rankScore: 1800,
          matches: 30,
          webId: "b",
          name: "Beta",
        },
      ],
    ]);
    expect(buildFormBoard(byKey, new Set(["a", "b"])).map((r) => r.name)).toEqual(
      ["Beta", "Alpha"],
    );
  });

  it("sameFormBand uses nullish rank scores, not truthiness", () => {
    const a = { disc: "MS" as const, kind: "player" as const, mu: 1500, rankScore: 0, matches: 10 };
    const b = { disc: "MS" as const, kind: "player" as const, mu: 1500, rankScore: 50, matches: 10 };
    expect(sameFormBand(a, b)).toBe(true);
    expect(sameFormBand(a, { ...b, rankScore: undefined })).toBe(false);
  });

  it("groups this-week events without dropping matches", () => {
    const list = [
      match({ id: "1", team1Ids: ["a"], team2Ids: ["b"], event: "Japan Open" }),
      match({ id: "2", team1Ids: ["c"], team2Ids: ["d"], event: "Japan Open" }),
      match({ id: "3", team1Ids: ["e"], team2Ids: ["f"], event: "Korea Open" }),
    ];
    const groups = groupMatchesByEvent(list);
    expect(groups.map((g) => [g.event, g.matches.length])).toEqual([
      ["Japan Open", 2],
      ["Korea Open", 1],
    ]);
    expect(formOrderCaption(list)).toBe(" (by ingest order; match dates missing)");
  });
});

