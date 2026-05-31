// SPDX-FileCopyrightText: Copyright © 2026 Michael Shields
// SPDX-License-Identifier: MIT

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { entryKey } from "../src/types.js";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(PROJECT_ROOT, "data");
const SRC_DIR = join(PROJECT_ROOT, "src");

const UNICODE_VERSION = "17.0.0";
// Emoji 17.0 is only under "latest" as of 2026-04; use 16.0 for a stable URL
const EMOJI_VERSION = "16.0";
const UCD_BASE = `https://unicode.org/Public/${UNICODE_VERSION}/ucd`;
const EMOJI_BASE = `https://unicode.org/Public/emoji/${EMOJI_VERSION}`;

const SOURCES: Record<string, string> = {
  "UnicodeData.txt": `${UCD_BASE}/UnicodeData.txt`,
  "NameAliases.txt": `${UCD_BASE}/NameAliases.txt`,
  "Blocks.txt": `${UCD_BASE}/Blocks.txt`,
  "emoji-test.txt": `${EMOJI_BASE}/emoji-test.txt`,
  "emoji-variation-sequences.txt": `${UCD_BASE}/emoji/emoji-variation-sequences.txt`,
};

// CJK Unified and Tangut ideographs are allocated as First/Last ranges with
// placeholder "<...>" names; Tangut additionally has individually-named
// "TANGUT COMPONENT-NNN" entries. All are excluded: they are too numerous and
// their placeholder names carry no search value in a picker. Detecting them by
// name keeps this in sync with the UCD automatically; a hardcoded numeric table
// drifts out of date every Unicode version as new blocks are added.
const EXCLUDED_RANGE_NAME = /^<(CJK|Tangut) Ideograph/;
const EXCLUDED_NAME = /^TANGUT COMPONENT-/;

// Categories to skip: surrogates and private use.
const SKIP_CATEGORIES = new Set(["Cs", "Co"]);

async function download(name: string, url: string): Promise<string> {
  const path = join(DATA_DIR, name);
  if (existsSync(path)) {
    console.log(`  cached: ${name}`);
    return readFileSync(path, "utf-8");
  }
  console.log(`  downloading: ${name}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const text = await res.text();
  writeFileSync(path, text);
  return text;
}

interface RawChar {
  cp: number;
  name: string;
  cat: string;
  oldName: string;
}

function parseUnicodeData(text: string): RawChar[] {
  const chars: RawChar[] = [];
  let rangeStart: RawChar | null = null;

  for (const line of text.split("\n")) {
    if (line === "" || line.startsWith("#")) continue;
    const fields = line.split(";");
    const cp = Number.parseInt(fields[0]!, 16);
    const name = fields[1]!;
    const cat = fields[2]!;
    const oldName = fields[10] ?? "";

    // Handle range start/end markers like "<CJK Ideograph, First>"
    if (name.endsWith(", First>")) {
      rangeStart = { cp, name: name.replace(", First>", ">"), cat, oldName };
      continue;
    }
    if (name.endsWith(", Last>")) {
      if (rangeStart) {
        // Expand the range into individual characters, skipping CJK Unified
        // Ideographs (too numerous to be useful) and skip categories.
        if (
          !SKIP_CATEGORIES.has(cat) &&
          !EXCLUDED_RANGE_NAME.test(rangeStart.name)
        ) {
          for (let c = rangeStart.cp; c <= cp; c++) {
            chars.push({
              cp: c,
              name: rangeStart.name,
              cat,
              oldName,
            });
          }
        }
        rangeStart = null;
      }
      continue;
    }

    if (SKIP_CATEGORIES.has(cat)) continue;
    if (EXCLUDED_NAME.test(name)) continue;

    chars.push({ cp, name, cat, oldName });
  }
  return chars;
}

interface Alias {
  name: string;
  type: string;
}

function parseNameAliases(text: string): Map<number, Alias[]> {
  const aliases = new Map<number, Alias[]>();
  for (const line of text.split("\n")) {
    if (line === "" || line.startsWith("#")) continue;
    const parts = line.split(";");
    if (parts.length < 3) continue;
    const cp = Number.parseInt(parts[0]!, 16);
    const name = parts[1]!.trim();
    const type = parts[2]!.trim();
    let list = aliases.get(cp);
    if (!list) {
      list = [];
      aliases.set(cp, list);
    }
    list.push({ name, type });
  }
  return aliases;
}

interface BlockRange {
  lo: number;
  hi: number;
  name: string;
}

function parseBlocks(text: string): BlockRange[] {
  const ranges: BlockRange[] = [];
  for (const line of text.split("\n")) {
    if (line === "" || line.startsWith("#")) continue;
    const match = /^([0-9A-F]+)\.\.([0-9A-F]+);\s*(.+)$/i.exec(line);
    if (!match) continue;
    ranges.push({
      lo: Number.parseInt(match[1]!, 16),
      hi: Number.parseInt(match[2]!, 16),
      name: match[3]!.trim(),
    });
  }
  ranges.sort((a, b) => a.lo - b.lo);
  return ranges;
}

function getBlock(ranges: BlockRange[], cp: number): string | undefined {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const range = ranges[mid]!;
    if (cp < range.lo) {
      hi = mid - 1;
    } else if (cp > range.hi) {
      lo = mid + 1;
    } else {
      return range.name;
    }
  }
  return undefined;
}

// Frequency scoring: higher = more popular
// Based on general Unicode block importance and character type
const BLOCK_TIER: Record<string, number> = {
  "Basic Latin": 100,
  "Latin-1 Supplement": 90,
  "Latin Extended-A": 80,
  "Latin Extended-B": 70,
  "General Punctuation": 85,
  "Currency Symbols": 82,
  "Letterlike Symbols": 75,
  "Number Forms": 74,
  Arrows: 73,
  "Mathematical Operators": 72,
  "Miscellaneous Technical": 70,
  "Box Drawing": 65,
  "Block Elements": 64,
  "Geometric Shapes": 63,
  "Miscellaneous Symbols": 62,
  Dingbats: 61,
  "Greek and Coptic": 68,
  Cyrillic: 60,
  "CJK Symbols and Punctuation": 55,
  Hiragana: 54,
  Katakana: 53,
  "Hangul Compatibility Jamo": 50,
  "Hangul Syllables": 45,
  "Superscripts and Subscripts": 71,
  "Combining Diacritical Marks": 50,
  "Spacing Modifier Letters": 55,
};

const CATEGORY_TIER: Record<string, number> = {
  Lu: 10, // Uppercase letter
  Ll: 10, // Lowercase letter
  Lt: 8, // Titlecase letter
  Nd: 9, // Decimal digit
  Sm: 7, // Math symbol
  Sc: 8, // Currency symbol
  So: 5, // Other symbol
  Po: 6, // Other punctuation
  Ps: 6, // Open punctuation
  Pe: 6, // Close punctuation
  Pd: 6, // Dash punctuation
  No: 5, // Other number
  Sk: 4, // Modifier symbol
  Mn: 3, // Nonspacing mark
  Mc: 3, // Spacing mark
  Cc: 1, // Control
  Cf: 2, // Format
};

// Well-known characters that deserve high ranking regardless of corpus data
const BOOSTED_CHARS = new Map<number, number>([
  // Common symbols people search for
  [0x00a9, 200], // ©
  [0x00ae, 200], // ®
  [0x2122, 200], // ™
  [0x00b0, 195], // °
  [0x00b7, 190], // ·
  [0x2022, 190], // •
  [0x2026, 190], // …
  [0x2013, 188], // –
  [0x2014, 188], // —
  [0x2018, 185], // '
  [0x2019, 185], // '
  [0x201c, 185], // "
  [0x201d, 185], // "
  [0x00d7, 180], // ×
  [0x00f7, 180], // ÷
  [0x2212, 178], // −
  [0x2260, 175], // ≠
  [0x2264, 175], // ≤
  [0x2265, 175], // ≥
  [0x221e, 175], // ∞
  [0x03b1, 170], // α
  [0x03b2, 170], // β
  [0x03b3, 168], // γ
  [0x03b4, 168], // δ
  [0x03c0, 172], // π
  [0x2190, 170], // ←
  [0x2191, 170], // ↑
  [0x2192, 170], // →
  [0x2193, 170], // ↓
  [0x20ac, 195], // €
  [0x00a3, 195], // £
  [0x00a5, 190], // ¥
  [0x00a2, 185], // ¢
  [0x2103, 180], // ℃
  [0x00bd, 175], // ½
  [0x00bc, 174], // ¼
  [0x00be, 174], // ¾
  [0x00b1, 178], // ±
  [0x2248, 170], // ≈
  [0x2261, 168], // ≡
  [0x00ab, 165], // «
  [0x00bb, 165], // »
  [0x2605, 170], // ★
  [0x2606, 168], // ☆
  [0x2610, 165], // ☐
  [0x2611, 165], // ☑
  [0x2612, 165], // ☒
  [0x2714, 172], // ✔
  [0x2718, 170], // ✘
  [0x00b6, 160], // ¶
  [0x00a7, 162], // §
  [0x2020, 160], // †
  [0x2021, 158], // ‡
]);

function parseEmojiVariationSequences(text: string): Set<number> {
  const cps = new Set<number>();
  for (const line of text.split("\n")) {
    if (line === "" || line.startsWith("#")) continue;
    const match = /^([0-9A-Fa-f]+)\s+FE0[EF]/.exec(line);
    if (match) cps.add(Number.parseInt(match[1]!, 16));
  }
  return cps;
}

// Skin tone modifier range
const SKIN_TONE_LO = 0x1f3fb;
const SKIN_TONE_HI = 0x1f3ff;

function isSkinTone(cp: number): boolean {
  return cp >= SKIN_TONE_LO && cp <= SKIN_TONE_HI;
}

interface EmojiTestResult {
  emojiOrder: Map<number, number>;
  sequenceEntries: {
    cps: number[];
    name: string;
    keywords: string[];
    score: number;
  }[];
  variantMap: Map<string, { cps: number[]; label: string }[]>;
}

function parseEmojiTest(text: string): EmojiTestResult {
  const emojiOrder = new Map<number, number>();
  const sequenceEntries: EmojiTestResult["sequenceEntries"] = [];
  const variantMap = new Map<string, { cps: number[]; label: string }[]>();

  let rank = 150;
  let seqRank = 100;
  let currentGroup = "";
  let currentSubgroup = "";

  for (const line of text.split("\n")) {
    // Track group/subgroup for keywords
    const groupMatch = /^# group: (.+)/.exec(line);
    if (groupMatch) {
      currentGroup = groupMatch[1]!;
      continue;
    }
    const subgroupMatch = /^# subgroup: (.+)/.exec(line);
    if (subgroupMatch) {
      currentSubgroup = subgroupMatch[1]!;
      continue;
    }

    if (line === "" || line.startsWith("#")) continue;

    // Only process fully-qualified sequences
    const match =
      /^([0-9A-Fa-f][0-9A-Fa-f ]*?)\s+;\s+fully-qualified\s+#\s+\S+\s+E[\d.]+\s+(.+)$/.exec(
        line,
      );
    if (!match) continue;

    const cps = match[1]!
      .trim()
      .split(/\s+/)
      .map((h) => Number.parseInt(h, 16));
    const name = match[2]!;

    // Single code point: emoji ranking (existing behavior)
    if (cps.length === 1) {
      const cp = cps[0]!;
      if (!emojiOrder.has(cp)) {
        emojiOrder.set(cp, rank);
        rank = Math.max(rank - 0.1, 50);
      }
      continue;
    }

    // VS16-only pair (CP + FE0F): skip, handled by variation sequences
    if (cps.length === 2 && cps[1] === 0xfe0f) continue;

    // Multi-codepoint: classify as variant or list entry
    const hasSkinTone = cps.some(isSkinTone);

    if (hasSkinTone) {
      // Variant: strip skin tone modifiers to find the base
      const baseCps = cps.filter((cp) => !isSkinTone(cp));
      const baseKey = entryKey({
        cp: baseCps[0]!,
        ...(baseCps.length > 1 && { cps: baseCps }),
      });

      // Extract label: text after ": " in the name
      const colonIdx = name.indexOf(": ");
      const label = colonIdx >= 0 ? name.slice(colonIdx + 2) : name;

      let variants = variantMap.get(baseKey);
      if (!variants) {
        variants = [];
        variantMap.set(baseKey, variants);
      }
      variants.push({ cps, label });
    } else {
      // List entry: flag, keycap, or ZWJ standalone
      const keywords: string[] = [];
      if (currentGroup) keywords.push(currentGroup);
      if (currentSubgroup) keywords.push(currentSubgroup);

      // For country flags, derive the ISO 2-letter code
      if (
        cps.length === 2 &&
        cps[0]! >= 0x1f1e6 &&
        cps[0]! <= 0x1f1ff &&
        cps[1]! >= 0x1f1e6 &&
        cps[1]! <= 0x1f1ff
      ) {
        const letter1 = String.fromCodePoint(cps[0]! - 0x1f1e6 + 0x41);
        const letter2 = String.fromCodePoint(cps[1]! - 0x1f1e6 + 0x41);
        keywords.push(letter1 + letter2);
      }

      sequenceEntries.push({
        cps,
        name: name.toUpperCase(),
        keywords,
        score: seqRank,
      });
      seqRank = Math.max(seqRank - 0.1, 30);
    }
  }

  return { emojiOrder, sequenceEntries, variantMap };
}

function computeScore(
  cp: number,
  cat: string,
  blockName: string | undefined,
  emojiOrder: Map<number, number>,
): number {
  // Check explicit boosts first
  const boost = BOOSTED_CHARS.get(cp);
  if (boost !== undefined) return boost;

  // Check emoji ordering
  const emojiRank = emojiOrder.get(cp);
  if (emojiRank !== undefined) return emojiRank;

  // Score by block tier + category tier
  const blockScore = (blockName ? BLOCK_TIER[blockName] : undefined) ?? 10;
  const catScore = CATEGORY_TIER[cat] ?? 3;
  return blockScore + catScore;
}

function formatCodePoint(cp: number): string {
  return cp.toString(16).toUpperCase().padStart(4, "0");
}

async function main(): Promise<void> {
  console.log("Downloading Unicode data files...");
  mkdirSync(DATA_DIR, { recursive: true });

  const files = await Promise.all(
    Object.entries(SOURCES).map(
      async ([name, url]) => [name, await download(name, url)] as const,
    ),
  );
  const fileMap = new Map(files);

  console.log("Parsing Unicode data...");
  const rawChars = parseUnicodeData(fileMap.get("UnicodeData.txt")!);
  const aliases = parseNameAliases(fileMap.get("NameAliases.txt")!);
  const blockRanges = parseBlocks(fileMap.get("Blocks.txt")!);
  const { emojiOrder, sequenceEntries, variantMap } = parseEmojiTest(
    fileMap.get("emoji-test.txt")!,
  );
  const variationCps = parseEmojiVariationSequences(
    fileMap.get("emoji-variation-sequences.txt")!,
  );

  console.log(
    `  ${rawChars.length} characters parsed (CJK and Tangut excluded)`,
  );
  console.log(`  ${sequenceEntries.length} emoji sequences`);
  console.log(`  ${variantMap.size} base emoji with variants`);

  // Build character entries with keywords and scores
  const entries: {
    cp: number;
    cps?: number[];
    name: string;
    keywords: string[];
    cat: string;
    score: number;
    vs?: true;
  }[] = [];

  for (const raw of rawChars) {
    const keywords: string[] = [];

    // Add old/informative name if different
    if (raw.oldName !== "" && raw.oldName !== raw.name) {
      keywords.push(raw.oldName);
    }

    // Add aliases
    const charAliases = aliases.get(raw.cp);
    if (charAliases) {
      for (const alias of charAliases) {
        // "correction" type replaces the primary name for display
        // All types are useful as keywords
        keywords.push(alias.name);
      }
    }

    // Add block name
    const blockName = getBlock(blockRanges, raw.cp);
    if (blockName) {
      keywords.push(blockName);
    }

    // Compute display name: prefer correction alias over original name
    let displayName = raw.name;
    if (charAliases) {
      const correction = charAliases.find((a) => a.type === "correction");
      if (correction) {
        displayName = correction.name;
      }
    }
    // Control characters get their control alias as name
    if (displayName === "<control>") {
      const controlAlias = charAliases?.find((a) => a.type === "control");
      if (controlAlias) {
        displayName = controlAlias.name;
      }
    }

    const score = computeScore(raw.cp, raw.cat, blockName, emojiOrder);

    entries.push({
      cp: raw.cp,
      name: displayName,
      keywords,
      cat: raw.cat,
      score,
      ...(variationCps.has(raw.cp) && { vs: true }),
    });
  }

  // Add multi-codepoint sequence entries (flags, keycaps, ZWJ emoji)
  for (const seq of sequenceEntries) {
    entries.push({
      cp: seq.cps[0]!,
      cps: seq.cps,
      name: seq.name,
      keywords: seq.keywords,
      cat: "So",
      score: seq.score,
    });
  }

  // Reconcile orphan variant groups: skin tone modifiers replace VS16 (FE0F)
  // in emoji sequences, so the derived base key may be missing FE0F that the
  // actual entry has. Build a fuzzy index to re-key these variants.
  const entryKeySet = new Set(
    entries.map((e) => entryKey({ cp: e.cp, ...(e.cps && { cps: e.cps }) })),
  );
  const stripFE0F = (key: string): string =>
    key
      .split("-")
      .filter((h) => h !== "FE0F")
      .join("-");
  const fuzzyIndex = new Map<string, string>();
  for (const key of entryKeySet) {
    fuzzyIndex.set(stripFE0F(key), key);
  }
  for (const [baseKey, variants] of [...variantMap]) {
    if (!entryKeySet.has(baseKey)) {
      const realKey = fuzzyIndex.get(stripFE0F(baseKey));
      if (realKey) {
        variantMap.delete(baseKey);
        const existing = variantMap.get(realKey);
        if (existing) {
          existing.push(...variants);
        } else {
          variantMap.set(realKey, variants);
        }
      } else {
        // Multi-person sequences with per-participant skin tones have no
        // single base entry to attach to — drop them.
        variantMap.delete(baseKey);
      }
    }
  }

  // Sort by score descending, then by code point ascending for stability
  entries.sort((a, b) => b.score - a.score || a.cp - b.cp);

  console.log(`  Top 10 by popularity:`);
  for (const e of entries.slice(0, 10)) {
    const char = String.fromCodePoint(e.cp);
    console.log(
      `    U+${formatCodePoint(e.cp)} ${char}  ${e.name} (score: ${e.score})`,
    );
  }

  // Generate characters JSON + thin TypeScript re-export
  console.log("Generating character data...");
  const jsonData = entries.map((e) => ({
    cp: e.cp,
    ...(e.cps && { cps: e.cps }),
    name: e.name,
    keywords: e.keywords,
    cat: e.cat,
    ...(e.vs && { vs: true }),
  }));
  const jsonString = JSON.stringify(jsonData);
  const charJsonPath = join(SRC_DIR, "characters.json");
  writeFileSync(charJsonPath, jsonString + "\n");

  const charTsOutput = [
    "// Auto-generated by scripts/generate-data.ts — do not edit",
    '// Run "npm run generate" to regenerate',
    "",
    'import type { CharacterEntry } from "./types.js";',
    "// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment",
    'import data from "./characters.json";',
    "",
    "export const characters: CharacterEntry[] = data as CharacterEntry[];",
    "",
  ].join("\n");
  writeFileSync(join(SRC_DIR, "characters.ts"), charTsOutput);
  console.log(
    `  Wrote ${entries.length} entries (${(jsonString.length / 1024 / 1024).toFixed(1)}MB JSON)`,
  );

  // Generate variants JSON + thin TypeScript re-export
  const variantObj: Record<string, { cps: number[]; label: string }[]> = {};
  for (const [key, variants] of variantMap) {
    variantObj[key] = variants;
  }
  const variantJsonString = JSON.stringify(variantObj);
  writeFileSync(join(SRC_DIR, "variants.json"), variantJsonString + "\n");

  const variantTsOutput = [
    "// Auto-generated by scripts/generate-data.ts — do not edit",
    '// Run "npm run generate" to regenerate',
    "",
    'import type { EmojiVariant } from "./types.js";',
    "// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment",
    'import data from "./variants.json";',
    "",
    "export const variants: Record<string, EmojiVariant[]> = data as Record<",
    "  string,",
    "  EmojiVariant[]",
    ">;",
    "",
  ].join("\n");
  writeFileSync(join(SRC_DIR, "variants.ts"), variantTsOutput);
  console.log(
    `  Wrote ${variantMap.size} variant groups (${(variantJsonString.length / 1024).toFixed(0)}KB JSON)`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
