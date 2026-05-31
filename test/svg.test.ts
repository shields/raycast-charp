// SPDX-FileCopyrightText: Copyright © 2026 Michael Shields
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { svgCharacterImage } from "../src/svg.js";

function decodeSvg(dataUri: string): string {
  const base64 = dataUri
    .replace(/^\u200B!\[\]\(data:image\/svg\+xml;base64,/, "")
    .replace(/\)$/, "");
  return Buffer.from(base64, "base64").toString("utf-8");
}

describe("svgCharacterImage", () => {
  it("returns a markdown image with base64 SVG data URI", () => {
    const result = svgCharacterImage([0x41]);
    expect(result).toMatch(
      /^\u200B!\[\]\(data:image\/svg\+xml;base64,[A-Za-z0-9+/]+=*\)$/,
    );
  });

  it("produces valid SVG with XML character references", () => {
    const svg = decodeSvg(svgCharacterImage([0x2764]));
    expect(svg).toContain("&#x2764;");
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });

  it("joins multiple code points into a single text element", () => {
    const svg = decodeSvg(svgCharacterImage([0x1f324, 0xfe0f]));
    expect(svg).toContain("&#x1F324;&#xFE0F;");
  });

  it("never contains raw non-BMP bytes", () => {
    const result = svgCharacterImage([0x1f4af]);
    for (const ch of result) {
      expect(ch.codePointAt(0)!).toBeLessThanOrEqual(0xffff);
    }
  });
});
