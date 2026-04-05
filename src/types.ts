export interface CharacterEntry {
  /** Unicode code point */
  cp: number;
  /** Primary Unicode name */
  name: string;
  /** Aliases, abbreviations, block name — used as search keywords */
  keywords: string[];
  /** General category (Lu, Ll, So, etc.) */
  cat: string;
}

export interface KeystrokeDescription {
  /** Human-readable label like "⌥E then E" or "⌥S" or "⇧⌥S" */
  label: string;
  /** Modifier state */
  modifiers: string;
  /** For dead key sequences */
  deadKey?: { trigger: string; completion: string } | undefined;
}

export interface RecentEntry {
  cp: number;
  timestamp: number;
}
