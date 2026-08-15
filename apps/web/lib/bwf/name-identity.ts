/**
 * Collapse Wikipedia name abbreviations onto a unique full name.
 * "Kim W-h" + KOR → "Kim Won-ho" when that expansion is unique.
 * Never merges two full names or ambiguous homonyms.
 */
import { normalizeCountry, normalizePlayerKey, playerIdFromName } from "./parse";

const VOWELS = new Set("aeiou");

export function splitName(normalized: string): {
  surname: string;
  given: string;
  western: boolean;
} | null {
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length < 2) return null;
  const firstIsInitial = /^[a-z](?:[.\s][a-z])*$/.test(tokens[0] ?? "");
  if (firstIsInitial) {
    return {
      surname: tokens[tokens.length - 1] ?? "",
      given: tokens.slice(0, -1).join(" "),
      western: true,
    };
  }
  return {
    surname: tokens[0] ?? "",
    given: tokens.slice(1).join(" "),
    western: false,
  };
}

/** Hyphen/space initials, or pinyin-ish first-of-each-syllable. */
export function givenInitials(given: string): string {
  const parts = given.split(/[\s.-]+/).filter(Boolean);
  if (parts.length >= 2) return parts.map((p) => p[0] ?? "").join("");
  const w = parts[0] ?? "";
  if (w.length < 2) return w;
  const out = [w[0] ?? ""];
  let i = 1;
  while (i < w.length && !VOWELS.has(w[i] ?? "")) i += 1;
  while (i < w.length && VOWELS.has(w[i] ?? "")) i += 1;
  while (i < w.length) {
    const ch = w[i] ?? "";
    if (!VOWELS.has(ch)) {
      out.push(ch);
      while (i < w.length && !VOWELS.has(w[i] ?? "")) i += 1;
      while (i < w.length && VOWELS.has(w[i] ?? "")) i += 1;
    } else {
      i += 1;
    }
  }
  return out.join("");
}

export function isAbbrevGiven(given: string): boolean {
  if (!given) return false;
  if (/^[a-z](?:[.\s-]+[a-z])+$/.test(given)) return true;
  if (/^[a-z]{2,4}$/.test(given)) {
    const withoutY = given.replace(/y/g, "");
    return withoutY.length > 0 && ![...withoutY].some((c) => VOWELS.has(c));
  }
  return false;
}

function lettersOf(given: string): string {
  return given.replace(/[^a-z]/g, "");
}

function isSubsequence(word: string, initials: string): boolean {
  if (!initials || word[0] !== initials[0]) return false;
  let i = 1;
  for (let j = 1; j < initials.length; j++) {
    const needle = initials[j] ?? "";
    const at = word.indexOf(needle, i);
    if (at < 0) return false;
    i = at + 1;
  }
  return true;
}

function isFullGiven(given: string): boolean {
  return given.split(/[\s-]+/).some((p) => p.length >= 3);
}

export type NameCountry = { name: string; country: string | null };

/**
 * Abbrev key → canonical display name. Only unique expansions.
 * Keyed as `normalizedAbbrev|country`.
 */
export function buildAbbrevCanonicalMap(
  people: NameCountry[],
): Map<string, string> {
  type Row = {
    display: string;
    key: string;
    country: string;
    surname: string;
    given: string;
    initials: string;
    abbrev: boolean;
  };
  const rows: Row[] = [];
  for (const p of people) {
    const key = normalizePlayerKey(p.name);
    const parts = splitName(key);
    if (!key || !parts) continue;
    const country = normalizeCountry(p.country ?? "") || "";
    rows.push({
      display: p.name,
      key,
      country,
      surname: parts.surname,
      given: parts.given,
      initials: givenInitials(parts.given),
      abbrev: isAbbrevGiven(parts.given),
    });
  }

  const fulls = rows.filter((r) => !r.abbrev && isFullGiven(r.given));
  const map = new Map<string, string>();

  for (const abbr of rows.filter((r) => r.abbrev)) {
    const letters = lettersOf(abbr.given);
    if (letters.length < 2) continue;
    const hits = fulls.filter((f) => {
      if (f.surname !== abbr.surname) return false;
      if (abbr.country && f.country && abbr.country !== f.country) return false;
      if (f.initials === letters) return true;
      if (f.given.includes(" ") || f.given.includes("-")) return false;
      return isSubsequence(f.given.replace(/[^a-z]/g, ""), letters);
    });
    const unique = new Set(hits.map((h) => h.key));
    if (unique.size !== 1) continue;
    const canon = hits.reduce((best, h) =>
      h.display.length >= best.display.length ? h : best,
    );
    map.set(`${abbr.key}|${abbr.country}`, canon.display);
    if (!abbr.country && canon.country) {
      map.set(`${abbr.key}|${canon.country}`, canon.display);
    }
  }
  return map;
}

export function canonicalDisplayName(
  name: string,
  country: string | null | undefined,
  map: Map<string, string>,
): string {
  const key = normalizePlayerKey(name);
  if (!key) return name;
  const cc = normalizeCountry(country ?? "");
  return map.get(`${key}|${cc}`) ?? map.get(`${key}|`) ?? name;
}

/** Wikipedia-style short forms of a full name, for resolving old URLs. */
export function abbrevVariants(name: string): string[] {
  const key = normalizePlayerKey(name);
  const parts = splitName(key);
  if (!parts || isAbbrevGiven(parts.given)) return [];
  const initials = givenInitials(parts.given);
  if (initials.length < 2 && !parts.western) return [];
  const out: string[] = [];
  if (parts.western) {
    const letters = lettersOf(parts.given);
    if (letters) out.push(`${letters.split("").join(" ")} ${parts.surname}`);
  } else {
    const spaced = initials.split("").join(" ");
    const hyphen = initials.split("").join("-");
    out.push(`${parts.surname} ${initials}`);
    out.push(`${parts.surname} ${spaced}`);
    out.push(`${parts.surname} ${hyphen}`);
    if (initials.length === 2) {
      out.push(`${parts.surname} ${initials[0]}-${initials[1]}`);
    }
  }
  return out;
}

export function playerIdAliases(
  name: string,
  country: string | null | undefined,
): string[] {
  const ids = new Set<string>();
  const primary = playerIdFromName(name, country);
  if (primary) ids.add(primary);
  for (const v of abbrevVariants(name)) {
    const id = playerIdFromName(v, country);
    if (id) ids.add(id);
  }
  return [...ids];
}