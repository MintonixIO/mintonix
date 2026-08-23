import { describe, expect, it } from "vitest";
import {
  catalogStatsFromSql,
  comebackAndFilter,
  isoDateUtc,
  planMatchList,
  playerRosterOrFilter,
  rosterSearchOrFilter,
  sanitizeFilterValue,
  tournamentDiscIlike,
  youtubeSourceOrFilter,
} from "./match-query";

describe("sanitizeFilterValue", () => {
  it("strips PostgREST filter metacharacters", () => {
    expect(sanitizeFilterValue("foo*,(bar)\\baz")).toBe("foobarbaz");
    expect(sanitizeFilterValue("  Japan Open  ")).toBe("Japan Open");
  });
});

describe("tournamentDiscIlike", () => {
  it("matches the loader middle-dot disc slot", () => {
    expect(tournamentDiscIlike("MS")).toBe("% · MS · %");
    expect(tournamentDiscIlike("XD")).toBe("% · XD · %");
  });
});

describe("youtubeSourceOrFilter", () => {
  it("covers allowlisted hosts as ilike ors", () => {
    const or = youtubeSourceOrFilter();
    expect(or).toContain("source_url.ilike.%youtube.com%");
    expect(or).toContain("source_url.ilike.%youtu.be%");
    expect(or).toContain("source_url.ilike.%youtube-nocookie.com%");
  });
});

describe("rosterSearchOrFilter / playerRosterOrFilter", () => {
  it("searches tournament plus four roster columns", () => {
    const or = rosterSearchOrFilter("axelsen");
    expect(or).toContain('tournament.ilike."%axelsen%"');
    expect(or).toContain('team1_player1.ilike."%axelsen%"');
    expect(or).toContain('team2_player2.ilike."%axelsen%"');
  });

  it("turns a player web id into a roster name needle", () => {
    const or = playerRosterOrFilter("chen-yu--chn");
    expect(or).toContain('team1_player1.ilike."%chen yu%"');
    expect(or).not.toContain("--chn");
  });
});

describe("comebackAndFilter", () => {
  it("requires a third game and a game-1 loser who won the match", () => {
    const and = comebackAndFilter();
    expect(and).toContain("g3_t1.not.is.null");
    expect(and).toContain("g3_t2.not.is.null");
    expect(and).toContain("winner_side.eq.2");
    expect(and).toContain("winner_side.eq.1");
  });
});

describe("isoDateUtc", () => {
  it("formats a UTC ms timestamp as YYYY-MM-DD", () => {
    expect(isoDateUtc(Date.UTC(2026, 7, 16))).toBe("2026-08-16");
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

  it("over-fetches when filtering by player id so JS can match slugs", () => {
    const plan = planMatchList({ player: "viktor-axelsen", page: 1, pageSize: 24 });
    expect(plan.overFetch).toBe(true);
    expect(plan.from).toBe(0);
    expect(plan.to).toBe(999);
    expect(
      plan.filters.some(
        (f) => f.kind === "or" && f.value.includes("viktor axelsen"),
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
});

describe("catalogStatsFromSql", () => {
  it("fills missing discs, maps with_video, and sorts years desc", () => {
    const stats = catalogStatsFromSql({
      matches: 10,
      players: 4,
      tournaments: 2,
      with_video: 3,
      by_disc: { MS: 7 },
      events: [{ event: "2026 Open", year: 2026, count: 10 }],
      rounds: ["First round", "Final"],
      years: [2024, 2026, 2025],
    });
    expect(stats.withVideo).toBe(3);
    expect(stats.byDisc.MS).toBe(7);
    expect(stats.byDisc.WS).toBe(0);
    expect(stats.years).toEqual([2026, 2025, 2024]);
    expect(stats.rounds[0]).toBe("Final");
  });
});
