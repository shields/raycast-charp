import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(PROJECT_ROOT, "data");
const OUTPUT = join(PROJECT_ROOT, "src", "characters.ts");

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
};

// CJK Unified Ideograph ranges to exclude
const CJK_RANGES: [number, number][] = [
  [0x4e00, 0x9fff],
  [0x3400, 0x4dbf],
  [0x20000, 0x2a6df],
  [0x2a700, 0x2b739],
  [0x2b740, 0x2b81d],
  [0x2b820, 0x2cea1],
  [0x2ceb0, 0x2ebe0],
  [0x30000, 0x3134a],
  [0x31350, 0x323af],
];

function isCJK(cp: number): boolean {
  return CJK_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
}

// Categories to skip: surrogates, private use, unassigned control-like
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
        // For ranges, we'd generate every character — but we skip CJK etc.
        // Only expand ranges for non-CJK, non-skip categories
        if (!SKIP_CATEGORIES.has(cat)) {
          for (let c = rangeStart.cp; c <= cp; c++) {
            if (!isCJK(c)) {
              chars.push({
                cp: c,
                name: rangeStart.name,
                cat,
                oldName,
              });
            }
          }
        }
        rangeStart = null;
      }
      continue;
    }

    if (SKIP_CATEGORIES.has(cat)) continue;
    if (isCJK(cp)) continue;

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

function parseEmojiTest(text: string): Map<number, number> {
  const emojiOrder = new Map<number, number>();
  let rank = 150; // Emoji start below the top symbols
  for (const line of text.split("\n")) {
    if (line === "" || line.startsWith("#")) continue;
    const match = /^([0-9A-Fa-f]+)\s+;/.exec(line);
    if (!match) continue;
    // Only single code point emoji (not sequences)
    if (line.includes(" ")) {
      const parts = line.split(";")[0]!.trim().split(/\s+/);
      if (parts.length > 1) continue;
    }
    const cp = Number.parseInt(match[1]!, 16);
    if (!emojiOrder.has(cp)) {
      emojiOrder.set(cp, rank);
      rank = Math.max(rank - 0.1, 50); // Slowly decrease rank
    }
  }
  return emojiOrder;
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
  const emojiOrder = parseEmojiTest(fileMap.get("emoji-test.txt")!);

  console.log(`  ${rawChars.length} characters parsed (CJK excluded)`);

  // Build character entries with keywords and scores
  const entries: {
    cp: number;
    name: string;
    keywords: string[];
    cat: string;
    score: number;
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
    });
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

  // Generate JSON data file + thin TypeScript re-export
  console.log("Generating character data...");
  const jsonData = entries.map((e) => ({
    cp: e.cp,
    name: e.name,
    keywords: e.keywords,
    cat: e.cat,
  }));
  const jsonString = JSON.stringify(jsonData);
  const jsonPath = join(PROJECT_ROOT, "src", "characters.json");
  writeFileSync(jsonPath, jsonString + "\n");

  const tsOutput = [
    "// Auto-generated by scripts/generate-data.ts — do not edit",
    '// Run "npm run generate" to regenerate',
    "",
    'import type { CharacterEntry } from "./types.js";',
    // eslint-disable is needed because TS can't verify the JSON shape
    "// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment",
    'import data from "./characters.json";',
    "",
    "export const characters: CharacterEntry[] = data as CharacterEntry[];",
    "",
  ].join("\n");

  writeFileSync(OUTPUT, tsOutput);
  console.log(
    `  Wrote ${entries.length} entries (${(jsonString.length / 1024 / 1024).toFixed(1)}MB JSON)`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
