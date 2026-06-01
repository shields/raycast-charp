// SPDX-FileCopyrightText: Copyright © 2026 Michael Shields
// SPDX-License-Identifier: MIT

import { LocalStorage } from "@raycast/api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeRecencyBoosts,
  getRecentCharacters,
  recordCharacterUse,
} from "../src/recency.js";
import type { CharacterEntry, RecentEntry } from "../src/types.js";

vi.mock("@raycast/api", () => ({
  LocalStorage: { getItem: vi.fn(), setItem: vi.fn() },
}));

const STORAGE_KEY = "recent-characters";
const getItem = vi.mocked(LocalStorage.getItem);
const setItem = vi.mocked(LocalStorage.setItem);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getRecentCharacters", () => {
  it("returns an empty list when nothing is stored", async () => {
    getItem.mockResolvedValue(undefined);
    expect(await getRecentCharacters()).toEqual([]);
  });

  it("parses the stored JSON into recent entries", async () => {
    const stored: RecentEntry[] = [
      { cp: 0x41 },
      { cp: 0x1f1eb, cps: [0x1f1eb, 0x1f1f7] },
    ];
    getItem.mockResolvedValue(JSON.stringify(stored));
    expect(await getRecentCharacters()).toEqual(stored);
  });

  it("returns an empty list when the stored value is not valid JSON", async () => {
    getItem.mockResolvedValue("{not valid json");
    expect(await getRecentCharacters()).toEqual([]);
  });
});

describe("recordCharacterUse", () => {
  const a: CharacterEntry = {
    cp: 0x41,
    name: "LATIN CAPITAL LETTER A",
    keywords: [],
    cat: "Lu",
  };

  it("prepends a newly used single-codepoint entry", async () => {
    getItem.mockResolvedValue(JSON.stringify([{ cp: 0x42 }]));
    await recordCharacterUse(a);
    expect(setItem).toHaveBeenCalledWith(
      STORAGE_KEY,
      JSON.stringify([{ cp: 0x41 }, { cp: 0x42 }]),
    );
  });

  it("stores the full code point sequence for multi-codepoint entries", async () => {
    getItem.mockResolvedValue(undefined);
    const flag: CharacterEntry = {
      cp: 0x1f1eb,
      cps: [0x1f1eb, 0x1f1f7],
      name: "FLAG: FRANCE",
      keywords: [],
      cat: "So",
    };
    await recordCharacterUse(flag);
    expect(setItem).toHaveBeenCalledWith(
      STORAGE_KEY,
      JSON.stringify([{ cp: 0x1f1eb, cps: [0x1f1eb, 0x1f1f7] }]),
    );
  });

  it("moves an already-recorded entry to the front without duplicating it", async () => {
    getItem.mockResolvedValue(JSON.stringify([{ cp: 0x42 }, { cp: 0x41 }]));
    await recordCharacterUse(a);
    expect(setItem).toHaveBeenCalledWith(
      STORAGE_KEY,
      JSON.stringify([{ cp: 0x41 }, { cp: 0x42 }]),
    );
  });

  it("trims the history to the maximum size", async () => {
    const many: RecentEntry[] = Array.from({ length: 250 }, (_, i) => ({
      cp: 0x1000 + i,
    }));
    getItem.mockResolvedValue(JSON.stringify(many));
    await recordCharacterUse(a);
    const [, json] = setItem.mock.calls[0]!;
    const saved = JSON.parse(json as string) as RecentEntry[];
    expect(saved).toHaveLength(200);
    expect(saved[0]).toEqual({ cp: 0x41 });
  });
});

describe("computeRecencyBoosts", () => {
  it("returns an empty map for no entries", () => {
    expect(computeRecencyBoosts([]).size).toBe(0);
  });

  it("gives a lone entry the maximum boost", () => {
    const boosts = computeRecencyBoosts([{ cp: 0x41 }]);
    expect(boosts.get("0041")).toBe(1000);
  });

  it("decays linearly from 1000 (most recent) to 500 (oldest)", () => {
    const boosts = computeRecencyBoosts([
      { cp: 0x41 },
      { cp: 0x42 },
      { cp: 0x43 },
    ]);
    expect(boosts.get("0041")).toBe(1000);
    expect(boosts.get("0042")).toBe(750);
    expect(boosts.get("0043")).toBe(500);
  });

  it("keys multi-codepoint entries by their dash-joined sequence", () => {
    const boosts = computeRecencyBoosts([
      { cp: 0x1f1eb, cps: [0x1f1eb, 0x1f1f7] },
    ]);
    expect(boosts.get("1F1EB-1F1F7")).toBe(1000);
  });
});
