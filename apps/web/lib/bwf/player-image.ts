import { cleanPlayerName } from "./parse";

/**
 * Player profile images.
 *
 * The Supabase `matches` catalog has no avatar/headshot column and no players
 * table. Workers only store roster names + optional YouTube `source_url`.
 *
 * Strategy (best available, no external API keys):
 * 1. If a future enrichment map provides a URL, use it.
 * 2. Otherwise return null and let `<Avatar name=…>` render a deterministic
 *    initials + gradient (existing design system).
 *
 * We deliberately do **not** hotlink BWF tournament CDN or scrape Wikimedia
 * at request time (fragile URLs, ToS, layout shift). A static seed map can be
 * grown later under `PLAYER_IMAGE_OVERRIDES`.
 */

/** Optional hand-curated overrides: playerId → absolute image URL. */
export const PLAYER_IMAGE_OVERRIDES: Record<string, string> = {
  // Example:
  // "viktor-axelsen": "https://…",
};

export function playerImageUrl(
  playerId: string,
  name?: string,
): string | null {
  if (PLAYER_IMAGE_OVERRIDES[playerId]) return PLAYER_IMAGE_OVERRIDES[playerId];
  // Reserved for future: name-based CDN once we have a licensed source.
  void name;
  return null;
}

/** Initials for doubles teams ("Chen / Jia" → "CJ"). */
export function teamInitials(names: string[]): string {
  if (!names.length) return "?";
  if (names.length === 1) {
    const parts = cleanPlayerName(names[0]).split(/\s+/);
    return (
      ((parts[0]?.[0] || "") + (parts[parts.length - 1]?.[0] || "")).toUpperCase() ||
      "?"
    );
  }
  return names
    .map((n) => cleanPlayerName(n).split(/\s+/).pop()?.[0] || "")
    .join("")
    .toUpperCase()
    .slice(0, 3);
}
