// SPDX-FileCopyrightText: Copyright © 2026 Michael Shields
// SPDX-License-Identifier: MIT

import type { CharacterEntry } from "./types.js";

export const MAX_RESULTS = 200;

/**
 * Split a query, name, or keyword into lowercase word tokens so the query and
 * the names/keywords it matches against tokenize identically. Hyphens are word
 * separators (so "left-arrow" matches the words of "LEFTWARDS ARROW") and
 * leading/trailing punctuation is stripped (so "FLAG:" yields the word "flag");
 * letters and digits, including non-ASCII, are preserved.
 */
function words(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[\s-]+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((w) => w.length > 0);
}

/**
 * Score how well an entry matches the query terms. Higher = better match.
 * Returns 0 when there are no terms or any term fails to match.
 *
 * Scoring tiers:
 *   100 — the character itself equals a term
 *    80 — a name word exactly equals a term
 *    60 — a name word starts with a term
 *    40 — a keyword word starts with a term
 *    20 — substring match in name or keywords, or a code point hex contains a
 *         term
 *
 * Final score = minimum term score (weakest link), so all terms must match.
 */
export function scoreMatch(entry: CharacterEntry, terms: string[]): number {
  if (terms.length === 0) return 0;

  const nameWords = words(entry.name);
  const cps = entry.cps;
  const char = cps
    ? String.fromCodePoint(...cps)
    : String.fromCodePoint(entry.cp);
  const hexValues = cps
    ? cps.map((cp) => cp.toString(16).padStart(4, "0"))
    : [entry.cp.toString(16).padStart(4, "0")];

  let minScore = Infinity;

  for (const term of terms) {
    let termScore = 0;

    // Exact character match
    if (char.toLowerCase() === term) {
      termScore = 100;
    }

    // Exact name word match
    if (termScore < 80 && nameWords.includes(term)) {
      termScore = 80;
    }

    // Name word starts with term
    if (termScore < 60 && nameWords.some((w) => w.startsWith(term))) {
      termScore = 60;
    }

    // Keyword word starts with term
    if (
      termScore < 40 &&
      entry.keywords.some((kw) => words(kw).some((w) => w.startsWith(term)))
    ) {
      termScore = 40;
    }

    // Substring match in name
    if (termScore < 20 && entry.name.toLowerCase().includes(term)) {
      termScore = 20;
    }

    // Substring match in keywords
    if (
      termScore < 20 &&
      entry.keywords.some((kw) => kw.toLowerCase().includes(term))
    ) {
      termScore = 20;
    }

    // Hex code point match (any code point in sequence)
    if (termScore < 20 && hexValues.some((h) => h.includes(term))) {
      termScore = 20;
    }

    if (termScore === 0) return 0;
    minScore = Math.min(minScore, termScore);
  }

  return minScore;
}

/**
 * Search characters by query string. Returns up to MAX_RESULTS entries,
 * ordered by score bucket (preserving input rank within each bucket).
 */
export function searchCharacters(
  ranked: CharacterEntry[],
  query: string,
): CharacterEntry[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === "") {
    return ranked.slice(0, MAX_RESULTS);
  }

  // Tokenize the query the same way as names so they match symmetrically. A
  // query made only of symbols/punctuation (e.g. "→", "©", "-") tokenizes to
  // nothing, so fall back to the raw query to match it by exact character.
  const tokens = words(query);
  const terms = tokens.length > 0 ? tokens : [trimmed];
  const buckets: CharacterEntry[][] = [[], [], [], [], []];
  const tierIndex = (s: number) =>
    s >= 100 ? 0 : s >= 80 ? 1 : s >= 60 ? 2 : s >= 40 ? 3 : 4;

  for (const entry of ranked) {
    const score = scoreMatch(entry, terms);
    if (score > 0) {
      buckets[tierIndex(score)]!.push(entry);
    }
  }

  const results: CharacterEntry[] = [];
  for (const bucket of buckets) {
    for (const entry of bucket) {
      results.push(entry);
      if (results.length >= MAX_RESULTS) return results;
    }
  }
  return results;
}
