import { describe, expect, it } from "vitest";
import { characters } from "../src/characters.js";
import { scoreMatch, searchCharacters } from "../src/search.js";
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
});
