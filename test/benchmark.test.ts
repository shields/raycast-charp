// SPDX-FileCopyrightText: Copyright © 2026 Michael Shields
// SPDX-License-Identifier: MIT

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { characters } from "../src/characters.js";
import { buildKeystrokeMap } from "../src/keyboard.js";
import { searchCharacters } from "../src/search.js";
import { FIXTURE_LAYOUT_PATH } from "./helpers.js";

const JSON_PATH = join(import.meta.dirname, "..", "src", "characters.json");
const VARIANT_PATH = join(import.meta.dirname, "..", "src", "variants.json");

describe("benchmark", () => {
  it("parses character JSON in <100ms", () => {
    const raw = readFileSync(JSON_PATH, "utf-8");

    const start = performance.now();
    const data = JSON.parse(raw) as unknown[];
    const elapsed = performance.now() - start;

    console.log(
      `JSON.parse: ${elapsed.toFixed(2)}ms (${String(data.length)} entries, ${(raw.length / 1024 / 1024).toFixed(1)}MB)`,
    );
    expect(elapsed).toBeLessThan(100);
    expect(data.length).toBeGreaterThan(50_000);
  });

  it("parses .keylayout in <100ms", () => {
    const xml = readFileSync(FIXTURE_LAYOUT_PATH, "utf-8");

    const start = performance.now();
    const map = buildKeystrokeMap(xml);
    const elapsed = performance.now() - start;

    console.log(
      `Keylayout parse: ${elapsed.toFixed(2)}ms (${String(map.size)} mappings)`,
    );
    expect(elapsed).toBeLessThan(100);
    expect(map.size).toBeGreaterThan(5);
  });

  it("builds reverse keystroke map in <20ms", () => {
    const xml = readFileSync(FIXTURE_LAYOUT_PATH, "utf-8");
    buildKeystrokeMap(xml);

    const iterations = 100;
    const start = performance.now();
    let size = 0;
    for (let i = 0; i < iterations; i++) {
      size = buildKeystrokeMap(xml).size;
    }
    const elapsed = (performance.now() - start) / iterations;

    console.log(
      `Keystroke map build (avg of ${String(iterations)}): ${elapsed.toFixed(2)}ms (${String(size)} mappings)`,
    );
    expect(elapsed).toBeLessThan(20);
  });

  it("parses variants JSON in <50ms", () => {
    const raw = readFileSync(VARIANT_PATH, "utf-8");

    const start = performance.now();
    const data = JSON.parse(raw) as Record<string, unknown[]>;
    const elapsed = performance.now() - start;

    const groups = Object.keys(data).length;
    console.log(
      `Variants JSON.parse: ${elapsed.toFixed(2)}ms (${String(groups)} groups, ${(raw.length / 1024).toFixed(0)}KB)`,
    );
    expect(elapsed).toBeLessThan(50);
    expect(groups).toBeGreaterThan(100);
  });

  it("reports memory footprint", () => {
    const raw = readFileSync(JSON_PATH, "utf-8");
    const data = JSON.parse(raw) as unknown[];
    const variantRaw = readFileSync(VARIANT_PATH, "utf-8");
    const xml = readFileSync(FIXTURE_LAYOUT_PATH, "utf-8");
    const keystrokeMap = buildKeystrokeMap(xml);

    const keystrokeSize = JSON.stringify([...keystrokeMap.entries()]).length;

    console.log(`Character data: ~${(raw.length / 1024 / 1024).toFixed(1)}MB`);
    console.log(`Variant data: ~${(variantRaw.length / 1024).toFixed(0)}KB`);
    console.log(`Keystroke map: ~${(keystrokeSize / 1024).toFixed(1)}KB`);
    console.log(
      `Total entries: ${String(data.length)} characters, ${String(keystrokeMap.size)} keystrokes`,
    );

    expect(raw.length).toBeLessThan(20 * 1024 * 1024);
  });
});

/** Average per-call time of a search query, after a short warm-up. */
function benchmarkSearch(query: string, iterations: number): number {
  for (let i = 0; i < 3; i++) searchCharacters(characters, query);
  const start = performance.now();
  for (let i = 0; i < iterations; i++) searchCharacters(characters, query);
  return (performance.now() - start) / iterations;
}

describe("search benchmark", () => {
  it("scores a strict multi-term query in <150ms", () => {
    // The per-keystroke hot path: every one of ~51k entries is scored against
    // the terms. A tight budget guards against regressions like edit-distance
    // fuzzy matching running across the whole corpus for well-spelled queries.
    const avg = benchmarkSearch("left arrow", 20);
    console.log(`Strict search "left arrow": ${avg.toFixed(2)}ms/call`);
    expect(avg).toBeLessThan(150);
  });

  it("returns the initial slice for an empty query in <10ms", () => {
    const avg = benchmarkSearch("", 100);
    console.log(`Empty query: ${avg.toFixed(2)}ms/call`);
    expect(avg).toBeLessThan(10);
  });

  // benchmarkSearch makes 6 calls (3 warm-up + 3 measured); at the 1500ms budget
  // that is up to 9s of legitimate work, which would overrun Vitest's default
  // 5000ms test timeout before the assertion runs, so give the case headroom.
  const FUZZY_TIMEOUT_MS = 20_000;

  it(
    "runs the fuzzy fallback in <1500ms",
    () => {
      // "letf arrow" matches nothing strictly, so this exercises both passes (the
      // strict miss plus corpus-wide fuzzy edit-distance). Intentionally heavier
      // than the hot path; this loose budget only catches a catastrophic blow-up.
      const avg = benchmarkSearch("letf arrow", 3);
      console.log(`Fuzzy fallback "letf arrow": ${avg.toFixed(2)}ms/call`);
      expect(avg).toBeLessThan(1500);
    },
    FUZZY_TIMEOUT_MS,
  );
});
