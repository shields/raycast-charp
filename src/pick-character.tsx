// SPDX-FileCopyrightText: Copyright © 2026 Michael Shields
// SPDX-License-Identifier: MIT

import {
  Action,
  ActionPanel,
  Clipboard,
  environment,
  Icon,
  Keyboard,
  List,
  showHUD,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { categoryLabel } from "./categories.js";
import { characters } from "./characters.js";
import { loadKeystrokeMap } from "./keyboard.js";
import {
  computeRecencyBoosts,
  getRecentCharacters,
  recordCharacterUse,
} from "./recency.js";
import { searchCharacters } from "./search.js";
import { svgCharacterImage } from "./svg.js";
import { entryCodePoints, entryKey } from "./types.js";
import type { CharacterEntry, KeystrokeDescription } from "./types.js";
import { variants } from "./variants.js";

function formatCodePoint(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** Single code point → Unicode name, used to label the constituents of a
 * multi-code-point sequence. Built once from the single-code-point entries;
 * sequence entries are skipped so they never shadow a real character. */
const nameByCodePoint = new Map<number, string>();
for (const character of characters) {
  if (!character.cps) nameByCodePoint.set(character.cp, character.name);
}

/** Markdown for the code point breakdown shown beneath the name. A lone code
 * point renders inline; a sequence lists each code point and its name on its
 * own line, so a combination like PIRATE FLAG shows its parts (waving black
 * flag, ZWJ, skull and crossbones, …) rather than a run of hex. */
function codePointDetail(cps: number[]): string {
  if (cps.length === 1) {
    return `\`${formatCodePoint(cps[0]!)}\``;
  }
  const labels = cps.map(formatCodePoint);
  const width = Math.max(...labels.map((label) => label.length));
  const body = cps
    .map((cp, i) => {
      const name = nameByCodePoint.get(cp);
      return name ? `${labels[i]!.padEnd(width)}  ${name}` : labels[i]!;
    })
    .join("\n");
  return ["```", body, "```"].join("\n");
}

function isControlCodePoint(cp: number): boolean {
  return cp < 0x20 || (cp >= 0x7f && cp < 0xa0);
}

export function characterDisplay(entry: CharacterEntry): string {
  if (entry.cps) {
    if (entry.cps.every((cp) => !isControlCodePoint(cp))) {
      return String.fromCodePoint(...entry.cps);
    }
    return `${formatCodePoint(entry.cps[0]!)}…`;
  }
  const cp = entry.cp;
  if (isControlCodePoint(cp)) {
    return `[${formatCodePoint(cp)}]`;
  }
  return String.fromCodePoint(cp);
}

export default function PickCharacter() {
  const [searchText, setSearchText] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
      const key = entryKey(char);
      if (boosts.has(key)) {
        recent.push(char);
      } else if (!char.cps && keyboardCps.has(char.cp)) {
        withKey.push(char);
      } else {
        rest.push(char);
      }
    }

    // Every entry in `recent` has a key in `boosts` (that is why it was pushed
    // there), so the lookups are always present.
    recent.sort((a, b) => boosts.get(entryKey(b))! - boosts.get(entryKey(a))!);

    return [...recent, ...withKey, ...rest];
  }, [recentEntries, keyboardCps]);

  const visibleCharacters = useMemo(() => {
    const started = performance.now();
    const results = searchCharacters(rankedCharacters, searchText, keyboardCps);
    if (environment.isDevelopment) {
      console.log(
        "[Charp] search computed",
        JSON.stringify({
          query: searchText,
          results: results.length,
          milliseconds: Math.round(performance.now() - started),
        }),
      );
    }
    return results;
  }, [searchText, rankedCharacters, keyboardCps]);

  const selectedEntry = visibleCharacters.find(
    (entry) => entryKey(entry) === selectedId,
  );
  if (selectedId !== null && !selectedEntry) setSelectedId(null);
  const previewEntry = selectedEntry ?? visibleCharacters[0];
  const selectedItemId = previewEntry ? entryKey(previewEntry) : undefined;

  const handleSearchTextChange = useCallback((text: string) => {
    if (environment.isDevelopment) {
      console.log("[Charp] search input", JSON.stringify(text));
    }
    setSearchText(text);
  }, []);

  useEffect(() => {
    if (environment.isDevelopment) {
      console.log(
        "[Charp] search render",
        JSON.stringify({
          query: searchText,
          results: visibleCharacters.length,
          first: visibleCharacters[0]?.name,
          selectedItemId,
          characters: characters.length,
          recencyLoaded: recentEntries !== undefined,
          keyboardLoaded: keystrokeMap !== undefined,
        }),
      );
    }
  }, [
    searchText,
    visibleCharacters,
    selectedItemId,
    recentEntries,
    keystrokeMap,
  ]);

  const handleSelect = useCallback(
    async (entry: CharacterEntry) => {
      const cps = entryCodePoints(entry);
      const char = String.fromCodePoint(...cps);
      await recordCharacterUse(entry);
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
      onSearchTextChange={handleSearchTextChange}
      {...(selectedItemId !== undefined && { selectedItemId })}
      onSelectionChange={setSelectedId}
      isShowingDetail
    >
      <List.EmptyView
        title="No Characters Found"
        description="Try a different search term"
      />
      {visibleCharacters.map((entry) => (
        <CharacterItem
          key={entryKey(entry)}
          entry={entry}
          isSelected={entryKey(entry) === selectedItemId}
          keystroke={
            entry.cps
              ? undefined
              : resolvedKeystrokeMap.get(String.fromCodePoint(entry.cp))
          }
          onSelect={handleSelect}
        />
      ))}
    </List>
  );
}

function characterMarkdown(
  entry: CharacterEntry,
  keystroke: KeystrokeDescription | undefined,
): string {
  const cps = entryCodePoints(entry);
  const codePointStr = cps.map(formatCodePoint).join("\u00A0");
  const isControl = !entry.cps && isControlCodePoint(entry.cp);
  const imageCps = entry.vs ? [...cps, 0xfe0f] : cps;
  const lines = [
    isControl ? `# [${codePointStr}]` : svgCharacterImage(imageCps),
    "",
    entry.name,
    "",
    codePointDetail(cps),
    "",
    categoryLabel(entry.cat),
  ];
  if (entry.vs) {
    const ch = String.fromCodePoint(entry.cp);
    lines.push("", `Text: ${ch}\uFE0E \u00A0 Emoji: ${ch}\uFE0F`);
  }

  const key = entryKey(entry);
  const entryVariants = variants[key];
  if (entryVariants && entryVariants.length > 0) {
    const variantText = entryVariants
      .map((v) => `${String.fromCodePoint(...v.cps)} ${v.label}`)
      .join(" \u00A0 ");
    lines.push("", "**Variants**", "", variantText);
  }

  if (entry.keywords.length > 0) {
    lines.push("", entry.keywords.join(", "));
  }
  if (keystroke) {
    lines.push("", `Keystroke: **${keystroke.label}**`);
  }
  return lines.join("\n");
}

export const CharacterItem = memo(function CharacterItem({
  entry,
  keystroke,
  onSelect,
  isSelected,
}: {
  entry: CharacterEntry;
  keystroke: KeystrokeDescription | undefined;
  onSelect: (entry: CharacterEntry) => Promise<void>;
  isSelected: boolean;
}) {
  const cps = entryCodePoints(entry);
  const display = characterDisplay(entry);
  const codePoints = cps.map(formatCodePoint);
  const accessories: List.Item.Accessory[] = keystroke
    ? [{ tag: keystroke.label, tooltip: `Type: ${keystroke.label}` }]
    : [];

  const charString = String.fromCodePoint(...cps);

  return (
    <List.Item
      id={entryKey(entry)}
      title={`${display}  ${entry.name}`}
      accessories={accessories}
      detail={
        isSelected ? (
          <List.Item.Detail markdown={characterMarkdown(entry, keystroke)} />
        ) : undefined
      }
      actions={
        <ActionPanel>
          <Action
            title="Paste Character"
            icon={Icon.Clipboard}
            onAction={() => void onSelect(entry)}
          />
          <Action.CopyToClipboard
            title="Copy Character"
            content={charString}
            shortcut={{ modifiers: ["cmd"], key: "c" }}
          />
          <Action.CopyToClipboard
            title="Copy Code Point"
            content={codePoints.join(" ")}
            shortcut={
              // Raycast's Common.Copy is Cmd+Shift+C, leaving Cmd+C for Copy Character.
              // https://developers.raycast.com/api-reference/keyboard#keyboard.shortcut.common
              Keyboard.Shortcut.Common.Copy
            }
          />
        </ActionPanel>
      }
    />
  );
});
