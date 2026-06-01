// SPDX-FileCopyrightText: Copyright © 2026 Michael Shields
// SPDX-License-Identifier: MIT

import type { CharacterEntry } from "./types.js";

export const MAX_RESULTS = 200;

// Fuzzy matching only applies to terms of at least this length (so short terms
// like "to" or "arr" don't match a flood of near-neighbours) and tolerates at
// most this edit distance.
const FUZZY_MIN_TERM_LEN = 4;
const FUZZY_MAX_DISTANCE = 1;
const FUZZY_TIER = 10;

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
 * Damerau–Levenshtein (optimal string alignment) distance, capped: returns
 * `cap + 1` as soon as the distance is known to exceed `cap`, so callers can
 * test `<= cap` cheaply without computing the exact distance. Counts a single
 * adjacent transposition as one edit, so "letf" is distance 1 from "left".
 */
export function boundedEditDistance(a: string, b: string, cap: number): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > cap) return cap + 1;
  if (m === 0) return n;
  if (n === 0) return m;

  const d: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) d[i]![0] = i;
  for (let j = 0; j <= n; j++) d[0]![j] = j;

  for (let i = 1; i <= m; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, d[i - 2]![j - 2]! + 1);
      }
      d[i]![j] = best;
      if (best < rowMin) rowMin = best;
    }
    if (rowMin > cap) return cap + 1;
  }

  return d[m]![n]!;
}

/**
 * Whether `term` is a typo of `word` or of a leading prefix of it. The prefix
 * check lets a mistyped term reach a longer word the same way an exact prefix
 * would — "letf" hits the "left" stem of "LEFTWARDS" — mirroring the prefix
 * tier for correctly spelled terms. Only names are matched fuzzily, not
 * keywords, to keep the fallback tight.
 */
function fuzzyMatch(word: string, term: string): boolean {
  if (term.length < FUZZY_MIN_TERM_LEN) return false;
  if (
    boundedEditDistance(term, word, FUZZY_MAX_DISTANCE) <= FUZZY_MAX_DISTANCE
  ) {
    return true;
  }
  // Compare the term against prefixes of a longer word sized to the term (and
  // one shorter or longer, to tolerate an inserted or dropped character) so a
  // typo of a word's stem still matches.
  for (const len of [term.length - 1, term.length, term.length + 1]) {
    if (
      len < word.length &&
      boundedEditDistance(term, word.slice(0, len), FUZZY_MAX_DISTANCE) <=
        FUZZY_MAX_DISTANCE
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Fraction of the entry's name words covered by some query term (0..1), by
 * exact or prefix match. Fuzzy matches are deliberately excluded so the
 * typo-tolerant fallback can't inflate coverage — e.g. "left" must not be
 * credited for the "letter" in "MODIFIER LETTER LEFT ARROWHEAD" (its stem
 * "lett" is one edit from "left"). A tighter match — more of the name consumed
 * by the query — ranks higher within a score tier, so "LEFTWARDS ARROW" (both
 * words matched by "left arrow") outranks "LEFT RIGHT ARROW" (the unmatched
 * "right" remains).
 */
function nameCoverage(nameWords: string[], terms: string[]): number {
  if (nameWords.length === 0) return 0;
  let matched = 0;
  for (const w of nameWords) {
    if (terms.some((t) => w.startsWith(t))) matched++;
  }
  return matched / nameWords.length;
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
 *    10 — fuzzy (typo-tolerant) match of a name word; fallback only, for terms
 *         of at least FUZZY_MIN_TERM_LEN characters
 *
 * Final score = minimum term score (weakest link), so all terms must match.
 *
 * `nameWords` is passed in so callers that already tokenized the name (the
 * search loop also needs them for coverage) don't pay for it twice. `allowFuzzy`
 * gates the typo-tolerant tier, which the search runs only as a fallback so it
 * isn't paid on every keystroke.
 */
function scoreEntry(
  entry: CharacterEntry,
  nameWords: string[],
  terms: string[],
  allowFuzzy: boolean,
): number {
  if (terms.length === 0) return 0;

  const cps = entry.cps;
  const char = cps
    ? String.fromCodePoint(...cps)
    : String.fromCodePoint(entry.cp);
  const hexValues = cps
    ? cps.map((cp) => cp.toString(16).padStart(4, "0"))
    : [entry.cp.toString(16).padStart(4, "0")];
  const nameLower = entry.name.toLowerCase();

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
    if (termScore < 20 && nameLower.includes(term)) {
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

    // Fuzzy name-word match — typo-tolerant fallback, only when nothing above
    // matched, so correctly spelled queries never reach it.
    if (
      allowFuzzy &&
      termScore === 0 &&
      nameWords.some((w) => fuzzyMatch(w, term))
    ) {
      termScore = FUZZY_TIER;
    }

    if (termScore === 0) return 0;
    minScore = Math.min(minScore, termScore);
  }

  return minScore;
}

/** Score an entry against the query terms, including the fuzzy fallback tier. */
export function scoreMatch(entry: CharacterEntry, terms: string[]): number {
  return scoreEntry(entry, words(entry.name), terms, true);
}

/** Group a term score into an ordering bucket (lower = better). The exact-word
 * (80) and prefix-word (60) name tiers share a bucket so a canonical prefix
 * match ("left" → "LEFTWARDS") competes with exact-word matches on coverage and
 * popularity instead of losing a whole tier; fuzzy matches sit below all else. */
function scoreBucket(score: number): number {
  if (score >= 100) return 0;
  if (score >= 60) return 1;
  if (score >= 40) return 2;
  if (score >= 20) return 3;
  return 4;
}

interface ScoredEntry {
  entry: CharacterEntry;
  bucket: number;
  coverage: number;
  score: number;
  rank: number;
}

/** Score every entry against the terms, keeping the matches. Tokenizes each
 * name once and reuses it for both scoring and coverage. */
function collectMatches(
  ranked: CharacterEntry[],
  terms: string[],
  allowFuzzy: boolean,
): ScoredEntry[] {
  const scored: ScoredEntry[] = [];
  let rank = 0;
  for (const entry of ranked) {
    const nameWords = words(entry.name);
    const score = scoreEntry(entry, nameWords, terms, allowFuzzy);
    if (score > 0) {
      scored.push({
        entry,
        bucket: scoreBucket(score),
        coverage: nameCoverage(nameWords, terms),
        score,
        rank,
      });
    }
    rank++;
  }
  return scored;
}

/**
 * Search characters by query string. Returns up to MAX_RESULTS entries ordered
 * by score bucket, then by how completely the query covers each entry's name,
 * then exact-over-prefix, then by input rank (popularity / recency).
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

  // Strict pass first; the typo-tolerant fuzzy fallback runs only when it finds
  // nothing, so well-spelled queries never pay for edit-distance scoring across
  // the whole corpus on every keystroke. Skip the fallback unless some term is
  // long enough to fuzzy-match — otherwise it would just re-scan the corpus to
  // reproduce the strict pass's empty result. The fallback re-tokenizes rather
  // than caching the strict pass's tokens: caching would pin a token array for
  // every one of ~51k entries on every keystroke purely to speed up this rare
  // no-match path, a poor trade against the hot path.
  let scored = collectMatches(ranked, terms, false);
  if (
    scored.length === 0 &&
    terms.some((term) => term.length >= FUZZY_MIN_TERM_LEN)
  ) {
    scored = collectMatches(ranked, terms, true);
  }

  scored.sort(
    (a, b) =>
      a.bucket - b.bucket ||
      b.coverage - a.coverage ||
      b.score - a.score ||
      a.rank - b.rank,
  );

  return scored.slice(0, MAX_RESULTS).map((s) => s.entry);
}
