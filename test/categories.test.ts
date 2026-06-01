// SPDX-FileCopyrightText: Copyright © 2026 Michael Shields
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { CATEGORY_NAMES, categoryLabel } from "../src/categories.js";
import { characters } from "../src/characters.js";

describe("categoryLabel", () => {
  it("formats a known category as name plus abbreviation", () => {
    expect(categoryLabel("Ll")).toBe("Lowercase Letter (Ll)");
    expect(categoryLabel("Sc")).toBe("Currency Symbol (Sc)");
  });

  it("falls back to the bare abbreviation for an unknown category", () => {
    expect(categoryLabel("Zz")).toBe("Zz");
  });
});

describe("CATEGORY_NAMES", () => {
  it("names every general category present in the data", () => {
    const present = new Set(characters.map((c) => c.cat));
    const missing = [...present].filter((cat) => !(cat in CATEGORY_NAMES));
    expect(missing).toEqual([]);
  });
});
