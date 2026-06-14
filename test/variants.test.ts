// SPDX-FileCopyrightText: Copyright © 2026 Michael Shields
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { variants } from "../src/variants.js";

describe("variants module", () => {
  it("exposes the generated variant groups as a record", () => {
    expect(typeof variants).toBe("object");
    expect(Object.keys(variants).length).toBeGreaterThan(100);
  });

  it("maps each key to a non-empty list of variants with cps and labels", () => {
    const groups = Object.values(variants);
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(group.length).toBeGreaterThan(0);
      for (const variant of group) {
        expect(Array.isArray(variant.cps)).toBe(true);
        expect(variant.cps.length).toBeGreaterThan(0);
        expect(variant.cps.every((cp) => Number.isInteger(cp) && cp >= 0)).toBe(
          true,
        );
        expect(typeof variant.label).toBe("string");
        expect(variant.label.length).toBeGreaterThan(0);
      }
    }
  });
});
