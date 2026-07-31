import { describe, expect, it } from "vitest";
import type { CatalogMatch, CatalogPlayer } from "./types";
import {
  aggregatePlayers,
  buildCatalogStats,
  buildSearchHits,
  buildStaticSearchIndex,
  eventSearchHit,
  filterMatches,
  formSortMatches,
  h2hFromMatches,
  isH2hMeeting,
  matchChronologyMs,
  paginateMatches,
  playerSearchHit,
  toDirectoryPlayer,
  topPlayersFromList,
  winRateFromRecord,
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
    games: [
      { t1: 21, t2: 10 },
      { t1: 21, t2: 12 },
    ],
    winner: 1,
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
      disc: alice.disc,
      discs: alice.discs,
      matches: alice.matches,
      wins: alice.wins,
      losses: alice.losses,
      winRate: alice.winRate,
      threeGames: alice.threeGames,
      withVideo: alice.withVideo,
      imageUrl: alice.imageUrl,
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
      imageUrl: null,
    },
    {
      id: "b",
      name: "Beta",
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
    expect(hit.sub).toBe("10 matches · 90% win · MS");
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
