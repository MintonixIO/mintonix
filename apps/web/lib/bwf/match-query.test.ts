import { describe, expect, it } from "vitest";
import type { CatalogMatch } from "./types";
import {
  catalogStatsFromSql,
  filterMatchList,
  orderMatchList,
  PLAYER_OVERFETCH_LIMIT,
  planMatchList,
  playerRosterLikeNeedles,
  playerRosterOrFilter,
  rosterSearchOrFilter,
  sanitizeFilterValue,
  sourceUrlMatchesYoutubeFilter,
  tournamentDiscIlike,
  youtubeSourceOrFilter,
} from "./match-query";
import { paginateMatches } from "./query";

function match(
  partial: Partial<CatalogMatch> & {
    id: string;
    team1Ids: string[];
    team2Ids: string[];
  },
): CatalogMatch {
  const event = partial.event ?? "2026 Test Open";
  const disc = partial.disc ?? "MS";
  const round = partial.round ?? "Final";
  return {
    tournamentRaw: `${event} · ${disc} · ${round}`,
    event,
    year: 2026,
    disc,
    round,
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

const comeBackGames = [
  { t1: 19, t2: 21 },
  { t1: 21, t2: 10 },
  { t1: 21, t2: 18 },
] as const;

describe("sanitizeFilterValue", () => {
  it("strips PostgREST filter metacharacters including quotes and LIKE wildcards", () => {
    expect(sanitizeFilterValue("foo*,(bar)\\baz")).toBe("foobarbaz");
    expect(sanitizeFilterValue("  Japan Open  ")).toBe("Japan Open");
    expect(sanitizeFilterValue('foo"bar,()')).not.toContain('"');
    expect(sanitizeFilterValue('foo"bar,()')).not.toContain(",");
    expect(sanitizeFilterValue("100%_off")).toBe("100off");
  });
});

describe("tournamentDiscIlike", () => {
  it("matches the loader middle-dot disc slot", () => {
    expect(tournamentDiscIlike("MS")).toBe("% · MS · %");
    expect(tournamentDiscIlike("XD")).toBe("% · XD · %");
  });
});

describe("youtubeSourceOrFilter / sourceUrlMatchesYoutubeFilter", () => {
  it("covers allowlisted hosts as ilike ors", () => {
    const or = youtubeSourceOrFilter();
    expect(or).toContain("source_url.ilike.%youtube.com%");
    expect(or).toContain("source_url.ilike.%youtu.be%");
    expect(or).toContain("source_url.ilike.%youtube-nocookie.com%");
  });

  it("matches the same hosts in memory", () => {
    expect(
      sourceUrlMatchesYoutubeFilter("https://www.youtube.com/watch?v=abcdefghijk"),
    ).toBe(true);
    expect(sourceUrlMatchesYoutubeFilter("https://youtu.be/abcdefghijk")).toBe(
      true,
    );
    expect(
      sourceUrlMatchesYoutubeFilter("https://evil.example/v/abcdefghijk"),
    ).toBe(false);
  });
});

describe("rosterSearchOrFilter / playerRosterOrFilter", () => {
  it("searches tournament plus four roster columns", () => {
    const or = rosterSearchOrFilter("axelsen");
    expect(or).toContain('tournament.ilike."%axelsen%"');
    expect(or).toContain('team1_player1.ilike."%axelsen%"');
    expect(or).toContain('team2_player2.ilike."%axelsen%"');
  });

  it("turns a player web id into LIKE needles that match stored names", () => {
    const or = playerRosterOrFilter("chen-yu--chn");
    expect(or).toContain('team1_player1.ilike."%chen%yu%"');
    expect(or).toContain('team1_player1.ilike."%chen-yu%"');
    expect(or).not.toContain("--chn");

    const ilike = (hay: string, needle: string) =>
      new RegExp(
        needle
          .split("%")
          .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join(".*"),
        "i",
      ).test(hay);

    const seYoung = playerRosterLikeNeedles("an-se-young--kor");
    expect(seYoung).toContain("an%se%young");
    expect(seYoung.some((n) => ilike("An Se-young", n))).toBe(true);

    const chen = playerRosterLikeNeedles("chen-yu--chn");
    expect(chen.some((n) => ilike("Chen Yu (born 1980)", n))).toBe(true);
  });
});

describe("planMatchList", () => {
  it("pages 24 rows and always scopes to system catalog", () => {
    const plan = planMatchList({ page: 2, pageSize: 24 });
    expect(plan.from).toBe(24);
    expect(plan.to).toBe(47);
    expect(plan.overFetch).toBe(false);
    expect(plan.order[0]?.column).toBe("match_date");
  });

  it("filters disc via the tournament middle slot", () => {
    const plan = planMatchList({ disc: "WS" });
    expect(plan.filters).toContainEqual({
      kind: "ilike",
      column: "tournament",
      value: "% · WS · %",
    });
  });

  it("filters year, event, and round on the tournament string", () => {
    const plan = planMatchList({
      year: 2025,
      event: "All England",
      round: "Final",
    });
    expect(plan.filters).toContainEqual({
      kind: "ilike",
      column: "tournament",
      value: "%2025%",
    });
    expect(plan.filters).toContainEqual({
      kind: "ilike",
      column: "tournament",
      value: "%All England%",
    });
    expect(plan.filters).toContainEqual({
      kind: "ilike",
      column: "tournament",
      value: "% · Final%",
    });
  });

  it("uses or-ilike for q and youtube or for hasVideo", () => {
    const plan = planMatchList({ q: "axelsen", hasVideo: true });
    expect(plan.filters.some((f) => f.kind === "or" && f.value.includes("axelsen"))).toBe(
      true,
    );
    expect(
      plan.filters.some(
        (f) => f.kind === "or" && f.value.includes("youtube.com"),
      ),
    ).toBe(true);
  });

  it("requires both game-3 scores for threeGames", () => {
    const plan = planMatchList({ threeGames: true });
    expect(plan.filters).toContainEqual({ kind: "not_is", column: "g3_t1" });
    expect(plan.filters).toContainEqual({ kind: "not_is", column: "g3_t2" });
  });

  it("expresses comeback as third game plus flipped winner_side", () => {
    const plan = planMatchList({ comeback: true });
    expect(plan.filters).toContainEqual({ kind: "not_is", column: "g3_t1" });
    expect(plan.filters).toContainEqual({ kind: "not_is", column: "g3_t2" });
    expect(
      plan.filters.some(
        (f) => f.kind === "or" && f.value.includes("winner_side.eq.2"),
      ),
    ).toBe(true);
  });

  it("over-fetches a hard-capped window for player id, including page 2", () => {
    const plan = planMatchList({
      player: "viktor-axelsen",
      page: 2,
      pageSize: 24,
    });
    expect(plan.overFetch).toBe(true);
    expect(plan.from).toBe(0);
    expect(plan.to).toBe(PLAYER_OVERFETCH_LIMIT - 1);
    expect(
      plan.filters.some(
        (f) => f.kind === "or" && f.value.includes("viktor%axelsen"),
      ),
    ).toBe(true);
  });

  it("sorts created by created_at and status by status", () => {
    expect(planMatchList({ sort: "created" }).order[0]).toEqual({
      column: "created_at",
      ascending: false,
    });
    expect(planMatchList({ sort: "status" }).order[0]).toEqual({
      column: "status",
      ascending: true,
    });
  });

  it("sort event and round share match_date then tournament", () => {
    expect(planMatchList({ sort: "event" }).order).toEqual(
      planMatchList({ sort: "round" }).order,
    );
    expect(planMatchList({}).order).toEqual(planMatchList({ sort: "event" }).order);
  });
});

describe("filterMatchList (same spec as planMatchList)", () => {
  it("filters year/round/disc/event on the tournament string, not parsed fields", () => {
    const m = match({
      id: "x",
      team1Ids: ["a"],
      team2Ids: ["b"],
      tournamentRaw: "2025 All England · MS · Final",
      event: "ignored",
      year: 2026,
      disc: "WS",
      round: "Semifinal",
    });
    expect(filterMatchList([m], { year: 2025 })).toHaveLength(1);
    expect(filterMatchList([m], { year: 2026 })).toHaveLength(0);
    expect(filterMatchList([m], { round: "Final" })).toHaveLength(1);
    expect(filterMatchList([m], { round: "Semifinal" })).toHaveLength(0);
    expect(filterMatchList([m], { disc: "MS" })).toHaveLength(1);
    expect(filterMatchList([m], { disc: "WS" })).toHaveLength(0);
    expect(filterMatchList([m], { event: "All England" })).toHaveLength(1);
  });

  it("q is OR across tournament and each roster name, not a joined haystack", () => {
    const m = match({
      id: "q",
      team1Ids: ["axelsen"],
      team2Ids: ["ginting"],
      team1: ["Viktor Axelsen"],
      team2: ["Anthony Ginting"],
      tournamentRaw: "2026 Japan Open · MS · Final",
    });
    expect(filterMatchList([m], { q: "Axelsen" })).toHaveLength(1);
    expect(filterMatchList([m], { q: "Japan" })).toHaveLength(1);
    expect(filterMatchList([m], { q: "Axelsen Ginting" })).toHaveLength(0);
  });

  it("hasVideo uses the same youtube host needles as the plan", () => {
    const yt = match({
      id: "yt",
      team1Ids: ["a"],
      team2Ids: ["b"],
      sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk",
    });
    const nocookie = match({
      id: "nc",
      team1Ids: ["a"],
      team2Ids: ["b"],
      sourceUrl: "https://www.youtube-nocookie.com/embed/abcdefghijk",
    });
    const other = match({
      id: "no",
      team1Ids: ["a"],
      team2Ids: ["b"],
      sourceUrl: "https://evil.example/v/abcdefghijk",
    });
    const missing = match({
      id: "null",
      team1Ids: ["a"],
      team2Ids: ["b"],
      sourceUrl: null,
    });
    expect(planMatchList({ hasVideo: true }).filters.some((f) => f.kind === "or")).toBe(
      true,
    );
    expect(
      filterMatchList([yt, nocookie, other, missing], { hasVideo: true })
        .map((x) => x.id)
        .sort(),
    ).toEqual(["nc", "yt"]);
  });

  it("disc/year all and sanitized-empty q add no filters", () => {
    const m = match({ id: "x", team1Ids: ["a"], team2Ids: ["b"] });
    expect(planMatchList({ disc: "all", year: "all" }).filters).toEqual([]);
    expect(filterMatchList([m], { disc: "all", year: "all" })).toHaveLength(1);
    const emptyQ = planMatchList({ q: '*(),\\"%_' });
    expect(emptyQ.filters.filter((f) => f.kind === "or")).toHaveLength(0);
    expect(filterMatchList([m], { q: '*(),\\"%_' })).toHaveLength(1);
  });

  it("threeGames and comeback use g3 + flipped g1 winner, not mapped flags", () => {
    const two = match({ id: "two", team1Ids: ["a"], team2Ids: ["b"] });
    const come = match({
      id: "come",
      team1Ids: ["a"],
      team2Ids: ["b"],
      games: [...comeBackGames],
      winner: 1,
      threeGames: false,
      comeback: false,
    });
    const come2 = match({
      id: "come2",
      team1Ids: ["a"],
      team2Ids: ["b"],
      games: [
        { t1: 21, t2: 19 },
        { t1: 10, t2: 21 },
        { t1: 18, t2: 21 },
      ],
      winner: 2,
      threeGames: false,
      comeback: false,
    });
    const threeStraight = match({
      id: "straight",
      team1Ids: ["a"],
      team2Ids: ["b"],
      games: [
        { t1: 21, t2: 10 },
        { t1: 19, t2: 21 },
        { t1: 21, t2: 15 },
      ],
      winner: 1,
      threeGames: false,
      comeback: false,
    });
    expect(
      filterMatchList([two, come, come2, threeStraight], { threeGames: true })
        .map((x) => x.id)
        .sort(),
    ).toEqual(["come", "come2", "straight"]);
    expect(
      filterMatchList([two, come, come2, threeStraight], { comeback: true })
        .map((x) => x.id)
        .sort(),
    ).toEqual(["come", "come2"]);
  });

  it("player filter uses matchInvolvesPlayer, not name substring", () => {
    const m = match({
      id: "p",
      team1Ids: ["viktor-axelsen--den"],
      team2Ids: ["kento-momota--jpn"],
      team1: ["Viktor Axelsen"],
      team2: ["Kento Momota"],
    });
    expect(
      filterMatchList([m], { player: "viktor-axelsen--den" }).map((x) => x.id),
    ).toEqual(["p"]);
    expect(filterMatchList([m], { player: "Viktor" })).toHaveLength(0);
    expect(filterMatchList([m], { player: "axelsen" })).toHaveLength(0);
  });

  it("sorts event by match_date desc then tournament asc (null dates last)", () => {
    const a = match({
      id: "a",
      team1Ids: ["a"],
      team2Ids: ["b"],
      matchDate: "2026-01-02",
      tournamentRaw: "B Open · MS · Final",
    });
    const b = match({
      id: "b",
      team1Ids: ["a"],
      team2Ids: ["b"],
      matchDate: "2026-01-02",
      tournamentRaw: "A Open · MS · Final",
    });
    const c = match({
      id: "c",
      team1Ids: ["a"],
      team2Ids: ["b"],
      matchDate: "2026-01-03",
      tournamentRaw: "C Open · MS · Final",
    });
    const undated = match({
      id: "n",
      team1Ids: ["a"],
      team2Ids: ["b"],
      matchDate: null,
      tournamentRaw: "Z Open · MS · Final",
    });
    expect(
      filterMatchList([a, b, c, undated], { sort: "event" }).map((m) => m.id),
    ).toEqual(["c", "b", "a", "n"]);
    expect(orderMatchList([a, b, c], "round").map((m) => m.id)).toEqual(
      orderMatchList([a, b, c], "event").map((m) => m.id),
    );
  });

  it("sorts created by createdAt and status alphabetically", () => {
    const older = match({
      id: "old",
      team1Ids: ["a"],
      team2Ids: ["b"],
      createdAt: "2026-01-01T00:00:00Z",
      status: "ready",
    });
    const newer = match({
      id: "new",
      team1Ids: ["a"],
      team2Ids: ["b"],
      createdAt: "2026-06-01T00:00:00Z",
      status: "failed",
    });
    expect(filterMatchList([older, newer], { sort: "created" }).map((m) => m.id)).toEqual(
      ["new", "old"],
    );
    expect(filterMatchList([older, newer], { sort: "status" }).map((m) => m.id)).toEqual(
      ["new", "old"],
    );
    const readyOld = match({
      id: "ready-old",
      team1Ids: ["a"],
      team2Ids: ["b"],
      status: "ready",
      matchDate: "2026-01-01",
    });
    const readyNew = match({
      id: "ready-new",
      team1Ids: ["a"],
      team2Ids: ["b"],
      status: "ready",
      matchDate: "2026-06-01",
    });
    expect(
      filterMatchList([readyOld, readyNew], { sort: "status" }).map((m) => m.id),
    ).toEqual(["ready-new", "ready-old"]);
    expect(planMatchList({ sort: "status" }).order).toEqual([
      { column: "status", ascending: true },
      { column: "match_date", ascending: false },
    ]);
  });

  it("player overFetch page 2 paginates the JS-involved set, not SQL count", () => {
    const involved = Array.from({ length: 50 }, (_, i) =>
      match({
        id: `p${String(i).padStart(2, "0")}`,
        team1Ids: ["alice"],
        team2Ids: ["bob"],
        matchDate: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
      }),
    );
    const page = paginateMatches(
      filterMatchList(involved, { player: "alice" }),
      2,
      24,
    );
    expect(page.page).toBe(2);
    expect(page.total).toBe(50);
    expect(page.matches).toHaveLength(24);
    expect(page.matches[0]?.id).not.toBe("p00");
  });
});

describe("catalogStatsFromSql", () => {
  it("parses raw tournament strings with parseTournament", () => {
    const stats = catalogStatsFromSql({
      matches: 3,
      players: 4,
      with_video: 1,
      tournament_strings: [
        { tournament: "2026 Japan Open (badminton) · MS · Final", count: 2 },
        { tournament: "2025 India Open · WS · First round", count: 1 },
      ],
    });
    expect(stats.withVideo).toBe(1);
    expect(stats.matches).toBe(3);
    expect(stats.players).toBe(4);
    expect(stats.tournaments).toBe(2);
    expect(stats.byDisc.MS).toBe(2);
    expect(stats.byDisc.WS).toBe(1);
    expect(stats.byDisc.MD).toBe(0);
    expect(stats.years).toEqual([2026, 2025]);
    expect(stats.rounds[0]).toBe("Final");
    expect(stats.events.map((e) => [e.event, e.count])).toEqual([
      ["2026 Japan Open", 2],
      ["2025 India Open", 1],
    ]);
  });

  it("counts byDisc only from the middle · DISC · slot", () => {
    const stats = catalogStatsFromSql({
      matches: 2,
      players: 1,
      with_video: 0,
      tournament_strings: [
        { tournament: "2026 MS Invitational · WD · Final", count: 2 },
      ],
    });
    expect(stats.byDisc.MS).toBe(0);
    expect(stats.byDisc.WD).toBe(2);
  });

  it("merges counts for the same parsed event", () => {
    const stats = catalogStatsFromSql({
      matches: 5,
      players: 2,
      with_video: 0,
      tournament_strings: [
        { tournament: "2026 Japan Open · MS · Final", count: 2 },
        { tournament: "2026 Japan Open · WS · Semifinal", count: 3 },
      ],
    });
    expect(stats.tournaments).toBe(1);
    expect(stats.events).toEqual([
      { event: "2026 Japan Open", year: 2026, count: 5 },
    ]);
    expect(stats.byDisc.MS).toBe(2);
    expect(stats.byDisc.WS).toBe(3);
  });

  it.each([undefined, null, {}])(
    "fails closed when tournament_strings is %s",
    (tournament_strings) => {
      expect(() =>
        catalogStatsFromSql({
          matches: 10,
          players: 4,
          with_video: 3,
          tournament_strings: tournament_strings as never,
        }),
      ).toThrow(/tournament_strings/);
    },
  );

  it("skips blank tournament strings", () => {
    const stats = catalogStatsFromSql({
      matches: 5,
      players: 1,
      with_video: 0,
      tournament_strings: [
        { tournament: "   ", count: 5 },
        { tournament: "2026 Japan Open · MS · Final", count: 1 },
      ],
    });
    expect(stats.tournaments).toBe(1);
    expect(stats.byDisc.MS).toBe(1);
  });

  it("does not count title-only MS as a disc slot", () => {
    const stats = catalogStatsFromSql({
      matches: 1,
      players: 1,
      with_video: 0,
      tournament_strings: [{ tournament: "2026 MS Open", count: 1 }],
    });
    expect(stats.byDisc.MS).toBe(0);
    expect(stats.events[0]?.event).toContain("MS Open");
  });

  it("year-less three-slot strings still count disc and round", () => {
    const stats = catalogStatsFromSql({
      matches: 1,
      players: 1,
      with_video: 0,
      tournament_strings: [
        { tournament: "All England Open · MS · Final", count: 1 },
      ],
    });
    expect(stats.byDisc.MS).toBe(1);
    expect(stats.years).toEqual([]);
    expect(stats.events[0]).toEqual({
      event: "All England Open",
      year: null,
      count: 1,
    });
    expect(stats.rounds).toEqual(["Final"]);
  });

  it("empty tournament_strings yields zero facets and keeps headline counts", () => {
    const stats = catalogStatsFromSql({
      matches: 10,
      players: 4,
      with_video: 3,
      tournament_strings: [],
    });
    expect(stats.matches).toBe(10);
    expect(stats.players).toBe(4);
    expect(stats.withVideo).toBe(3);
    expect(stats.tournaments).toBe(0);
    expect(stats.events).toEqual([]);
    expect(stats.byDisc.MS).toBe(0);
  });
});
