// SPDX-FileCopyrightText: Copyright © 2026 Michael Shields
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from "vitest";
import { systemKeystrokes } from "swift:../swift";
import { loadKeystrokeMap } from "../src/keyboard.js";

vi.mock("swift:../swift", () => ({ systemKeystrokes: vi.fn() }));

describe("loadKeystrokeMap", () => {
  it("preserves native labels and dead-key sequences", async () => {
    vi.mocked(systemKeystrokes).mockResolvedValueOnce(
      JSON.stringify([
        { character: "@", label: "⇧2", modifiers: "⇧" },
        {
          character: "é",
          label: "⌥E E",
          modifiers: "⌥",
          deadKey: { trigger: "⌥E", completion: "E" },
        },
        { character: "𝔸", label: "⌥A", modifiers: "⌥" },
      ]),
    );
    const map = await loadKeystrokeMap();
    expect(map.get("@")).toEqual({ label: "⇧2", modifiers: "⇧" });
    expect(map.get("é")).toEqual({
      label: "⌥E E",
      modifiers: "⌥",
      deadKey: { trigger: "⌥E", completion: "E" },
    });
    expect(map.get("𝔸")?.label).toBe("⌥A");
  });

  it("returns an empty map for an input source without a Unicode layout", async () => {
    vi.mocked(systemKeystrokes).mockResolvedValueOnce("[]");
    expect((await loadKeystrokeMap()).size).toBe(0);
  });

  it("propagates native failures", async () => {
    vi.mocked(systemKeystrokes).mockRejectedValueOnce(
      new Error("Unable to read keyboard layout"),
    );
    await expect(loadKeystrokeMap()).rejects.toThrow(
      "Unable to read keyboard layout",
    );
  });

  it("rejects malformed native output", async () => {
    vi.mocked(systemKeystrokes).mockResolvedValueOnce("invalid JSON");
    await expect(loadKeystrokeMap()).rejects.toThrow(SyntaxError);
  });
});
