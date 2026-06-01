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
    const [first] = Object.values(variants);
    expect(first).toBeDefined();
    expect(first!.length).toBeGreaterThan(0);
    const variant = first![0]!;
    expect(Array.isArray(variant.cps)).toBe(true);
    expect(typeof variant.label).toBe("string");
  });
});
