import { describe, expect, it } from "vitest";
import { characters } from "../src/characters.js";
import { searchCharacters } from "../src/search.js";

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
});
