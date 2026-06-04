// SPDX-FileCopyrightText: Copyright © 2026 Michael Shields
// SPDX-License-Identifier: MIT

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { entryKey } from "../src/types.js";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(PROJECT_ROOT, "data");
const SRC_DIR = join(PROJECT_ROOT, "src");

// When bumping the version, also update the numbers stated in NOTICE and
// README.md — those are hand-written and not derived from this constant.
const UNICODE_VERSION = "17.0.0";
const PUBLIC_BASE = `https://unicode.org/Public/${UNICODE_VERSION}`;
const UCD_BASE = `${PUBLIC_BASE}/ucd`;
// Since Unicode 17.0, the emoji data files live under the version directory;
// the standalone /Public/emoji/<version>/ tree stops at 16.0.
const EMOJI_BASE = `${PUBLIC_BASE}/emoji`;

// Per-code-point occurrence counts from FineFreq (the FineWeb / FineWeb2
// derivative of Common Crawl, ~96 trillion characters, 2013–2025). This is the
// primary popularity signal — real web-text frequency in place of hand-tuned
// tiers. English table only; CC-BY-4.0 (see NOTICE). The corpus is
// NFKC-normalized, which folds many compatibility characters away; those are
// ranked from the non-normalized Leipzig counts instead (see computeScore).
const FINEFREQ_URL =
  "https://huggingface.co/datasets/lgi2p/finefreq/resolve/main/DATA/eng_Latn/eng_Latn.csv";

const SOURCES: Record<string, string> = {
  "UnicodeData.txt": `${UCD_BASE}/UnicodeData.txt`,
  "NameAliases.txt": `${UCD_BASE}/NameAliases.txt`,
  "Blocks.txt": `${UCD_BASE}/Blocks.txt`,
  "emoji-test.txt": `${EMOJI_BASE}/emoji-test.txt`,
  "emoji-variation-sequences.txt": `${UCD_BASE}/emoji/emoji-variation-sequences.txt`,
  "finefreq-eng.csv": FINEFREQ_URL,
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
  /** A "styled" compatibility character — mathematical alphanumeric, circled,
   * or full/half-width. NFKC folds these away so no corpus ranks them; they are
   * given one flat rank instead of individual frequencies (see computeScore). */
  flat: boolean;
}

// Decomposition tags whose characters are the flat-ranked styled forms above.
const FLAT_DECOMP = /^<(font|circle|wide|narrow)>/;

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
    const decomp = fields[5] ?? "";

    // Handle range start/end markers like "<CJK Ideograph, First>"
    if (name.endsWith(", First>")) {
      rangeStart = {
        cp,
        name: name.replace(", First>", ">"),
        cat,
        oldName,
        flat: false,
      };
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
              flat: false,
            });
          }
        }
        rangeStart = null;
      }
      continue;
    }

    if (SKIP_CATEGORIES.has(cat)) continue;
    if (EXCLUDED_NAME.test(name)) continue;

    chars.push({ cp, name, cat, oldName, flat: FLAT_DECOMP.test(decomp) });
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

// Minimal RFC 4180 CSV reader: fields may be quoted, with embedded quotes
// escaped by doubling. FineFreq's `character` column is itself a comma or a
// quote for those rows, so a naïve split on commas would corrupt exactly the
// punctuation we most want to rank — hence the state machine.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// Map each single code point to its total occurrence count in FineFreq's English
// table. Rows whose `character` spans more than one code point (rare NFKC
// artifacts) are skipped — only atomic characters carry a frequency.
function parseFineFreq(text: string): Map<number, number> {
  // Strip a leading byte-order mark if the server sends one.
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = parseCsv(clean);
  const header = rows[0] ?? [];
  const charIdx = header.indexOf("character");
  const freqIdx = header.indexOf("total_frequency_all_time");
  if (charIdx === -1 || freqIdx === -1) {
    throw new Error("FineFreq CSV missing expected columns");
  }
  const freq = new Map<number, number>();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!;
    const ch = row[charIdx];
    const raw = row[freqIdx];
    if (ch === undefined || raw === undefined || ch === "") continue;
    if ([...ch].length !== 1) continue;
    const count = Number.parseInt(raw, 10);
    if (Number.isFinite(count)) freq.set(ch.codePointAt(0)!, count);
  }
  return freq;
}

// Fallback tiers, used only for characters FineFreq does not meaningfully
// observe (see computeScore). Higher = more popular; based on general Unicode
// block importance and character type.
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

// Ordered by descending tier (higher = more popular).
const CATEGORY_TIER: Record<string, number> = {
  Ll: 11, // Lowercase letter — outranks its uppercase pair (more commonly typed)
  Lu: 10, // Uppercase letter
  Nd: 9, // Decimal digit
  Lt: 8, // Titlecase letter
  Sc: 8, // Currency symbol
  Sm: 7, // Math symbol
  Po: 6, // Other punctuation
  Ps: 6, // Open punctuation
  Pe: 6, // Close punctuation
  Pd: 6, // Dash punctuation
  So: 5, // Other symbol
  No: 5, // Other number
  Sk: 4, // Modifier symbol
  Mn: 3, // Nonspacing mark
  Mc: 3, // Spacing mark
  Cf: 2, // Format
  Cc: 1, // Control
};

// Non-NFKC per-code-point counts from the Leipzig corpora
// (src/leipzig-freq.json, produced by `make leipzig`). Leipzig text is not
// normalized, so it sees the compatibility characters FineFreq folds away;
// calibrate() projects these counts onto FineFreq's scale. Returns an empty map
// if the file is absent, in which case folded characters fall to the tail.
function parseLeipzig(): Map<number, number> {
  const path = join(SRC_DIR, "leipzig-freq.json");
  const counts = new Map<number, number>();
  if (!existsSync(path)) return counts;
  const obj = JSON.parse(readFileSync(path, "utf-8")) as Record<string, number>;
  for (const [hex, n] of Object.entries(obj)) {
    counts.set(Number.parseInt(hex, 16), n);
  }
  return counts;
}

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

interface Calibration {
  a: number;
  b: number;
}

// Least-squares fit log10(FineFreq) = a*log10(Leipzig) + b over the characters
// both corpora see (i.e. the non-folded ones), giving the line that projects a
// folded character — visible only to Leipzig — onto FineFreq's frequency scale.
// The floors drop noisy low-count anchors; in practice the fit is tight
// (R^2 ~ 0.93, slope ~0.9). Returns null if there are too few anchors.
function calibrate(
  freq: Map<number, number>,
  leipzig: Map<number, number>,
): Calibration | null {
  let n = 0,
    sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0;
  for (const [cp, l] of leipzig) {
    const f = freq.get(cp);
    if (f === undefined || l < 20 || f < 1000) continue;
    const x = Math.log10(l);
    const y = Math.log10(f);
    n++;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  if (n < 50) return null;
  const a = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const b = (sy - a * sx) / n;
  // Degenerate anchors (e.g. all the same count → zero denominator) give a
  // non-finite fit; reject it so NaN never reaches a score and scatters the
  // Leipzig-ranked characters through entries.sort().
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { a, b };
}

// Popularity score. The primary signal is real web-text frequency from FineFreq,
// log-scaled into a band (DATA_BASE + log10 count) that sits above every
// fallback, so any genuinely-used character outranks an unobserved one.
// Characters NFKC folds out of FineFreq are ranked from the non-normalized
// Leipzig counts, calibrated onto the same scale; the styled compatibility forms
// (math-alphanumeric, circled, full/half-width), which no corpus ranks, share
// one flat rank just below the data band. Everything else falls back to
// Unicode's semantic emoji order, then to the block/category heuristic.
const FREQ_FLOOR = 1_000_000; // FineFreq counts below this fall to the tail
const DATA_BASE = 200; // data band: DATA_BASE + log10(count)
// Styled forms (math-alphanumeric, circled, full/half-width) share one rank,
// one point below the data-band floor (DATA_BASE + log10(FREQ_FLOOR)) so they
// sit just under every frequency-ranked character regardless of those tunables.
const FLAT_SCORE = DATA_BASE + Math.log10(FREQ_FLOOR) - 1;

function computeScore(
  cp: number,
  cat: string,
  blockName: string | undefined,
  flat: boolean,
  freq: Map<number, number>,
  leipzig: Map<number, number>,
  calib: Calibration | null,
  emojiOrder: Map<number, number>,
): number {
  const ffCount = freq.get(cp);
  if (ffCount !== undefined) {
    if (ffCount >= FREQ_FLOOR) return DATA_BASE + Math.log10(ffCount);
  } else {
    // Absent from FineFreq → NFKC-folded. Flat-rank the styled forms en masse;
    // rank the rest from Leipzig, calibrated onto FineFreq's scale.
    if (flat) return FLAT_SCORE;
    const l = leipzig.get(cp);
    if (l !== undefined && calib) {
      return DATA_BASE + calib.a * Math.log10(l) + calib.b;
    }
  }

  // Emoji keep Unicode's semantic order when their text frequency is too thin.
  const emojiRank = emojiOrder.get(cp);
  if (emojiRank !== undefined) return emojiRank;

  // Heuristic tail for everything the corpus does not meaningfully observe.
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
  const freq = parseFineFreq(fileMap.get("finefreq-eng.csv")!);
  const leipzig = parseLeipzig();
  const calib = calibrate(freq, leipzig);

  console.log(
    `  ${rawChars.length} characters parsed (CJK and Tangut excluded)`,
  );
  console.log(`  ${sequenceEntries.length} emoji sequences`);
  console.log(`  ${variantMap.size} base emoji with variants`);
  console.log(`  ${freq.size} code points with FineFreq frequency data`);
  if (calib) {
    console.log(
      `  ${leipzig.size} Leipzig counts; calibration log10F = ${calib.a.toFixed(3)}*log10L + ${calib.b.toFixed(3)}`,
    );
  } else {
    console.log(`  no Leipzig calibration (src/leipzig-freq.json absent)`);
  }

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

    const score = computeScore(
      raw.cp,
      raw.cat,
      blockName,
      raw.flat,
      freq,
      leipzig,
      calib,
      emojiOrder,
    );

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

  const logRanked = (label: string, list: typeof entries): void => {
    console.log(`  ${label}:`);
    for (const e of list) {
      const char = String.fromCodePoint(e.cp);
      console.log(
        `    U+${formatCodePoint(e.cp)} ${char}  ${e.name} (score: ${e.score.toFixed(2)})`,
      );
    }
  };
  logRanked("Top 10 by popularity", entries.slice(0, 10));
  // ASCII is siphoned into the keyboard tier at runtime, so the interesting
  // signal is the order of the special characters that remain.
  logRanked(
    "Top 25 non-ASCII",
    entries.filter((e) => !e.cps && e.cp > 0x7f).slice(0, 25),
  );

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
