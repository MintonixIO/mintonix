import { describe, expect, it } from "vitest";
import type { CatalogMatch, CatalogPlayer } from "./types";
import {
  aggregatePlayers,
  buildCatalogStats,
  buildSearchHits,
  filterMatches,
  formSortMatches,
  h2hFromMatches,
  isH2hMeeting,
  paginateMatches,
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
    expect(filterMatches(more, { player: "a" }).length).toBeGreaterThanOrEqual(
      2,
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

describe("formSortMatches", () => {
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
    // form/recent use chronology (newest first)
    expect(alice.form[0]).toBe("L");
    expect(alice.recentMatchIds[0]).toBe("3");
    expect(alice.rivals.some((r) => r.id === "bob" && r.meetings === 2)).toBe(
      true,
    );
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
      recentMatchIds: [],
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
      recentMatchIds: [],
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
});
