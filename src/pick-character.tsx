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
import { searchCharacters } from "./search.js";
import type { CharacterEntry, KeystrokeDescription } from "./types.js";

function formatCodePoint(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}

function formatHTMLEntity(cp: number): string {
  return `&#x${cp.toString(16).toUpperCase()};`;
}

/** Render-tree-safe display for plain-text props. Non-BMP characters
 * crash Raycast's Swift JSON parser (raycast/extensions#17053). */
function characterDisplay(cp: number): string {
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) {
    return `[${formatCodePoint(cp)}]`;
  }
  if (cp > 0xffff) {
    return formatCodePoint(cp);
  }
  return String.fromCodePoint(cp);
}

/** Display for markdown, where HTML character references render as
 * glyphs without raw non-BMP bytes in the render tree JSON. */
function markdownDisplay(cp: number): string {
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) {
    return `[${formatCodePoint(cp)}]`;
  }
  if (cp > 0xffff) {
    return `&#x${cp.toString(16).toUpperCase()};`;
  }
  return String.fromCodePoint(cp);
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

  const visibleCharacters = useMemo(
    () => searchCharacters(rankedCharacters, searchText),
    [searchText, rankedCharacters],
  );

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
      isShowingDetail
    >
      <List.EmptyView
        title="No Characters Found"
        description="Try a different search term"
      />
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
  const display = characterDisplay(entry.cp);
  const codePoint = formatCodePoint(entry.cp);
  const htmlEntity = formatHTMLEntity(entry.cp);

  const accessories: List.Item.Accessory[] = keystroke
    ? [{ tag: keystroke.label, tooltip: `Type: ${keystroke.label}` }]
    : [];

  const lines = [
    `# ${markdownDisplay(entry.cp)}`,
    "",
    entry.name,
    "",
    `\`${codePoint}\`  \`${htmlEntity}\``,
  ];
  if (entry.keywords.length > 0) {
    lines.push("", entry.keywords.join(", "));
  }
  if (keystroke) {
    lines.push("", `Keystroke: **${keystroke.label}**`);
  }
  const markdown = lines.join("\n");

  return (
    <List.Item
      title={`${display}  ${entry.name}`}
      accessories={accessories}
      detail={<List.Item.Detail markdown={markdown} />}
      actions={
        <ActionPanel>
          <Action
            title="Paste Character"
            icon={Icon.Clipboard}
            onAction={() => void onSelect(entry)}
          />
          <Action
            title="Copy Character"
            icon={Icon.CopyClipboard}
            shortcut={{ modifiers: ["cmd"], key: "c" }}
            onAction={async () => {
              await Clipboard.copy(String.fromCodePoint(entry.cp));
              await showHUD("Copied to Clipboard");
            }}
          />
          <Action.CopyToClipboard
            title="Copy Code Point"
            content={codePoint}
            shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
          />
          <Action.CopyToClipboard
            // eslint-disable-next-line @raycast/prefer-title-case
            title="Copy HTML Entity"
            content={htmlEntity}
            shortcut={{ modifiers: ["cmd", "shift"], key: "h" }}
          />
        </ActionPanel>
      }
    />
  );
}
