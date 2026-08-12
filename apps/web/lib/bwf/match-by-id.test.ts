import { describe, expect, it } from "vitest";
import {
  resolveMatchByIdOutcome,
  type SnapshotAttempt,
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

function catalogMatch(id: string): CatalogMatch {
  return {
    id,
    tournamentRaw: "2026 Test Open · MS · Final",
    event: "2026 Test Open",
    year: 2026,
    disc: "MS",
    round: "Final",
    matchDate: "2026-03-01",
    team1: ["Alice"],
    team2: ["Bob"],
    team1Ids: ["alice"],
    team2Ids: ["bob"],
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
  };
}

describe("resolveMatchByIdOutcome", () => {
  it("1. direct hit → mapped match (snapshot unused)", () => {
    const row = dbRow({ id: "m1", team1_player1: "Carol" });
    const result = resolveMatchByIdOutcome(row, null, {
      status: "error",
      error: new Error("snapshot should not matter"),
    });
    expect(result).not.toBeNull();
    expect(result!.id).toBe("m1");
    expect(result!.team1).toEqual(["Carol"]);
    expect(result!.disc).toBe("MS");
  });

  it("2. confirmed miss + snapshot throw → null (true 404, no snapshot)", () => {
    const result = resolveMatchByIdOutcome(null, null, {
      status: "error",
      error: new Error("catalog cache down"),
    });
    expect(result).toBeNull();
  });

  it("2b. confirmed miss + snapshot miss → null", () => {
    expect(
      resolveMatchByIdOutcome(null, null, { status: "miss" }),
    ).toBeNull();
  });

  it("2c. confirmed miss + snapshot hit → still null (no warm recovery on miss)", () => {
    const warm = catalogMatch("warm-1");
    const result = resolveMatchByIdOutcome(null, null, {
      status: "hit",
      match: warm,
    });
    expect(result).toBeNull();
  });

  it("3. direct error + snapshot hit → recovered match", () => {
    const warm = catalogMatch("recovered");
    const result = resolveMatchByIdOutcome(
      null,
      { message: "permission denied" },
      { status: "hit", match: warm },
    );
    expect(result).toBe(warm);
  });

  it("4a. direct error + snapshot miss → rethrow", () => {
    expect(() =>
      resolveMatchByIdOutcome(
        null,
        { message: "timeout" },
        { status: "miss" },
      ),
    ).toThrow(/BWF match load failed: timeout/);
  });

  it("4b. direct error + snapshot throw → rethrow with cause", () => {
    const snapErr = new Error("snapshot boom");
    try {
      resolveMatchByIdOutcome(
        null,
        { message: "jwt expired" },
        { status: "error", error: snapErr },
      );
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toBe("BWF match load failed: jwt expired");
      expect((e as Error).cause).toBe(snapErr);
    }
  });

  it("direct data ignored when directError is set (error path wins)", () => {
    // Defensive: if both somehow present, prefer error recovery rules.
    const row = dbRow({ id: "should-not-use" });
    const warm = catalogMatch("from-snap");
    const result = resolveMatchByIdOutcome(
      row,
      { message: "weird" },
      { status: "hit", match: warm },
    );
    // Implementation: `directData && !directError` fails when error set → error path
    expect(result).toBe(warm);
  });
});

describe("SnapshotAttempt exhaustiveness smoke", () => {
  it("accepts all statuses", () => {
    const attempts: SnapshotAttempt[] = [
      { status: "hit", match: catalogMatch("x") },
      { status: "miss" },
      { status: "error" },
    ];
    expect(attempts).toHaveLength(3);
  });
});
