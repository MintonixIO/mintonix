import { describe, expect, it } from "vitest";
import { courtToPct, frameAt, generateMatch, seedFromId } from "./generate";
import {
  advanceMatchT,
  locatePlayhead,
  shotAt,
  shotMatchT,
} from "./playhead";

describe("seedFromId", () => {
  it("is stable and varies by id", () => {
    expect(seedFromId("a")).toBe(seedFromId("a"));
    expect(seedFromId("a")).not.toBe(seedFromId("b"));
  });
});

describe("generateMatch", () => {
  it("is deterministic for a fixed id", () => {
    const a = generateMatch({ id: "fixture-1" });
    const b = generateMatch({ id: "fixture-1" });
    expect(a.rallies.length).toBe(b.rallies.length);
    expect(a.totalDuration).toBe(b.totalDuration);
    expect(a.rallies[0]?.shots[0]?.analysis).toBe(b.rallies[0]?.shots[0]?.analysis);
  });

  it("stops at best-of-3 (at most 3 games, someone reaches 2 wins)", () => {
    const m = generateMatch({ id: "bo3-check" });
    expect(m.setBounds.length).toBeLessThanOrEqual(3);
    expect(m.setBounds.length).toBeGreaterThanOrEqual(2);
    expect(m.meta.sets).toBe(m.setBounds.length);
  });

  it("keeps matchT0 monotonic and leaves real gaps", () => {
    const m = generateMatch({ id: "gaps" });
    for (let i = 0; i < m.rallies.length - 1; i++) {
      const cur = m.rallies[i]!;
      const next = m.rallies[i + 1]!;
      expect(next.matchT0).toBeGreaterThanOrEqual(cur.matchT0 + cur.duration);
    }
  });

  it("aligns last contact with winner for winner/ace ends", () => {
    const m = generateMatch({ id: "winner-align" });
    let checked = 0;
    for (const r of m.rallies) {
      const last = r.shots[r.shots.length - 1];
      if (!last) continue;
      if (
        r.endReason.includes("winner") ||
        r.endReason.includes("kill") ||
        r.endReason.includes("ace")
      ) {
        expect(last.player).toBe(r.winner);
        checked += 1;
      }
      if (r.endReason.includes("error") && !r.endReason.includes("Forced")) {
        // unforced / net error: loser hit last
        expect(last.player).not.toBe(r.winner);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("uses real player names in analysis copy", () => {
    const m = generateMatch({
      id: "names",
      playerA: { name: "Alice Wonder" },
      playerB: { name: "Bob Builder" },
    });
    const text = m.rallies.flatMap((r) => r.shots.map((s) => s.analysis)).join(" ");
    expect(text).toMatch(/Wonder|Builder/);
    expect(text).not.toMatch(/Axelsen|Momota/);
  });

  it("does not invent a YouTube id when youtubeId is null", () => {
    const m = generateMatch({ id: "no-yt", youtubeId: null });
    expect(m.meta.youtubeId).toBeNull();
  });

  it("defaults demo YouTube only when youtubeId is omitted", () => {
    const m = generateMatch({ id: "demo-yt" });
    expect(m.meta.youtubeId).toBeTruthy();
  });

  it("does not tag forced errors as unforced", () => {
    const m = generateMatch({ id: "tags" });
    for (const r of m.rallies) {
      if (r.endReason === "Forced error") {
        expect(r.tags).not.toContain("unforced");
      }
    }
  });
});

describe("frameAt", () => {
  const m = generateMatch({ id: "frame-at" });
  const rally = m.rallies[0]!;

  it("returns first frame for t < 0", () => {
    const f = frameAt(rally, -1);
    expect(f.t).toBe(rally.frames[0]!.t);
  });

  it("returns last frame past end", () => {
    const f = frameAt(rally, rally.duration + 99);
    expect(f.t).toBe(rally.frames[rally.frames.length - 1]!.t);
  });

  it("lands on a known mid shot index", () => {
    const shot = rally.shots[Math.min(2, rally.shots.length - 1)]!;
    const f = frameAt(rally, (shot.t0 + shot.t1) / 2);
    expect(f.shotIndex).toBe(shot.index);
  });
});

describe("courtToPct", () => {
  it("maps center near 50/50", () => {
    const p = courtToPct({ x: 0, y: 0, z: 1 });
    expect(p.left).toBeCloseTo(50, 0);
    expect(p.top).toBeCloseTo(50, 0);
  });
});

describe("locatePlayhead", () => {
  const m = generateMatch({ id: "playhead" });

  it("places inside a rally", () => {
    const r = m.rallies[1]!;
    const loc = locatePlayhead(m, r.matchT0 + r.duration * 0.5);
    expect(loc.phase).toBe("rally");
    expect(loc.rally?.id).toBe(r.id);
    expect(loc.inGap).toBe(false);
    expect(loc.localT).toBeGreaterThan(0);
  });

  it("walks inter-rally gaps without snapping to t=0", () => {
    const r = m.rallies[0]!;
    const next = m.rallies[1]!;
    const gapMid = r.matchT0 + r.duration + (next.matchT0 - r.matchT0 - r.duration) * 0.5;
    expect(gapMid).toBeGreaterThan(r.matchT0 + r.duration);
    const loc = locatePlayhead(m, gapMid);
    expect(loc.inGap).toBe(true);
    expect(loc.rally?.id).toBe(r.id);
    expect(loc.localT).toBe(r.duration);
    expect(loc.phase).toBe("gap");
  });

  it("advanceMatchT crosses gaps", () => {
    const r = m.rallies[0]!;
    const next = m.rallies[1]!;
    let t = r.matchT0 + r.duration - 0.01;
    let crossed = false;
    for (let i = 0; i < 20000; i++) {
      const step = advanceMatchT(m, t, 0.05, m.totalDuration);
      t = step.matchT;
      const loc = locatePlayhead(m, t);
      if (loc.rally?.id === next.id && !loc.inGap) {
        crossed = true;
        break;
      }
      if (step.stop) break;
    }
    expect(crossed).toBe(true);
  });

  it("shotAt and shotMatchT agree", () => {
    const r = m.rallies[0]!;
    const s = r.shots[0]!;
    expect(shotAt(r, s.t0 + 0.01)?.id).toBe(s.id);
    expect(shotMatchT(r, s)).toBeCloseTo(r.matchT0 + s.t0, 5);
  });
});
