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
import { svgCharacterImage } from "./svg.js";
import { entryCodePoints, entryKey } from "./types.js";
import type { CharacterEntry, KeystrokeDescription } from "./types.js";
import { variants } from "./variants.js";

function formatCodePoint(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** Used for variant display in the detail panel markdown. */
function formatHTMLEntity(cp: number): string {
  return `&#x${cp.toString(16).toUpperCase()};`;
}

/** Render-tree-safe display for plain-text props. Non-BMP characters
 * crash Raycast's Swift JSON parser (raycast/extensions#17053). */
function characterDisplay(entry: CharacterEntry): string {
  if (entry.cps) {
    return `${formatCodePoint(entry.cps[0]!)}…`;
  }
  const cp = entry.cp;
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) {
    return `[${formatCodePoint(cp)}]`;
  }
  if (cp > 0xffff) {
    return formatCodePoint(cp);
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
      const key = entryKey(char);
      if (boosts.has(key)) {
        recent.push(char);
      } else if (!char.cps && keyboardCps.has(char.cp)) {
        withKey.push(char);
      } else {
        rest.push(char);
      }
    }

    recent.sort(
      (a, b) => (boosts.get(entryKey(b)) ?? 0) - (boosts.get(entryKey(a)) ?? 0),
    );

    return [...recent, ...withKey, ...rest];
  }, [recentEntries, keyboardCps]);

  const visibleCharacters = useMemo(
    () => searchCharacters(rankedCharacters, searchText),
    [searchText, rankedCharacters],
  );

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
          key={entryKey(entry)}
          entry={entry}
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

function CharacterItem({
  entry,
  keystroke,
  onSelect,
}: {
  entry: CharacterEntry;
  keystroke: KeystrokeDescription | undefined;
  onSelect: (entry: CharacterEntry) => Promise<void>;
}) {
  const cps = entryCodePoints(entry);
  const display = characterDisplay(entry);
  const codePoints = cps.map(formatCodePoint);
  const codePointStr = codePoints.join("\u00A0");

  const accessories: List.Item.Accessory[] = keystroke
    ? [{ tag: keystroke.label, tooltip: `Type: ${keystroke.label}` }]
    : [];

  const isControl =
    !entry.cps && (entry.cp < 0x20 || (entry.cp >= 0x7f && entry.cp < 0xa0));
  const imageCps = entry.vs ? [...cps, 0xfe0f] : cps;
  const lines = [
    isControl ? `# [${codePointStr}]` : svgCharacterImage(imageCps),
    "",
    entry.name,
    "",
    `\`${codePointStr}\``,
  ];
  // Non-BMP characters use HTML entities to avoid the Raycast JSON crash,
  // but HTML entities don't form variation sequences with a following selector.
  if (entry.vs && entry.cp <= 0xffff) {
    const ch = String.fromCodePoint(entry.cp);
    lines.push("", `Text: ${ch}\uFE0E \u00A0 Emoji: ${ch}\uFE0F`);
  }

  // Show skin tone / modifier variants as HTML entities. Adjacent entities
  // form complete emoji sequences (unlike variation selectors which don't
  // combine with a preceding entity). Text renders inline correctly,
  // whereas SVG images don't flow with the label text.
  const key = entryKey(entry);
  const entryVariants = variants[key];
  if (entryVariants && entryVariants.length > 0) {
    const variantText = entryVariants
      .map((v) => {
        const refs = v.cps.map(formatHTMLEntity).join("");
        return `${refs} ${v.label}`;
      })
      .join(" \u00A0 ");
    lines.push("", "**Variants**", "", variantText);
  }

  if (entry.keywords.length > 0) {
    lines.push("", entry.keywords.join(", "));
  }
  if (keystroke) {
    lines.push("", `Keystroke: **${keystroke.label}**`);
  }
  const markdown = lines.join("\n");

  const charString = String.fromCodePoint(...cps);

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
              await Clipboard.copy(charString);
              await showHUD("Copied to Clipboard");
            }}
          />
          <Action.CopyToClipboard
            title="Copy Code Point"
            content={codePoints.join(" ")}
            shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
          />
        </ActionPanel>
      }
    />
  );
}
