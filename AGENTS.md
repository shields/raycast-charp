# AGENTS.md

This file provides guidance to AI agents when working with code in this
repository.

## What this is

Charp is a Raycast extension (macOS only) that provides a Unicode character
picker with fuzzy search, popularity ranking, and keyboard layout awareness.
Single command: "Pick Character" — search, select, and paste Unicode characters.

## Commands

```bash
make test           # run tests (vitest)
make lint           # eslint + prettier --check
make fmt            # prettier --write
make generate       # regenerate src/characters.json from Unicode data files
make build          # generate + ray build
make dev            # generate + ray develop (live reload)
```

Run a single test file:

```bash
npx vitest run test/keyboard.test.ts
```

Run tests matching a pattern:

```bash
npx vitest run -t "maps dead key"
```

## Architecture

**Data pipeline** (`scripts/generate-data.ts`): Downloads UCD files (Unicode
17.0) into `data/`, parses them, computes popularity scores, and writes
`src/characters.json` (~200k entries, CJK excluded). The JSON is imported at
runtime via the thin `src/characters.ts` re-export. The `data/` directory is a
download cache — delete it to force re-download.

**Keyboard layout** (`src/keyboard.ts`): Reads the user's active macOS
`.keylayout` XML file (user-installed layouts only, not system `.dat` bundles).
`buildKeystrokeMap()` parses the XML and produces a
`Map<string, KeystrokeDescription>` mapping characters to their keystroke
labels, including dead key sequences (e.g., `⌥E E` → `é`). This is the most
complex module — it handles modifier layers (0–5), action/state machines for
dead keys, and derives key labels from the base layer so they match the user's
actual keyboard (AZERTY, QWERTZ, etc.).

**Ranking** (`src/pick-character.tsx`): Three-tier ordering: recently used (with
linear decay scoring from `src/recency.ts` via Raycast LocalStorage) >
keyboard-accessible characters > static popularity order from the generated
data.

**Search scoring** (`scoreMatch` in `src/search.ts`): Weakest-link scoring
across query terms with five tiers (100/80/60/40/20). Results are bucketed by
score tier, preserving rank order within each bucket.

**Non-BMP character safety**: Raycast's Swift JSON parser crashes on non-BMP
characters (U+10000+, i.e. emoji) in the render tree
([raycast/extensions#17053](https://github.com/raycast/extensions/issues/17053)).
Both raw UTF-8 and `\uD83D\uDCAF` surrogate-pair escapes are rejected. Display
functions handle this at different levels:

- `characterDisplay()` — for plain-text props (title, accessories). Returns
  `U+XXXX` for non-BMP characters.
- `svgCharacterImage()` (`src/svg.ts`) — for the detail panel header. Renders
  characters as SVG `<text>` elements using XML character references, then
  base64-encodes the SVG as a markdown data URI image. This bypasses the JSON
  parser entirely (the data URI is pure ASCII) and goes through CoreGraphics
  text shaping, which correctly applies variation selectors. A zero-width space
  before the image tag forces inline layout (left-aligned).
- Variation selector presentation (text U+FE0E vs emoji U+FE0F) uses inline text
  for BMP characters. Non-BMP characters cannot show variation comparisons
  because the markdown renderer does not combine HTML entities with following
  variation selectors into a sequence.

The "Copy Character" action uses a callback (`Clipboard.copy()` at runtime)
instead of `Action.CopyToClipboard` to avoid placing the raw character in the
render tree.

## Conventions

- TypeScript with strict mode and `noUncheckedIndexedAccess`
- ESNext target, Bundler module resolution (the extension is esbuild-bundled by
  `ray build`; Bundler also permits `import.meta`, which NodeNext rejects unless
  the package is `"type": "module"`)
- `.js` extensions in imports (a NodeNext-era convention, still used and
  resolved under Bundler)
- Prettier with `proseWrap: always`
- Lefthook pre-commit hook formats `.md` files with prettier
- `src/characters.ts` and `src/characters.json` are generated — edit the
  generation script instead
