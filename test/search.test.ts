// SPDX-FileCopyrightText: Copyright © 2026 Michael Shields
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { characters } from "../src/characters.js";
import {
  boundedEditDistance,
  scoreMatch,
  searchCharacters,
} from "../src/search.js";
import type { CharacterEntry } from "../src/types.js";

describe("search", () => {
  it("returns results for broad queries", () => {
    for (const query of ["letter e", "arrow", "oi", "hundred", "face"]) {
      const results = searchCharacters(characters, query);
      expect(results.length).toBeGreaterThan(0);
    }
  });

  it("respects MAX_RESULTS limit", () => {
    const results = searchCharacters(characters, "a");
    expect(results.length).toBeLessThanOrEqual(200);
  });

  it("returns initial slice for empty query", () => {
    const results = searchCharacters(characters, "");
    expect(results.length).toBeLessThanOrEqual(200);
    expect(results.length).toBeGreaterThan(0);
  });

  it("finds flags by country name", () => {
    const results = searchCharacters(characters, "flag france");
    const names = results.map((r) => r.name);
    expect(names).toContain("FLAG: FRANCE");
  });

  it("finds keycap entries", () => {
    const results = searchCharacters(characters, "keycap 1");
    const names = results.map((r) => r.name);
    expect(names).toContain("KEYCAP: 1");
  });

  it("finds teacher/man teacher/woman teacher", () => {
    const results = searchCharacters(characters, "teacher");
    const names = results.map((r) => r.name);
    expect(names).toContain("TEACHER");
    expect(names).toContain("MAN TEACHER");
    expect(names).toContain("WOMAN TEACHER");
  });

  it("finds multi-codepoint entries by hex of any codepoint", () => {
    // France flag: 1F1EB 1F1F7 — search by second codepoint hex
    const results = searchCharacters(characters, "1f1f7");
    const names = results.map((r) => r.name);
    const hasFlag = names.some((n) => n.startsWith("FLAG:"));
    expect(hasFlag).toBe(true);
  });

  it("tokenizes hyphenated queries like spaced ones", () => {
    const hyphen = searchCharacters(characters, "left-arrow").map(
      (r) => r.name,
    );
    const spaced = searchCharacters(characters, "left arrow").map(
      (r) => r.name,
    );
    expect(hyphen).toEqual(spaced);
    expect(hyphen.length).toBeGreaterThan(0);
  });

  it("finds a character by its literal value, including non-ASCII", () => {
    // Pasting a character to identify it must work (exact-character tier),
    // including accented letters, symbols, Greek, and a bare hyphen (which is
    // otherwise a token separator).
    for (const q of ["é", "π", "→", "©", "-"]) {
      const chars = searchCharacters(characters, q).map((r) =>
        String.fromCodePoint(...(r.cps ?? [r.cp])),
      );
      expect(chars).toContain(q);
    }
  });

  it("strips trailing punctuation from query terms like name words", () => {
    // Typing the colon from the displayed name "FLAG: FRANCE" must tokenize the
    // same as without it, so the two queries rank identically.
    const withColon = searchCharacters(characters, "flag:").map((r) => r.name);
    const without = searchCharacters(characters, "flag").map((r) => r.name);
    expect(withColon).toEqual(without);
  });

  it("ranks the canonical LEFTWARDS ARROW first for 'left arrow'", () => {
    // "LEFTWARDS ARROW" (←) is fully covered by the query and far more popular,
    // so it must beat the many "LEFT … ARROW" compounds where "left" is a whole
    // word but the name is only partly covered; "LEFT RIGHT ARROW" (↔) is the
    // next-best match and follows immediately.
    const names = searchCharacters(characters, "left arrow").map((r) => r.name);
    expect(names[0]).toBe("LEFTWARDS ARROW");
    expect(names[1]).toBe("LEFT RIGHT ARROW");
  });

  it("ranks the Latin letters first for 'letter a', lowercase before upper", () => {
    // Regression: the single-letter term "a" inflated name coverage for every
    // obscure "<script> LETTER A" (its first word starts with "a"), burying the
    // common Latin letters past MAX_RESULTS. The exact-character signal now
    // surfaces them, and lowercase outranks its uppercase pair.
    const names = searchCharacters(characters, "letter a").map((r) => r.name);
    expect(names[0]).toBe("LATIN SMALL LETTER A");
    expect(names[1]).toBe("LATIN CAPITAL LETTER A");
  });

  it("tolerates a transposed typo ('letf' for 'left')", () => {
    const names = searchCharacters(characters, "letf arrow").map((r) => r.name);
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain("LEFTWARDS ARROW");
  });
});

describe("searchCharacters ordering signals", () => {
  const latinA: CharacterEntry = {
    cp: 0x61,
    name: "LATIN SMALL LETTER A",
    keywords: [],
    cat: "Ll",
  };
  // An obscure same-tier letter whose 3-word name has *higher* coverage for
  // these queries than the 4-word Latin name (fewer uncovered words), and which
  // is never keyboard-typeable.
  const avestanA: CharacterEntry = {
    cp: 0x10b00,
    name: "AVESTAN LETTER A",
    keywords: [],
    cat: "Lo",
  };

  it("ranks an exact-character term match above a higher-coverage name", () => {
    // For "letter a" the term "a" *is* U+0061, so it must beat AVESTAN LETTER A
    // even though every word of that name is covered (coverage 1 vs 0.5).
    const names = searchCharacters([avestanA, latinA], "letter a").map(
      (r) => r.name,
    );
    expect(names[0]).toBe("LATIN SMALL LETTER A");
  });

  it("ranks a keyboard-typeable character above a higher-coverage name", () => {
    // "letter" matches both by exact word and neither by character, so coverage
    // alone puts the shorter AVESTAN name first; marking the Latin letter
    // typeable must override that.
    const query = "letter";
    const withoutKey = searchCharacters([avestanA, latinA], query).map(
      (r) => r.name,
    );
    expect(withoutKey[0]).toBe("AVESTAN LETTER A");

    const withKey = searchCharacters(
      [avestanA, latinA],
      query,
      new Set([latinA.cp]),
    ).map((r) => r.name);
    expect(withKey[0]).toBe("LATIN SMALL LETTER A");
  });
});

describe("scoreMatch fuzzy tier", () => {
  const arrow: CharacterEntry = {
    cp: 0x2190,
    name: "LEFTWARDS ARROW",
    keywords: [],
    cat: "Sm",
  };

  it("scores the fuzzy tier for a transposed typo of a name word stem", () => {
    // "letf" is one transposition from "left", the stem of "LEFTWARDS".
    expect(scoreMatch(arrow, ["letf"])).toBe(10);
  });

  it("keeps exact and prefix tiers above the fuzzy tier", () => {
    expect(scoreMatch(arrow, ["arrow"])).toBe(80);
    expect(scoreMatch(arrow, ["left"])).toBe(60);
  });

  it("does not fuzzy-match terms shorter than four characters", () => {
    // "lft" is one insertion from "left" but too short to match fuzzily.
    expect(scoreMatch(arrow, ["lft"])).toBe(0);
  });
});

describe("scoreMatch with multi-codepoint entries", () => {
  const flagEntry: CharacterEntry = {
    cp: 0x1f1eb,
    cps: [0x1f1eb, 0x1f1f7],
    name: "FLAG: FRANCE",
    keywords: ["Flags", "country-flag", "FR"],
    cat: "So",
  };

  it("scores 80 for exact name word match", () => {
    expect(scoreMatch(flagEntry, ["france"])).toBe(80);
  });

  it("scores 40 for keyword-only match", () => {
    // "country" starts a keyword word but not a name word
    expect(scoreMatch(flagEntry, ["country"])).toBe(40);
  });

  it("scores 20 for a hex code point match on any codepoint", () => {
    // Second code point 1F1F7 is matched only via hex, not name/keywords
    expect(scoreMatch(flagEntry, ["1f1f7"])).toBe(20);
  });

  it("returns 0 for no terms", () => {
    expect(scoreMatch(flagEntry, [])).toBe(0);
  });

  it("matches a name word despite trailing punctuation", () => {
    // "FLAG: FRANCE" tokenizes to ["flag", "france"], so "flag" is an exact
    // word match (tier 80), not merely a startsWith of "flag:" (tier 60).
    expect(scoreMatch(flagEntry, ["flag"])).toBe(80);
  });
});

describe("boundedEditDistance", () => {
  it("returns the other length when one operand is empty", () => {
    // The cap is high enough to reach the empty-operand fast paths rather than
    // bailing out on the length-difference check.
    expect(boundedEditDistance("", "abc", 5)).toBe(3);
    expect(boundedEditDistance("abc", "", 5)).toBe(3);
  });

  it("returns 0 for identical strings", () => {
    expect(boundedEditDistance("left", "left", 1)).toBe(0);
  });

  it("counts a single adjacent transposition as one edit", () => {
    expect(boundedEditDistance("letf", "left", 1)).toBe(1);
  });

  it("returns cap + 1 once the distance is known to exceed the cap", () => {
    expect(boundedEditDistance("abcd", "wxyz", 1)).toBe(2);
  });
});

describe("searchCharacters name-coverage edge case", () => {
  it("matches an entry whose name has no word tokens via its keywords", () => {
    // "—" tokenizes to nothing, so the entry can only match by keyword and its
    // name coverage is 0 (there are no name words to cover).
    const entry: CharacterEntry = {
      cp: 0x2014,
      name: "—",
      keywords: ["emdash"],
      cat: "Pd",
    };
    expect(searchCharacters([entry], "emdash")).toEqual([entry]);
  });
});
