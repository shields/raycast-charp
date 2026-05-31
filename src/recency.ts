// SPDX-FileCopyrightText: Copyright © 2026 Michael Shields
// SPDX-License-Identifier: MIT

import { LocalStorage } from "@raycast/api";
import { entryKey } from "./types.js";
import type { CharacterEntry, RecentEntry } from "./types.js";

const STORAGE_KEY = "recent-characters";
const MAX_ENTRIES = 200;

export async function getRecentCharacters(): Promise<RecentEntry[]> {
  const raw = await LocalStorage.getItem<string>(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as RecentEntry[];
  } catch {
    return [];
  }
}

export async function recordCharacterUse(entry: CharacterEntry): Promise<void> {
  const entries = await getRecentCharacters();
  const key = entryKey(entry);

  // Remove existing entry for this character, then prepend
  const filtered = entries.filter((e) => entryKey(e) !== key);
  filtered.unshift({
    cp: entry.cp,
    ...(entry.cps && { cps: entry.cps }),
  });

  // Trim to max size
  if (filtered.length > MAX_ENTRIES) {
    filtered.length = MAX_ENTRIES;
  }

  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}

/**
 * Returns a map of recently-used entries with a recency boost score.
 * Most recent = highest boost. Score range: 1000 down to ~500.
 * Keys are entry keys (stringified cp or dash-joined cps).
 */
export function computeRecencyBoosts(
  entries: RecentEntry[],
): Map<string, number> {
  const boosts = new Map<string, number>();
  const count = entries.length;
  for (let i = 0; i < count; i++) {
    const entry = entries[i]!;
    // Linear decay: most recent gets 1000, oldest gets ~500
    const boost = 1000 - (i / Math.max(count - 1, 1)) * 500;
    boosts.set(entryKey(entry), boost);
  }
  return boosts;
}
