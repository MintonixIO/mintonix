import { describe, expect, it } from "vitest";
import { parseYoutubeUrl } from "./youtube";

describe("parseYoutubeUrl", () => {
  it("accepts watch, youtu.be, embed, shorts", () => {
    expect(
      parseYoutubeUrl("https://www.youtube.com/watch?v=abcdefghijk")?.id,
    ).toBe("abcdefghijk");
    expect(parseYoutubeUrl("https://youtu.be/abcdefghijk")?.id).toBe(
      "abcdefghijk",
    );
    expect(
      parseYoutubeUrl("https://www.youtube.com/embed/abcdefghijk")?.id,
    ).toBe("abcdefghijk");
    expect(
      parseYoutubeUrl("https://www.youtube.com/shorts/abcdefghijk")?.id,
    ).toBe("abcdefghijk");
    expect(
      parseYoutubeUrl("https://www.youtube-nocookie.com/embed/abcdefghijk")
        ?.id,
    ).toBe("abcdefghijk");
  });

  it("rejects non-youtube and bad schemes", () => {
    expect(parseYoutubeUrl("javascript:alert(1)")).toBeNull();
    expect(parseYoutubeUrl("https://evil.example/watch?v=abcdefghijk")).toBe(
      null,
    );
    expect(parseYoutubeUrl("https://www.youtube.com/watch?v=short")).toBeNull();
  });

  it("normalizes href to https watch", () => {
    const r = parseYoutubeUrl("http://youtu.be/abcdefghijk");
    expect(r?.href).toBe("https://www.youtube.com/watch?v=abcdefghijk");
  });
});
