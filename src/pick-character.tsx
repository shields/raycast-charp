import {
  Action,
  ActionPanel,
  Clipboard,
  Icon,
  List,
  showHUD,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useCallback, useMemo, useState } from "react";
import { characters } from "./characters.js";
import { loadKeystrokeMap } from "./keyboard.js";
import {
  computeRecencyBoosts,
  getRecentCharacters,
  recordCharacterUse,
} from "./recency.js";
import type { CharacterEntry, KeystrokeDescription } from "./types.js";

const MAX_RESULTS = 200;

function formatCodePoint(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}

function formatHTMLEntity(cp: number): string {
  return `&#x${cp.toString(16).toUpperCase()};`;
}

function characterDisplay(cp: number): string {
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) {
    return `[${formatCodePoint(cp)}]`;
  }
  return String.fromCodePoint(cp);
}

/**
 * Score how well an entry matches the query terms. Higher = better match.
 * Returns 0 for no match.
 *
 * Scoring tiers:
 *   100 — the character itself equals the full query
 *    80 — a name word exactly equals a term
 *    60 — a name word starts with a term
 *    40 — a keyword word starts with a term
 *    20 — substring match in name or keywords
 *
 * Final score = minimum term score (weakest link), so all terms must match.
 */
function scoreMatch(entry: CharacterEntry, terms: string[]): number {
  const nameWords = entry.name.toLowerCase().split(/[\s-]+/);
  const char = String.fromCodePoint(entry.cp);
  const hex = entry.cp.toString(16).padStart(4, "0");

  let minScore = Infinity;

  for (const term of terms) {
    let termScore = 0;

    // Exact character match
    if (char.toLowerCase() === term) {
      termScore = 100;
    }

    // Exact name word match
    if (termScore < 80 && nameWords.includes(term)) {
      termScore = 80;
    }

    // Name word starts with term
    if (termScore < 60 && nameWords.some((w) => w.startsWith(term))) {
      termScore = 60;
    }

    // Keyword word starts with term
    if (
      termScore < 40 &&
      entry.keywords.some((kw) =>
        kw
          .toLowerCase()
          .split(/[\s-]+/)
          .some((w) => w.startsWith(term)),
      )
    ) {
      termScore = 40;
    }

    // Substring match in name
    if (termScore < 20 && entry.name.toLowerCase().includes(term)) {
      termScore = 20;
    }

    // Substring match in keywords
    if (
      termScore < 20 &&
      entry.keywords.some((kw) => kw.toLowerCase().includes(term))
    ) {
      termScore = 20;
    }

    // Hex code point match
    if (termScore < 20 && hex.includes(term)) {
      termScore = 20;
    }

    if (termScore === 0) return 0;
    minScore = Math.min(minScore, termScore);
  }

  return minScore;
}

export default function PickCharacter() {
  const [searchText, setSearchText] = useState("");

  const { data: recentEntries, revalidate: revalidateRecency } =
    usePromise(getRecentCharacters);

  const { data: keystrokeMap } = usePromise(loadKeystrokeMap);
  const resolvedKeystrokeMap =
    keystrokeMap ?? new Map<string, KeystrokeDescription>();

  const keyboardCps = useMemo(() => {
    const cps = new Set<number>();
    for (const char of resolvedKeystrokeMap.keys()) {
      const cp = char.codePointAt(0);
      if (cp !== undefined) cps.add(cp);
    }
    return cps;
  }, [resolvedKeystrokeMap]);

  // Pre-sort once: recent > keyboard-accessible > popularity
  const rankedCharacters = useMemo(() => {
    if (!recentEntries) return characters;

    const boosts = computeRecencyBoosts(recentEntries);

    const recent: CharacterEntry[] = [];
    const withKey: CharacterEntry[] = [];
    const rest: CharacterEntry[] = [];

    for (const char of characters) {
      if (boosts.has(char.cp)) {
        recent.push(char);
      } else if (keyboardCps.has(char.cp)) {
        withKey.push(char);
      } else {
        rest.push(char);
      }
    }

    recent.sort((a, b) => (boosts.get(b.cp) ?? 0) - (boosts.get(a.cp) ?? 0));

    return [...recent, ...withKey, ...rest];
  }, [recentEntries, keyboardCps]);

  // Filter, score, and cap results
  const visibleCharacters = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (query === "") {
      return rankedCharacters.slice(0, MAX_RESULTS);
    }

    const terms = query.split(/\s+/);

    // Collect matches in score buckets. Within each bucket the original
    // rank order is preserved, so we can flatten without sorting.
    const buckets: CharacterEntry[][] = [[], [], [], [], []];
    const tierIndex = (s: number) =>
      s >= 100 ? 0 : s >= 80 ? 1 : s >= 60 ? 2 : s >= 40 ? 3 : 4;

    for (const entry of rankedCharacters) {
      const score = scoreMatch(entry, terms);
      if (score > 0) {
        buckets[tierIndex(score)]!.push(entry);
      }
    }

    // Flatten buckets in order — within each bucket, original rank is preserved
    const results: CharacterEntry[] = [];
    for (const bucket of buckets) {
      for (const entry of bucket) {
        results.push(entry);
        if (results.length >= MAX_RESULTS) return results;
      }
    }
    return results;
  }, [searchText, rankedCharacters]);

  const handleSelect = useCallback(
    async (entry: CharacterEntry) => {
      const char = String.fromCodePoint(entry.cp);
      await recordCharacterUse(entry.cp);
      revalidateRecency();
      // Paste last: it closes the Raycast window and may suspend the process
      await Clipboard.paste(char);
      await showHUD(`Pasted ${char}`);
    },
    [revalidateRecency],
  );

  return (
    <List
      searchBarPlaceholder="Search Unicode characters…"
      isLoading={!recentEntries || !keystrokeMap}
      filtering={false}
      onSearchTextChange={setSearchText}
      throttle
    >
      {visibleCharacters.map((entry) => (
        <CharacterItem
          key={entry.cp}
          entry={entry}
          keystroke={resolvedKeystrokeMap.get(String.fromCodePoint(entry.cp))}
          onSelect={handleSelect}
        />
      ))}
    </List>
  );
}

function CharacterItem({
  entry,
  keystroke,
  onSelect,
}: {
  entry: CharacterEntry;
  keystroke: KeystrokeDescription | undefined;
  onSelect: (entry: CharacterEntry) => Promise<void>;
}) {
  const char = String.fromCodePoint(entry.cp);
  const display = characterDisplay(entry.cp);
  const codePoint = formatCodePoint(entry.cp);
  const htmlEntity = formatHTMLEntity(entry.cp);

  const accessories: List.Item.Accessory[] = [];
  if (keystroke) {
    accessories.push({
      tag: keystroke.label,
      tooltip: `Type: ${keystroke.label}`,
    });
  }
  accessories.push({ tag: codePoint });

  return (
    <List.Item
      title={`${display}  ${entry.name}`}
      accessories={accessories}
      actions={
        <ActionPanel>
          <Action
            title="Paste Character"
            icon={Icon.Clipboard}
            onAction={() => void onSelect(entry)}
          />
          <Action.CopyToClipboard
            title="Copy Character"
            content={char}
            shortcut={{ modifiers: ["cmd"], key: "c" }}
          />
          <Action.CopyToClipboard
            title="Copy Code Point"
            content={codePoint}
            shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
          />
          <Action.CopyToClipboard
            title="Copy HTML Entity"
            content={htmlEntity}
            shortcut={{ modifiers: ["cmd", "shift"], key: "h" }}
          />
        </ActionPanel>
      }
    />
  );
}
