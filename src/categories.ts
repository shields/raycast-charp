// SPDX-FileCopyrightText: Copyright © 2026 Michael Shields
// SPDX-License-Identifier: MIT

/** Unicode general-category abbreviations → human-readable names, in the
 * display form (spaces, not the underscores of PropertyValueAliases.txt). The
 * set is fixed by the Unicode standard, so it lives here as a table rather than
 * being threaded through the generated data. */
export const CATEGORY_NAMES: Record<string, string> = {
  Lu: "Uppercase Letter",
  Ll: "Lowercase Letter",
  Lt: "Titlecase Letter",
  Lm: "Modifier Letter",
  Lo: "Other Letter",
  Mn: "Nonspacing Mark",
  Mc: "Spacing Mark",
  Me: "Enclosing Mark",
  Nd: "Decimal Number",
  Nl: "Letter Number",
  No: "Other Number",
  Pc: "Connector Punctuation",
  Pd: "Dash Punctuation",
  Ps: "Open Punctuation",
  Pe: "Close Punctuation",
  Pi: "Initial Punctuation",
  Pf: "Final Punctuation",
  Po: "Other Punctuation",
  Sm: "Math Symbol",
  Sc: "Currency Symbol",
  Sk: "Modifier Symbol",
  So: "Other Symbol",
  Zs: "Space Separator",
  Zl: "Line Separator",
  Zp: "Paragraph Separator",
  Cc: "Control",
  Cf: "Format",
  Cs: "Surrogate",
  Co: "Private Use",
  Cn: "Unassigned",
};

/** "Ll" → "Lowercase Letter (Ll)". Falls back to the bare abbreviation for an
 * unknown code; the completeness test in test/categories.test.ts guards against
 * any category in the data lacking a name. */
export function categoryLabel(cat: string): string {
  const name = CATEGORY_NAMES[cat];
  return name ? `${name} (${cat})` : cat;
}
