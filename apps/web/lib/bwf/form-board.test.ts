import { describe, expect, it } from "vitest";
import {
  buildFormBoard,
  formBoardHref,
  formBoardRowFromRating,
  formBoardRowFromSql,
  mapFormBoardRows,
  splitPairWebId,
} from "./form-board";
import type { FormRating } from "./types";

describe("splitPairWebId", () => {
  it("splits pair web ids at the unique known-id boundary", () => {
    const ids = new Set(["kim-won-ho--kor", "seo-seung-jae--kor"]);
    expect(
      splitPairWebId("kim-won-ho--kor--seo-seung-jae--kor", ids),
    ).toEqual(["kim-won-ho--kor", "seo-seung-jae--kor"]);
  });

  it("splits 2-part slugs with or without a directory", () => {
    expect(
      splitPairWebId("alice--bob", new Set(["alice", "bob"])),
    ).toEqual(["alice", "bob"]);
    expect(splitPairWebId("alice--bob", new Set())).toEqual(["alice", "bob"]);
  });

  it("splits name--cc members when the directory is empty", () => {
    expect(
      splitPairWebId("kim-won-ho--kor--seo-seung-jae--kor", new Set()),
    ).toEqual(["kim-won-ho--kor", "seo-seung-jae--kor"]);
  });

  it("prefers a left-side country suffix on mixed 3-part ids", () => {
    expect(splitPairWebId("alice--den--bob", new Set())).toEqual([
      "alice--den",
      "bob",
    ]);
    expect(splitPairWebId("foo--cc--bar", new Set())).toEqual([
      "foo--cc",
      "bar",
    ]);
  });

  it("known-id cut wins over later fallbacks", () => {
    const web = "player-a--player-b--player-c";
    const known = new Set(["player-a--player-b", "player-c"]);
    expect(splitPairWebId(web, known)).toEqual([
      "player-a--player-b",
      "player-c",
    ]);
    expect(splitPairWebId(web, new Set())).toEqual([
      "player-a",
      "player-b--player-c",
    ]);
    expect(formBoardHref("pair", web, known)).toBe(
      "/bwf/h2h?a=player-a--player-b&a2=player-c",
    );
  });

  it("returns null for a single token", () => {
    expect(splitPairWebId("alice", new Set())).toBeNull();
  });
});

describe("formBoardHref", () => {
  it("encodes pair query params", () => {
    expect(
      formBoardHref("pair", "kim-won-ho--kor--seo-seung-jae--kor", new Set()),
    ).toBe("/bwf/h2h?a=kim-won-ho--kor&a2=seo-seung-jae--kor");
  });

  it("falls back to /bwf/h2h when a pair cannot be split", () => {
    expect(formBoardHref("pair", "alice", new Set())).toBe("/bwf/h2h");
  });

  it("encodes spaces in pair query params", () => {
    expect(formBoardHref("pair", "foo bar--baz", new Set())).toBe(
      "/bwf/h2h?a=foo%20bar&a2=baz",
    );
  });
});

describe("formBoardRowFromSql / mapFormBoardRows", () => {
  const sqlPlayer = {
    web_id: "viktor-axelsen--den",
    discipline: "MS",
    kind: "player",
    mu: 2100,
    rd: 40,
    rank_score: 2020,
    peak_mu: 2150,
    matches: 80,
    display_name: "Viktor Axelsen",
  };

  const sqlPair = {
    web_id: "kim-won-ho--kor--seo-seung-jae--kor",
    discipline: "MD",
    kind: "pair",
    mu: 1900,
    rd: 55,
    rank_score: 1790,
    peak_mu: 1950,
    matches: 40,
    display_name: "Kim / Seo",
  };

  it("maps a player ratings row straight to a form-board row", () => {
    const row = formBoardRowFromSql(sqlPlayer);
    expect(row).toEqual({
      id: "viktor-axelsen--den|MS",
      name: "Viktor Axelsen",
      country: null,
      disc: "MS",
      kind: "player",
      mu: 2100,
      rd: 40,
      rankScore: 2020,
      peakMu: 2150,
      matches: 80,
      href: "/bwf/players/viktor-axelsen--den",
    });
  });

  it("maps a pair row fully including href", () => {
    expect(formBoardRowFromSql(sqlPair)).toEqual({
      id: "kim-won-ho--kor--seo-seung-jae--kor|MD",
      name: "Kim / Seo",
      country: null,
      disc: "MD",
      kind: "pair",
      mu: 1900,
      rd: 55,
      rankScore: 1790,
      peakMu: 1950,
      matches: 40,
      href: "/bwf/h2h?a=kim-won-ho--kor&a2=seo-seung-jae--kor",
    });
  });

  it("maps a 2-part pair slug alice--bob", () => {
    const row = formBoardRowFromSql({
      ...sqlPair,
      web_id: "alice--bob",
      display_name: "Alice / Bob",
    });
    expect(row?.href).toBe("/bwf/h2h?a=alice&a2=bob");
    expect(row?.kind).toBe("pair");
  });

  it("uses web_id when display_name is null", () => {
    const row = formBoardRowFromSql({ ...sqlPlayer, display_name: null });
    expect(row?.name).toBe("viktor-axelsen--den");
  });

  it("skips individual kind, missing/NaN rank, and unknown disc", () => {
    expect(
      formBoardRowFromSql({ ...sqlPlayer, kind: "individual" }),
    ).toBeNull();
    expect(
      formBoardRowFromSql({ ...sqlPlayer, rank_score: null }),
    ).toBeNull();
    expect(
      formBoardRowFromSql({ ...sqlPlayer, rank_score: Number.NaN }),
    ).toBeNull();
    expect(
      formBoardRowFromSql({ ...sqlPlayer, discipline: "XX" }),
    ).toBeNull();
  });

  it("preserves SQL order and drops unmappable rows", () => {
    const rows = mapFormBoardRows([
      sqlPair,
      { ...sqlPlayer, kind: "individual" },
      sqlPlayer,
    ]);
    expect(rows.map((r) => r.name)).toEqual(["Kim / Seo", "Viktor Axelsen"]);
  });
});

describe("formBoardRowFromRating / buildFormBoard", () => {
  const alpha: FormRating = {
    disc: "MS",
    kind: "player",
    mu: 1800,
    rankScore: 1700,
    matches: 40,
    webId: "a",
    name: "Alpha",
  };
  const beta: FormRating = {
    disc: "MS",
    kind: "player",
    mu: 1900,
    rankScore: 1800,
    matches: 30,
    webId: "b",
    name: "Beta",
  };
  const ws: FormRating = {
    disc: "WS",
    kind: "player",
    mu: 1600,
    rankScore: 1500,
    matches: 20,
    webId: "c",
    name: "Carol",
  };

  it("builds form boards sorted by rank score and reports pre-slice total", () => {
    const byKey = new Map([
      ["a|MS", alpha],
      ["b|MS", beta],
    ]);
    const board = buildFormBoard(byKey, new Set(["a", "b"]), { limit: 1 });
    expect(board.rows.map((r) => r.name)).toEqual(["Beta"]);
    expect(board.total).toBe(2);
  });

  it("filters disc and q", () => {
    const byKey = new Map([
      ["a|MS", alpha],
      ["b|MS", beta],
      ["c|WS", ws],
    ]);
    expect(
      buildFormBoard(byKey, new Set(), { disc: "WS" }).rows.map((r) => r.name),
    ).toEqual(["Carol"]);
    expect(
      buildFormBoard(byKey, new Set(), { q: "alp" }).rows.map((r) => r.name),
    ).toEqual(["Alpha"]);
  });

  it("tie-breaks equal rank by matches then name", () => {
    const byKey = new Map<string, FormRating>([
      [
        "z|MS",
        { ...alpha, webId: "z", name: "Zulu", rankScore: 1700, matches: 10 },
      ],
      [
        "a|MS",
        { ...alpha, webId: "a", name: "Alpha", rankScore: 1700, matches: 10 },
      ],
      [
        "m|MS",
        { ...alpha, webId: "m", name: "Mike", rankScore: 1700, matches: 20 },
      ],
    ]);
    expect(buildFormBoard(byKey, new Set()).rows.map((r) => r.name)).toEqual([
      "Mike",
      "Alpha",
      "Zulu",
    ]);
  });

  it("includes pair ratings on the board", () => {
    const pair: FormRating = {
      disc: "MD",
      kind: "pair",
      mu: 1700,
      rankScore: 1600,
      matches: 12,
      webId: "alice--bob",
      name: "Alice / Bob",
    };
    const board = buildFormBoard(new Map([["alice--bob|MD", pair]]), new Set());
    expect(board.rows).toHaveLength(1);
    expect(board.rows[0]?.kind).toBe("pair");
    expect(board.rows[0]?.href).toBe("/bwf/h2h?a=alice&a2=bob");
  });

  it("rejects ratings without a rank score", () => {
    expect(
      formBoardRowFromRating({
        disc: "MS",
        kind: "player",
        mu: 1500,
        matches: 10,
        webId: "x",
      }),
    ).toBeNull();
  });
});
