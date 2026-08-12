import { describe, expect, it } from "vitest";
import { playerImageUrl, teamInitials } from "./player-image";

describe("playerImageUrl", () => {
  it("returns null without overrides", () => {
    expect(playerImageUrl("viktor-axelsen", "Viktor Axelsen")).toBeNull();
  });
});

describe("teamInitials", () => {
  it("handles singles and doubles", () => {
    expect(teamInitials(["Viktor Axelsen"])).toBe("VA");
    // Doubles uses last-token initial per player
    expect(teamInitials(["Chen Qingchen", "Jia Yifan"])).toBe("QY");
    expect(teamInitials([])).toBe("?");
  });
});
