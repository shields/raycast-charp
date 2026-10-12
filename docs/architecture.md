# Architecture

**Data pipeline** (`scripts/generate-data.ts`): Downloads UCD files (Unicode
17.0) and the FineFreq English web-frequency table into `data/`, parses them,
computes popularity scores, and writes `src/characters.json` (~51,000 entries;
CJK and Tangut ideographs excluded). The JSON is imported at runtime via the
thin `src/characters.ts` re-export. The `data/` directory is a download cache —
delete it to force re-download.

**Keyboard layout** (`src/keyboard.ts` and `swift/`): Raycast's Swift
integration builds and bundles a native helper that reads the active layout with
`TISCopyCurrentKeyboardLayoutInputSource` and translates physical keys with
`UCKeyTranslate`. macOS supplies translation data for both built-in layouts and
installed custom `.keylayout` files. Input methods use their underlying keyboard
layout; candidate composition is outside the map's scope. Unicode Hex Input
contributes direct keystrokes only; arbitrary hex-code entry is excluded.

The helper enumerates Shift, Option, Caps Lock, and their combinations, deriving
key labels from the unmodified layout and respecting ANSI, ISO, and JIS keyboard
geometry. It explores silent dead-key transitions in breadth-first order, so
shorter sequences and simpler modifiers win. Paths that insert extra text are
excluded. Repeated states are visited once to bound cycles. The emitted output
must be a single Unicode scalar to match a character database entry. The
TypeScript bridge loads the resulting character-to-keystroke map, including
sequences such as `⌥E E` → `é`. Native lookup errors propagate to Raycast's
error UI.

**Ranking** (`src/pick-character.tsx`): Three-tier ordering: recently used (with
linear decay scoring from `src/recency.ts` via Raycast LocalStorage) >
keyboard-accessible characters > static popularity order from the generated
data.

**Popularity scoring** (`computeScore` in `scripts/generate-data.ts`): The
static order baked into `src/characters.json` is driven by real web-text
frequency from FineFreq (the FineWeb / FineWeb2 derivative of Common Crawl),
log-scaled into a band that sits above every fallback, so any genuinely-used
character outranks an unobserved one — this is why a lowercase letter precedes
its uppercase pair (`a` before `A`). Characters the corpus does not meaningfully
see fall back to Unicode's semantic emoji order, then to per-block /
per-category heuristics. Ordinary typeable ASCII tops the raw frequency list but
is siphoned into the keyboard tier at runtime, leaving the special characters a
picker actually exists for to order by frequency among themselves.

FineFreq is NFKC-normalized, so it never sees the ~5,000 characters NFKC folds
away (™→TM, ½→1⁄2, …). To rank those, `make leipzig`
(`scripts/compute-leipzig-freq.ts`) counts code points in the **Leipzig
Corpora** — non-normalized text that does contain them — and commits
`src/leipzig-freq.json`. `calibrate()` then fits
`log10(FineFreq) = a·log10(Leipzig) + b` over the characters both corpora share
(R² ≈ 0.93) and projects each folded character's Leipzig count onto FineFreq's
scale, so ™ and ½ rank by real use and ℃ (rare in real text) self-demotes — no
hand-curated list. The styled forms NFKC also folds but no corpus can rank
(mathematical alphanumerics 𝐀, circled ①, full/half-width Ａ — detected by their
`<font>`/`<circle>`/`<wide>`/`<narrow>` decomposition) share one flat rank
(`FLAT_SCORE`) just below the data band.

**Search scoring** (`scoreMatch` in `src/search.ts`): Weakest-link scoring
across query terms — every term must match and an entry scores its weakest term.
Tiers: 100 (character equals term), 80 (name word equals term), 60 (name word
prefix), 40 (keyword prefix), 20 (substring/hex), and 10 (fuzzy: a name word
within Damerau–Levenshtein 1 of the term or of a like-length prefix of it, for
terms ≥ 4 chars — so "letf" finds "left"; fallback only). Results are ordered by
tier bucket (the 80/60 name-word tiers share one bucket), then by two importance
signals that outrank name shape: an exact-character match (a term that _is_ the
character, recovering the per-term tier-100 signal the weakest-link score hides
— so "letter a" surfaces the actual "a" instead of obscure "<script> LETTER A"
names whose first word merely starts with "a") and keyboard-typeability (a code
point typeable on the active layout, passed in from `pick-character.tsx`); then
by name coverage (the fraction of the entry's name words the query accounts for
— so "LEFTWARDS ARROW" outranks "LEFT RIGHT ARROW" for "left arrow"), then
exact-over-prefix, then input rank (recency/keyboard/popularity, the last being
the frequency order described under **Popularity scoring** above).

**Unicode rendering**: List titles and inline Markdown display Unicode
characters and emoji sequences directly. `characterDisplay()` uses readable
labels for control characters and U+10000–U+103FF, whose surrogate pairs are
unsafe in Raycast's render transport. Native key labels also use code-point text
for U+10000–U+103FF. Those characters retain their SVG glyph previews and full
clipboard values. Text/emoji comparisons append U+FE0E or U+FE0F to the
character, including characters above U+FFFF. Variant previews preserve the full
sequence of code points.

`svgCharacterImage()` (`src/svg.ts`) provides the detail panel's large preview:
a 96-pixel glyph in a 150-by-150 SVG, independent of Markdown heading styles.
Numeric XML references escape characters such as `<` and `&`. The SVG is
base64-encoded into a Markdown data URI; a leading zero-width space gives it
inline, left-aligned layout. Control characters use a text heading because XML
forbids most control-character references.

The "Copy Character" action passes the full string to `Action.CopyToClipboard`.
