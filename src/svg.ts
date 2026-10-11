// SPDX-FileCopyrightText: Copyright © 2026 Michael Shields
// SPDX-License-Identifier: MIT

const cache = new Map<string, string>();

// SVG sets the preview size independently of Markdown heading styles.
// Numeric references keep XML-sensitive characters such as < and & literal.
export function svgCharacterImage(codePoints: number[]): string {
  const key = codePoints.join(",");
  const cached = cache.get(key);
  if (cached) return cached;

  const refs = codePoints
    .map((cp) => `&#x${cp.toString(16).toUpperCase()};`)
    .join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150">` +
    `<text x="0" y="115" font-size="96">${refs}</text>` +
    `</svg>`;
  const result = `\u200B![](data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")})`;
  cache.set(key, result);
  return result;
}
