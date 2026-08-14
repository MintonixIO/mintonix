import { describe, expect, it } from "vitest";
import {
  cleanEventName,
  cleanPlayerName,
  computeGames,
  computeWinner,
  displayDate,
  formatScoreLine,
  isComeback,
  mapDbMatch,
  parseTournament,
  playerIdBase,
  playerIdCountry,
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

  it("keeps born-year parentheticals", () => {
    expect(cleanPlayerName("Chen Yu (badminton, born 1980)")).toBe(
      "Chen Yu (born 1980)",
    );
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

  it("splits homonyms by country", () => {
    expect(playerIdFromName("Chen Yu", "CHN")).toBe("chen-yu--chn");
    expect(playerIdFromName("Chen Yu", "TPE")).toBe("chen-yu--tpe");
    expect(playerIdFromName("Chen Yu", "CHN")).not.toBe(
      playerIdFromName("Chen Yu", "TPE"),
    );
  });

  it("aliases same-person spelling without forking", () => {
    expect(playerIdFromName("Wang Yilü", "CHN")).toBe(
      playerIdFromName("Wang Yilyu", "China"),
    );
    expect(playerIdFromName("An Se Young", "KOR")).toBe("an-se-young--kor");
    expect(playerIdFromName("An Se-young", "Korea")).toBe("an-se-young--kor");
  });

  it("keeps wiki birth-year disambiguators", () => {
    expect(playerIdFromName("Chen Yu (born 1980)")).toBe("chen-yu-born-1980");
    expect(playerIdFromName("Chen Yu (born 1983)")).toBe("chen-yu-born-1983");
  });

  it("splits country suffix from id", () => {
    expect(playerIdBase("chen-yu--chn")).toBe("chen-yu");
    expect(playerIdCountry("chen-yu--chn")).toBe("chn");
    expect(playerIdBase("viktor-axelsen")).toBe("viktor-axelsen");
    expect(playerIdCountry("viktor-axelsen")).toBeNull();
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
        team1_player1_country: "CHN",
        team1_player2_country: "CHN",
        team2_player1_country: "INA",
        team2_player2_country: "INA",
        g1_t1: 21,
        g1_t2: 15,
        g2_t1: 21,
        g2_t2: 18,
      }),
    );
    expect(m.disc).toBe("MD");
    expect(m.team1).toEqual(["A One", "A Two"]);
    expect(m.team2Ids).toHaveLength(2);
    expect(m.team1Ids[0]).toBe("a-one--chn");
    expect(m.team2Ids[0]).toBe("b-one--ina");
    expect(m.winner).toBe(1);
    expect(playerWon(m, m.team1Ids[0])).toBe(true);
    expect(playerWon(m, m.team2Ids[0])).toBe(false);
  });

  it("splits two Chen Yus by country", () => {
    const m = mapDbMatch(
      row({
        id: "hy",
        tournament: "2024 Test · MS · Final",
        team1_player1: "Chen Yu",
        team1_player1_country: "CHN",
        team2_player1: "Chen Yu",
        team2_player1_country: "TPE",
        g1_t1: 21,
        g1_t2: 10,
        g2_t1: 21,
        g2_t2: 12,
      }),
    );
    expect(m.team1Ids[0]).toBe("chen-yu--chn");
    expect(m.team2Ids[0]).toBe("chen-yu--tpe");
    expect(m.team1Ids[0]).not.toBe(m.team2Ids[0]);
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

  it("keeps a walkover winner from winner_side when scores are empty", () => {
    const m = mapDbMatch(
      row({
        id: "wo",
        tournament: "2026 Test · MS · R32",
        team1_player1: "Viktor Axelsen",
        team1_player1_country: "DEN",
        team2_player1: "Kodai Naraoka",
        team2_player1_country: "JPN",
        result: "walkover",
        winner_side: 1,
      }),
    );
    expect(m.result).toBe("walkover");
    expect(m.winner).toBe(1);
    expect(m.games).toEqual([]);
    expect(formatScoreLine(m.games, m.result)).toBe("W/O");
    expect(playerWon(m, m.team1Ids[0])).toBe(true);
  });

  it("labels a retirement with the points played", () => {
    expect(
      formatScoreLine([{ t1: 21, t2: 15 }, { t1: 8, t2: 5 }], "retired"),
    ).toBe("21–15, 8–5 ret.");
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
    expect(displayDate(m)).toBe("Date unknown");
  });

  it("falls back to year when matchDate is invalid", () => {
    const m = mapDbMatch(row({ id: "d3" }));
    m.matchDate = "not-a-date";
    m.year = 2025;
    expect(displayDate(m)).toBe("2025 · event year");
  });
});
