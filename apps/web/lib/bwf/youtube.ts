/** Allowlisted YouTube hosts for safe href / embed extraction. */
const YT_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

export type YoutubeRef = {
  id: string;
  /** Canonical watch URL safe for <a href>. */
  href: string;
};

function hostOk(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return YT_HOSTS.has(h);
}

/** True when `source_url` is a safe, embeddable YouTube URL. */
export function isAllowlistedYoutubeUrl(
  raw: string | null | undefined,
): boolean {
  return parseYoutubeUrl(raw) != null;
}

/**
 * Parse a catalog `source_url` into a YouTube video id + safe https href.
 * Rejects non-https schemes and non-YouTube hosts (no javascript: phishing).
 */
export function parseYoutubeUrl(
  raw: string | null | undefined,
): YoutubeRef | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  // Normalize to https for links we emit.
  if (!hostOk(url.hostname)) return null;

  const host = url.hostname.toLowerCase();
  let id: string | null = null;

  if (host === "youtu.be" || host === "www.youtu.be") {
    const seg = url.pathname.split("/").filter(Boolean)[0];
    if (seg && /^[\w-]{11}$/.test(seg)) id = seg;
  } else {
    const v = url.searchParams.get("v");
    if (v && /^[\w-]{11}$/.test(v)) id = v;
    if (!id) {
      const parts = url.pathname.split("/").filter(Boolean);
      // /embed/ID, /shorts/ID, /live/ID, /v/ID
      const markers = new Set(["embed", "shorts", "live", "v", "e"]);
      for (let i = 0; i < parts.length - 1; i++) {
        if (markers.has(parts[i]) && /^[\w-]{11}$/.test(parts[i + 1])) {
          id = parts[i + 1];
          break;
        }
      }
    }
  }

  if (!id) return null;
  return {
    id,
    href: `https://www.youtube.com/watch?v=${id}`,
  };
}
