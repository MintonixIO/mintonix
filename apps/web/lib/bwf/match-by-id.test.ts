import { describe, expect, it } from "vitest";
import {
  isMissingColumnError,
  resolveMatchByIdOutcome,
} from "./match-by-id";
import type { CatalogMatch } from "./types";
import type { DbMatchRow } from "./parse";

function dbRow(partial: Partial<DbMatchRow> & { id: string }): DbMatchRow {
  return {
    tournament: "2026 Test Open · MS · Final",
    match_date: "2026-03-01",
    team1_player1: "Alice",
    team1_player2: null,
    team2_player1: "Bob",
    team2_player2: null,
    g1_t1: 21,
    g1_t2: 10,
    g2_t1: 21,
    g2_t2: 12,
    g3_t1: null,
    g3_t2: null,
    status: "pending",
    source_url: null,
    duration_sec: null,
    created_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

describe("isMissingColumnError", () => {
  it("detects PostgREST missing-column messages", () => {
    expect(
      isMissingColumnError("column matches.result does not exist"),
    ).toBe(true);
    expect(
      isMissingColumnError(
        "Could not find the 'winner_side' column of 'matches' in the schema cache",
      ),
    ).toBe(true);
    expect(isMissingColumnError("permission denied")).toBe(false);
    expect(isMissingColumnError("timeout")).toBe(false);
  });
});

describe("resolveMatchByIdOutcome", () => {
  it("direct hit → mapped match", () => {
    const row = dbRow({ id: "m1", team1_player1: "Carol" });
    const result = resolveMatchByIdOutcome(row, null);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("m1");
    expect(result!.team1).toEqual(["Carol"]);
    expect(result!.disc).toBe("MS");
  });

  it("confirmed miss → null", () => {
    expect(resolveMatchByIdOutcome(null, null)).toBeNull();
  });

  it("direct error → throw (fail closed, no snapshot)", () => {
    expect(() =>
      resolveMatchByIdOutcome(null, { message: "timeout" }),
    ).toThrow(/BWF match load failed: timeout/);
    expect(() =>
      resolveMatchByIdOutcome(null, {
        message: "column matches.result does not exist",
      }),
    ).toThrow(/does not exist/);
  });

  it("direct error wins even if a row is present", () => {
    const row = dbRow({ id: "should-not-use" });
    expect(() =>
      resolveMatchByIdOutcome(row, { message: "weird" }),
    ).toThrow(/BWF match load failed: weird/);
  });
});

describe("CatalogMatch smoke", () => {
  it("maps a row into the catalog shape", () => {
    const m: CatalogMatch = resolveMatchByIdOutcome(dbRow({ id: "x" }), null)!;
    expect(m.id).toBe("x");
  });
});
