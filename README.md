# Charp — Character Picker

A [Raycast](https://raycast.com) extension for finding and inserting Unicode
characters.

## Features

- **Fuzzy, word-aware search** — match on Unicode names, aliases, block names,
  emoji keywords, or hex code points. `right arrow`, `→`, and `2192` all find
  `→ RIGHTWARDS ARROW`.
- **Smart ranking** — recently used characters first, then characters your
  active keyboard layout can type, then a popularity order learned from
  real-world web-text frequency. The characters you reach for surface to the top
  over time.
- **Keyboard layout awareness** — for characters reachable on your installed
  macOS layout, Charp shows the keystroke (e.g. `⌥E E` → `é`), including dead
  key sequences.
- **Emoji, variants, and sequences** — skin-tone and gender variants, country
  flags, keycaps, and ZWJ sequences, plus text/emoji presentation comparison
  (U+FE0E vs U+FE0F).
- **Detail panel** — large character preview, official name, code point(s),
  aliases/keywords, and the keystroke to type it.

## Requirements

- macOS with [Raycast](https://raycast.com) installed
- [Node.js](https://nodejs.org) 22+ and npm (for building from source)

## Installation

Charp is not published to the Raycast Store; build and import it locally.

```bash
git clone https://github.com/shields/raycast-charp.git
cd raycast-charp
npm install
make dev          # generates data, then runs `ray develop` with live reload
```

`make dev` registers the extension with Raycast and reloads on changes. To
produce a standalone build instead, run `make build`.

The first run downloads the Unicode data files and a web-frequency table (see
[Data](#data-and-licensing)) and generates `src/characters.json`; this takes a
few seconds.

## Usage

Open Raycast and run **Pick Character**, then start typing. Select a result to
act on it:

| Action          | Shortcut | Result                                      |
| --------------- | -------- | ------------------------------------------- |
| Paste Character | `↵`      | Pastes the character into the frontmost app |
| Copy Character  | `⌘C`     | Copies the character to the clipboard       |
| Copy Code Point | `⇧⌘C`    | Copies the code point(s), e.g. `U+2192`     |

Searching by symbol works too: paste or type `©`, `½`, or `→` directly to find
that character.

## How it works

The runtime is a single Raycast `view` command (`src/pick-character.tsx`) backed
by a generated character database and a handful of focused modules.

- **Data pipeline** (`scripts/generate-data.ts`) downloads the Unicode Character
  Database and emoji data, parses it, and scores each character's popularity
  from real web-text frequency (the FineFreq corpus), falling back to
  block/category heuristics for characters the corpus rarely sees. Compatibility
  characters that Unicode normalization hides from FineFreq (™, ½, …) are ranked
  from a non-normalized corpus (Leipzig) calibrated onto the same scale — see
  [docs/architecture.md](docs/architecture.md). It writes `src/characters.json`
  (~51k entries; CJK and Tangut ideographs are excluded because their
  placeholder names carry no search value), imported at runtime via the thin
  `src/characters.ts` re-export.
- **Search** (`src/search.ts`) tokenizes the query and each name/keyword the
  same way, then scores matches with weakest-link semantics across six tiers
  (exact character → exact name word → name prefix → keyword prefix →
  substring/hex → fuzzy/typo). Results are ordered by tier bucket, then by how
  completely the query covers each name (so `←` LEFTWARDS ARROW beats `↔` LEFT
  RIGHT ARROW for "left arrow"), then by input rank. The fuzzy tier is a
  fallback: it only runs when a query otherwise matches nothing (so "letf arrow"
  still finds left arrows).
- **Ranking** (`src/pick-character.tsx`) orders results in three tiers: recently
  used (with linear decay scoring from `src/recency.ts`, persisted via Raycast
  `LocalStorage`) > keyboard-accessible characters > the static popularity order
  from the generated data.
- **Keyboard layout** (`src/keyboard.ts`) reads your active macOS `.keylayout`
  XML file and builds a map from characters to keystroke labels, handling
  modifier layers and dead key state machines so the labels match your actual
  keyboard.
- **Non-BMP rendering** (`src/svg.ts`) sidesteps a Raycast bug where the Swift
  JSON parser crashes on characters above U+FFFF (emoji): the detail header
  renders each character as an SVG `<text>` element using XML character
  references, base64-encoded into a pure-ASCII data URI. Plain-text props fall
  back to `U+XXXX` labels for non-BMP characters.

For a deeper tour of the architecture, see
[docs/architecture.md](docs/architecture.md).

## Development

```bash
make dev          # generate data + `ray develop` (live reload)
make build        # generate data + `ray build`
make test         # run the vitest suite
make lint         # eslint + prettier --check
make fmt          # prettier --write
make typecheck    # tsc --noEmit
make check        # lint + typecheck + test
make generate     # regenerate src/characters.json from Unicode + FineFreq data
make leipzig      # refresh src/leipzig-freq.json from the Leipzig corpora (~0.5GB)
```

Run a single test file or pattern:

```bash
npx vitest run test/keyboard.test.ts
npx vitest run -t "maps dead key"
```

`src/characters.{ts,json}` and `src/variants.{ts,json}` are generated by
`scripts/generate-data.ts` and committed, so a fresh clone builds without
network access. Regenerate them with `make generate` rather than editing them by
hand; generation is deterministic, so it produces no diff unless the source data
or the generator changes. The `data/` directory is a download cache for the raw
Unicode and FineFreq files; delete it to force a re-download.

`src/leipzig-freq.json` is also generated and committed, but by a separate step
(`make leipzig`), because it requires a ~0.5GB corpus download. `make generate`
consumes the committed result, so normal builds never touch the Leipzig corpora.

The repository uses a Lefthook pre-commit hook that formats Markdown with
Prettier and runs the test suite with coverage.

## Project structure

```
src/
  pick-character.tsx   Raycast command: search, rank, render, actions
  search.ts            query tokenization and match scoring
  keyboard.ts          parse the active .keylayout into keystroke labels
  recency.ts           recently-used tracking and recency boosts
  svg.ts               SVG/data-URI rendering for non-BMP characters
  types.ts             shared types and code-point helpers
  characters.{ts,json} generated character database (committed)
  variants.{ts,json}   generated emoji-variant data (committed)
  leipzig-freq.json    generated code-point counts for folded chars (committed)
scripts/
  generate-data.ts     download + parse UCD/emoji/FineFreq → generated artifacts
  compute-leipzig-freq.ts  count Leipzig corpora → src/leipzig-freq.json
test/                  vitest suite
data/                  cached Unicode + FineFreq + Leipzig files (git-ignored)
```

## Data and licensing

The character database is generated from the
[Unicode Character Database](https://www.unicode.org/ucd/) (Unicode 17.0) and
the [Unicode emoji data files](https://www.unicode.org/Public/17.0.0/emoji/)
(Emoji 17.0), and the processed result is committed as `src/characters.json` and
`src/variants.json`. That derived data is redistributed under the
[Unicode License V3](https://www.unicode.org/license.txt); see
[`NOTICE`](NOTICE) for the required copyright and permission notice.

Character popularity is ranked using
[FineFreq](https://huggingface.co/datasets/lgi2p/finefreq), per-code-point
frequency counts over the FineWeb/FineWeb2 web corpora (built from Common
Crawl), used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Only the resulting character ordering is embedded in `src/characters.json`; the
dataset itself is not redistributed. See [`NOTICE`](NOTICE) for attribution.

Compatibility characters that Unicode normalization removes from FineFreq are
ranked from the [Leipzig Corpora Collection](https://wortschatz.uni-leipzig.de),
also under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); only the
derived per-code-point counts are committed (`src/leipzig-freq.json`). See
[`NOTICE`](NOTICE) for attribution.

This extension's own code is licensed under the MIT License.
