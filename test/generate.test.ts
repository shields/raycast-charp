import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { entryKey } from "../src/types.js";
import type { CharacterEntry, EmojiVariant } from "../src/types.js";

const CHAR_PATH = join(import.meta.dirname, "..", "src", "characters.json");
const VARIANT_PATH = join(import.meta.dirname, "..", "src", "variants.json");

const characters: CharacterEntry[] = JSON.parse(
  readFileSync(CHAR_PATH, "utf-8"),
) as CharacterEntry[];

const variants: Record<string, EmojiVariant[]> = JSON.parse(
  readFileSync(VARIANT_PATH, "utf-8"),
) as Record<string, EmojiVariant[]>;

const sequenceEntries = characters.filter(
  (e): e is CharacterEntry & { cps: number[] } => e.cps !== undefined,
);

describe("generated characters.json", () => {
  it("contains flag entries", () => {
    const flags = sequenceEntries.filter((e) => e.name.startsWith("FLAG:"));
    expect(flags.length).toBeGreaterThanOrEqual(250);
  });

  it("contains keycap entries", () => {
    const keycaps = sequenceEntries.filter((e) => e.name.startsWith("KEYCAP:"));
    expect(keycaps.length).toBe(12);
  });

  it("contains ZWJ standalone entries", () => {
    const zwj = sequenceEntries.filter(
      (e) => !e.name.startsWith("FLAG:") && !e.name.startsWith("KEYCAP:"),
    );
    expect(zwj.length).toBeGreaterThan(100);
  });

  it("flag entries have correct cps (regional indicator pairs)", () => {
    const france = sequenceEntries.find((e) => e.name === "FLAG: FRANCE");
    expect(france).toBeDefined();
    expect(france!.cps).toEqual([0x1f1eb, 0x1f1f7]);
    expect(france!.cp).toBe(0x1f1eb);
  });

  it("keycap entries have correct cps (digit + FE0F + 20E3)", () => {
    const keycap1 = sequenceEntries.find((e) => e.name === "KEYCAP: 1");
    expect(keycap1).toBeDefined();
    expect(keycap1!.cps).toEqual([0x31, 0xfe0f, 0x20e3]);
  });

  it("ZWJ entries like teacher have correct cps", () => {
    const teacher = sequenceEntries.find((e) => e.name === "TEACHER");
    expect(teacher).toBeDefined();
    expect(teacher!.cps).toEqual([0x1f9d1, 0x200d, 0x1f3eb]);
  });

  it("all sequence entries have cat So", () => {
    for (const entry of sequenceEntries) {
      expect(entry.cat).toBe("So");
    }
  });

  it("all sequence entries have non-empty keywords", () => {
    for (const entry of sequenceEntries) {
      expect(entry.keywords.length).toBeGreaterThan(0);
    }
  });

  it("country flag entries include ISO 2-letter code in keywords", () => {
    const france = sequenceEntries.find((e) => e.name === "FLAG: FRANCE");
    expect(france!.keywords).toContain("FR");
  });

  it("has reasonable total entry count", () => {
    expect(characters.length).toBeGreaterThan(55000);
    expect(characters.length).toBeLessThan(62000);
  });

  it("excludes CJK Unified Ideographs", () => {
    const cjk = characters.filter((e) => e.name.startsWith("<CJK Ideograph"));
    expect(cjk).toEqual([]);
  });

  it("does not include VS16-only pairs as sequence entries", () => {
    const vs16Only = sequenceEntries.filter(
      (e) => e.cps.length === 2 && e.cps[1] === 0xfe0f,
    );
    expect(vs16Only).toEqual([]);
  });
});

describe("generated variants.json", () => {
  it("has variant groups", () => {
    expect(Object.keys(variants).length).toBeGreaterThan(100);
  });

  it("waving hand (U+1F44B) has exactly 5 skin tone variants", () => {
    const wavingKey = entryKey({ cp: 0x1f44b });
    const wavingVariants = variants[wavingKey];
    expect(wavingVariants).toBeDefined();
    expect(wavingVariants!.length).toBe(5);
  });

  it("variant labels match expected skin tone pattern", () => {
    const wavingKey = entryKey({ cp: 0x1f44b });
    const labels = variants[wavingKey]!.map((v) => v.label);
    expect(labels).toContain("light skin tone");
    expect(labels).toContain("dark skin tone");
  });

  it("variant cps include the skin tone modifier", () => {
    const wavingKey = entryKey({ cp: 0x1f44b });
    for (const v of variants[wavingKey]!) {
      const hasSkinTone = v.cps.some((cp) => cp >= 0x1f3fb && cp <= 0x1f3ff);
      expect(hasSkinTone).toBe(true);
    }
  });

  it("all variant groups are reachable via entryKey", () => {
    const allEntryKeys = new Set(characters.map((c) => entryKey(c)));
    const orphans = Object.keys(variants).filter((k) => !allEntryKeys.has(k));
    expect(orphans).toEqual([]);
  });

  it("ZWJ base entries have variants reachable via entryKey", () => {
    const teacher = sequenceEntries.find((e) => e.name === "TEACHER");
    expect(teacher).toBeDefined();
    const key = entryKey(teacher!);
    const teacherVariants = variants[key];
    expect(teacherVariants).toBeDefined();
    expect(teacherVariants!.length).toBe(5);
  });

  it("does not have duplicate variant groups for same base", () => {
    const keys = Object.keys(variants);
    const uniqueKeys = new Set(keys);
    expect(keys.length).toBe(uniqueKeys.size);
  });
});
