const cache = new Map<string, string>();

function buildSvgImage(
  codePoints: number[],
  width: number,
  height: number,
  fontSize: number,
  yOffset: number,
): string {
  const key = `${width}:${codePoints.join(",")}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const refs = codePoints
    .map((cp) => `&#x${cp.toString(16).toUpperCase()};`)
    .join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}">` +
    `<text x="0" y="${String(yOffset)}" font-size="${String(fontSize)}">${refs}</text>` +
    `</svg>`;
  const result = `\u200B![](data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")})`;
  cache.set(key, result);
  return result;
}

/** Markdown image tag rendering a character via SVG. The SVG uses XML
 * character references so no raw non-BMP bytes enter the render tree.
 * CoreGraphics text shaping applies variation selectors correctly. */
export function svgCharacterImage(codePoints: number[]): string {
  return buildSvgImage(codePoints, 150, 150, 96, 115);
}
