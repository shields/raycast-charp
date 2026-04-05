# AGENTS.md

This file provides guidance to AI agents when working with code in
this repository.

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

**Search scoring** (`scoreMatch` in `src/pick-character.tsx`): Weakest-link
scoring across query terms with five tiers (100/80/60/40/20). Results are
bucketed by score tier, preserving rank order within each bucket.

## Conventions

- TypeScript with strict mode and `noUncheckedIndexedAccess`
- ESNext target, NodeNext module resolution
- `.js` extensions in imports (required by NodeNext)
- Prettier with `proseWrap: always`
- Lefthook pre-commit hook formats `.md` files with prettier
- `src/characters.ts` and `src/characters.json` are generated — edit the
  generation script instead
