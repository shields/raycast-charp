import { LocalStorage } from "@raycast/api";
import type { RecentEntry } from "./types.js";

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

export async function recordCharacterUse(cp: number): Promise<void> {
  const entries = await getRecentCharacters();
  const now = Date.now();

  // Remove existing entry for this character, then prepend
  const filtered = entries.filter((e) => e.cp !== cp);
  filtered.unshift({ cp, timestamp: now });

  // Trim to max size
  if (filtered.length > MAX_ENTRIES) {
    filtered.length = MAX_ENTRIES;
  }

  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}

/**
 * Returns a set of recently-used code points with a recency boost score.
 * Most recent = highest boost. Score range: 1000 down to ~500.
 */
export function computeRecencyBoosts(
  entries: RecentEntry[],
): Map<number, number> {
  const boosts = new Map<number, number>();
  const count = entries.length;
  for (let i = 0; i < count; i++) {
    const entry = entries[i]!;
    // Linear decay: most recent gets 1000, oldest gets ~500
    const boost = 1000 - (i / Math.max(count - 1, 1)) * 500;
    boosts.set(entry.cp, boost);
  }
  return boosts;
}
