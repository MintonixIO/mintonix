import { describe, expect, it } from "vitest";
import {
  cleanEventName,
  cleanPlayerName,
  computeGames,
  computeWinner,
  displayDate,
  isComeback,
  mapDbMatch,
  parseTournament,
  playerIdFromName,
  playerWon,
  type DbMatchRow,
} from "./parse";

function row(partial: Partial<DbMatchRow> & { id: string }): DbMatchRow {
  return {
    tournament: null,
    match_date: null,
    team1_player1: null,
    team1_player2: null,
    team2_player1: null,
    team2_player2: null,
    g1_t1: null,
    g1_t2: null,
    g2_t1: null,
    g2_t2: null,
    g3_t1: null,
    g3_t2: null,
    status: "pending",
    source_url: null,
    duration_sec: null,
    created_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

describe("cleanPlayerName", () => {
  it("strips wikipedia badminton disambiguators", () => {
    expect(cleanPlayerName("Brian Yang (badminton)")).toBe("Brian Yang");
    expect(cleanPlayerName("Lin Chun-yi (badminton)")).toBe("Lin Chun-yi");
  });

  it("handles empty", () => {
    expect(cleanPlayerName(null)).toBe("");
    expect(cleanPlayerName("  ")).toBe("");
  });
});

describe("playerIdFromName", () => {
  it("slugifies names", () => {
    expect(playerIdFromName("Viktor Axelsen")).toBe("viktor-axelsen");
  });

  it("returns empty for blank names (no unknown sentinel)", () => {
    expect(playerIdFromName("")).toBe("");
    expect(playerIdFromName("   ")).toBe("");
  });
});

describe("cleanEventName", () => {
  it("strips (badminton)", () => {
    expect(cleanEventName("2026 Swiss Open (badminton)")).toBe(
      "2026 Swiss Open",
    );
  });
});

describe("parseTournament", () => {
  it("parses title · disc · round", () => {
    const p = parseTournament("2026 Japan Open · MS · First round");
    expect(p.event).toBe("2026 Japan Open");
    expect(p.year).toBe(2026);
    expect(p.disc).toBe("MS");
    expect(p.round).toBe("First round");
  });

  it("cleans wikipedia event noise", () => {
    const p = parseTournament(
      "2026 Malaysia Open (badminton) · WD · Final",
    );
    expect(p.event).toBe("2026 Malaysia Open");
    expect(p.disc).toBe("WD");
    expect(p.round).toBe("Final");
  });
});

describe("computeWinner / isComeback", () => {
  it("2–0 straight", () => {
    expect(computeWinner([{ t1: 21, t2: 15 }, { t1: 21, t2: 18 }])).toBe(1);
    expect(computeWinner([{ t1: 15, t2: 21 }, { t1: 18, t2: 21 }])).toBe(2);
  });

  it("2–1 three games", () => {
    const games = [
      { t1: 19, t2: 21 },
      { t1: 21, t2: 10 },
      { t1: 21, t2: 18 },
    ];
    expect(computeWinner(games)).toBe(1);
    expect(isComeback(games, 1)).toBe(true);
  });

  it("incomplete series is null", () => {
    expect(computeWinner([{ t1: 21, t2: 15 }])).toBe(null);
    expect(computeWinner([])).toBe(null);
    expect(
      computeWinner([
        { t1: 21, t2: 19 },
        { t1: 19, t2: 21 },
      ]),
    ).toBe(null);
  });

  it("comeback requires lost g1 + three games + win", () => {
    const games = [
      { t1: 21, t2: 10 },
      { t1: 10, t2: 21 },
      { t1: 10, t2: 21 },
    ];
    expect(computeWinner(games)).toBe(2);
    expect(isComeback(games, 2)).toBe(true);
    expect(isComeback(games, 1)).toBe(false);
  });
});

describe("mapDbMatch / playerWon", () => {
  it("maps doubles roster and scores", () => {
    const m = mapDbMatch(
      row({
        id: "m1",
        tournament: "2026 All England Open · MD · Final",
        team1_player1: "A One",
        team1_player2: "A Two",
        team2_player1: "B One",
        team2_player2: "B Two",
        g1_t1: 21,
        g1_t2: 15,
        g2_t1: 21,
        g2_t2: 18,
      }),
    );
    expect(m.disc).toBe("MD");
    expect(m.team1).toEqual(["A One", "A Two"]);
    expect(m.team2Ids).toHaveLength(2);
    expect(m.winner).toBe(1);
    expect(playerWon(m, m.team1Ids[0])).toBe(true);
    expect(playerWon(m, m.team2Ids[0])).toBe(false);
  });

  it("skips blank roster cells", () => {
    const m = mapDbMatch(
      row({
        id: "m2",
        tournament: "2026 Test · MS · Final",
        team1_player1: "Solo Player",
        team1_player2: "  ",
        team2_player1: "Other",
        g1_t1: 21,
        g1_t2: 10,
        g2_t1: 21,
        g2_t2: 12,
      }),
    );
    expect(m.team1).toEqual(["Solo Player"]);
    expect(m.team1Ids).not.toContain("");
  });
});

describe("computeGames", () => {
  it("drops incomplete game pairs", () => {
    expect(
      computeGames({
        g1_t1: 21,
        g1_t2: 15,
        g2_t1: null,
        g2_t2: null,
        g3_t1: null,
        g3_t2: null,
      }),
    ).toEqual([{ t1: 21, t2: 15 }]);
  });
});

describe("displayDate", () => {
  it("formats valid matchDate in en-GB UTC", () => {
    const m = mapDbMatch(row({ id: "d1", match_date: "2026-03-15" }));
    m.year = null;
    expect(displayDate(m)).toMatch(/15.*Mar.*2026/i);
  });

  it("returns empty for invalid matchDate without year", () => {
    const m = mapDbMatch(row({ id: "d2" }));
    m.matchDate = "not-a-date";
    m.year = null;
    expect(displayDate(m)).toBe("");
  });

  it("falls back to year when matchDate is invalid", () => {
    const m = mapDbMatch(row({ id: "d3" }));
    m.matchDate = "not-a-date";
    m.year = 2025;
    expect(displayDate(m)).toBe("2025");
  });
});
