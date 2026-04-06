import { describe, expect, it } from "vitest";
import { entryCodePoints, entryKey } from "../src/types.js";
import type { CharacterEntry } from "../src/types.js";

describe("entryCodePoints", () => {
  it("returns [cp] for single-codepoint entry", () => {
    const entry: CharacterEntry = {
      cp: 0x41,
      name: "LATIN CAPITAL LETTER A",
      keywords: [],
      cat: "Lu",
    };
    expect(entryCodePoints(entry)).toEqual([0x41]);
  });

  it("returns cps when present", () => {
    const entry: CharacterEntry = {
      cp: 0x1f1eb,
      cps: [0x1f1eb, 0x1f1f7],
      name: "FLAG: FRANCE",
      keywords: ["Flags"],
      cat: "So",
    };
    expect(entryCodePoints(entry)).toEqual([0x1f1eb, 0x1f1f7]);
  });
});

describe("entryKey", () => {
  it("returns String(cp) for single-codepoint entry", () => {
    const entry: CharacterEntry = {
      cp: 0x41,
      name: "LATIN CAPITAL LETTER A",
      keywords: [],
      cat: "Lu",
    };
    expect(entryKey(entry)).toBe("0041");
  });

  it("returns dash-joined cps for multi-codepoint entry", () => {
    const entry: CharacterEntry = {
      cp: 0x1f1eb,
      cps: [0x1f1eb, 0x1f1f7],
      name: "FLAG: FRANCE",
      keywords: ["Flags"],
      cat: "So",
    };
    expect(entryKey(entry)).toBe("1F1EB-1F1F7");
  });

  it("produces unique keys for flags with same first codepoint", () => {
    const france: CharacterEntry = {
      cp: 0x1f1eb,
      cps: [0x1f1eb, 0x1f1f7],
      name: "FLAG: FRANCE",
      keywords: [],
      cat: "So",
    };
    const finland: CharacterEntry = {
      cp: 0x1f1eb,
      cps: [0x1f1eb, 0x1f1ee],
      name: "FLAG: FINLAND",
      keywords: [],
      cat: "So",
    };
    expect(entryKey(france)).not.toBe(entryKey(finland));
  });
});
