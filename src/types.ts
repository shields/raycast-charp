// SPDX-FileCopyrightText: Copyright © 2026 Michael Shields
// SPDX-License-Identifier: MIT

export interface CharacterEntry {
  /** Unicode code point (first code point for multi-codepoint sequences) */
  cp: number;
  /** Full code point sequence (present only for multi-codepoint entries) */
  cps?: number[];
  /** Primary Unicode name */
  name: string;
  /** Aliases, abbreviations, block name — used as search keywords */
  keywords: string[];
  /** General category (Lu, Ll, So, etc.) */
  cat: string;
  /** Has emoji variation sequences (text U+FE0E / emoji U+FE0F) */
  vs?: true;
}

export interface EmojiVariant {
  /** Full code point sequence for this variant */
  cps: number[];
  /** Short label like "light skin tone" or "man" */
  label: string;
}

export function entryCodePoints(entry: CharacterEntry): number[] {
  return entry.cps ?? [entry.cp];
}

function hexCp(cp: number): string {
  return cp.toString(16).toUpperCase().padStart(4, "0");
}

export function entryKey(entry: { cp: number; cps?: number[] }): string {
  return entry.cps ? entry.cps.map(hexCp).join("-") : hexCp(entry.cp);
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
  cps?: number[];
}
