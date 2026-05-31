// SPDX-FileCopyrightText: Copyright © 2026 Michael Shields
// SPDX-License-Identifier: MIT

// Regenerates assets/icon.png — a 2×2 grid of representative glyphs (& → µ é)
// in Trade Gothic Next LT Pro Bold on a slate radial gradient. Trade Gothic has
// no U+2192, so the arrow is drawn as a stroked path whose weight matches the
// font's horizontal strokes; the glyphs share a baseline per row.
//
// Requires ImageMagick (`magick`), librsvg (`rsvg-convert`), and the commercial
// Trade Gothic Next LT Pro font, which is not redistributable and so is not in
// the repo. Set ICON_FONT to override the default macOS install path with a
// font file (or a fontconfig family name, if your ImageMagick resolves them).
// The PNG is committed, so a normal build never runs this.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = join(PROJECT_ROOT, "assets", "icon.png");

// Commercial font, installed locally; override with ICON_FONT.
const iconFontOverride = process.env.ICON_FONT ?? "";
const FONT =
  iconFontOverride.length > 0
    ? iconFontOverride
    : join(homedir(), "Library", "Fonts", "TradeGothicNextLTPro-Bd.otf");

const SIZE = 512; // final icon edge, px
const TILE = SIZE / 2; // one grid cell, px
const DENSITY = 72; // pin pt→px so glyph size is independent of the IM build
const POINTSIZE = 160; // glyph size in px (== pt at DENSITY)
const BASELINE_LIFT = 40; // gravity-South offset → a shared baseline per row

const BG_INNER = "#2B3144"; // slate, lighter at the centre for subtle depth
const BG_OUTER = "#171A24";
const INK = "#ffffff";

// Hand-drawn "→". The stroke matches the font's ~18px horizontal strokes; the
// geometry is tuned to sit at the same visual size as the glyphs.
const ARROW_STROKE = 18;
const ARROW_HALF_HEIGHT = 46;
const ARROW_SHAFT_X1 = 70;
const ARROW_SHAFT_X2 = 178;
const ARROW_TIP_X = 186;
const ARROW_BACK_X = 140;

function run(cmd: string, args: string[]): void {
  execFileSync(cmd, args, { stdio: ["ignore", "ignore", "inherit"] });
}

function magick(args: string[]): void {
  run("magick", args);
}

function magickCapture(args: string[]): string {
  return execFileSync("magick", args, { encoding: "utf-8" }).trim();
}

function requireTool(cmd: string): void {
  try {
    execFileSync(cmd, ["--version"], { stdio: "ignore" });
  } catch {
    throw new Error(
      `\`${cmd}\` not found on PATH; install it to regenerate the icon`,
    );
  }
}

// Vertical centre of a tile's rendered ink, from ImageMagick's trim box
// ("WxH+X+Y"), used to align the drawn arrow with the glyph beside it.
function inkCenterY(tile: string): number {
  const box = magickCapture([tile, "-format", "%@", "info:"]);
  const match = /^(\d+)x(\d+)\+\d+\+(\d+)$/.exec(box);
  if (!match) throw new Error(`Unexpected trim box for ${tile}: ${box}`);
  const width = Number(match[1]!);
  const height = Number(match[2]!);
  const top = Number(match[3]!);
  // A glyph missing from the font trims to 0×0; bail loudly rather than
  // silently centering the arrow on the tile edge.
  if (width === 0 || height === 0) {
    throw new Error(`Glyph rendered blank (not in the font?): ${tile}`);
  }
  return top + height / 2;
}

function cellOffset(col: number, row: number): string {
  return `+${col * TILE}+${row * TILE}`;
}

function main(): void {
  requireTool("magick");
  requireTool("rsvg-convert");
  if (FONT.includes("/") && !existsSync(FONT)) {
    throw new Error(
      `Font not found: ${FONT}\n` +
        `Trade Gothic Next LT Pro is commercial and not bundled; install it ` +
        `or set ICON_FONT to a font file or fontconfig family name.`,
    );
  }

  const work = mkdtempSync(join(tmpdir(), "charp-icon-"));
  try {
    console.log("Rendering background…");
    const bg = join(work, "bg.png");
    magick([
      "-size",
      `${SIZE}x${SIZE}`,
      `radial-gradient:${BG_INNER}-${BG_OUTER}`,
      bg,
    ]);

    // gravity South pins the box bottom, so every glyph shares a baseline.
    const renderGlyph = (glyph: string, name: string): string => {
      const out = join(work, `${name}.png`);
      magick([
        "-density",
        String(DENSITY),
        "-size",
        `${TILE}x${TILE}`,
        "xc:none",
        "-font",
        FONT,
        "-pointsize",
        String(POINTSIZE),
        "-fill",
        INK,
        "-gravity",
        "South",
        "-annotate",
        `+0+${BASELINE_LIFT}`,
        glyph,
        out,
      ]);
      return out;
    };

    console.log("Rendering glyphs…");
    const amp = renderGlyph("&", "amp");
    const mu = renderGlyph("µ", "mu"); // U+00B5 micro sign
    const eacute = renderGlyph("é", "eacute");

    console.log("Drawing arrow…");
    const centerY = Math.round(inkCenterY(amp)); // align arrow to its row-mate
    const top = centerY - ARROW_HALF_HEIGHT;
    const bottom = centerY + ARROW_HALF_HEIGHT;
    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}">`,
      `  <g fill="none" stroke="${INK}" stroke-width="${ARROW_STROKE}" stroke-linecap="round" stroke-linejoin="round">`,
      `    <line x1="${ARROW_SHAFT_X1}" y1="${centerY}" x2="${ARROW_SHAFT_X2}" y2="${centerY}"/>`,
      `    <polyline points="${ARROW_BACK_X},${top} ${ARROW_TIP_X},${centerY} ${ARROW_BACK_X},${bottom}"/>`,
      `  </g>`,
      `</svg>`,
    ].join("\n");
    const svgPath = join(work, "arrow.svg");
    writeFileSync(svgPath, svg);
    const arrow = join(work, "arrow.png");
    run("rsvg-convert", [
      "-w",
      String(TILE),
      "-h",
      String(TILE),
      svgPath,
      "-o",
      arrow,
    ]);

    console.log("Compositing…");
    const layers: { file: string; col: number; row: number }[] = [
      { file: amp, col: 0, row: 0 },
      { file: arrow, col: 1, row: 0 },
      { file: mu, col: 0, row: 1 },
      { file: eacute, col: 1, row: 1 },
    ];
    const args: string[] = [bg];
    for (const layer of layers) {
      args.push(
        layer.file,
        "-geometry",
        cellOffset(layer.col, layer.row),
        "-gravity",
        "NorthWest",
        "-composite",
      );
    }
    args.push("-alpha", "off", "-depth", "8", "-strip", OUTPUT);
    magick(args);

    const { size } = statSync(OUTPUT);
    console.log(`Wrote ${OUTPUT} (${(size / 1024).toFixed(1)}KB)`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error: unknown) {
  console.error(error);
  process.exit(1);
}
