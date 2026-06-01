// @vitest-environment happy-dom
// SPDX-FileCopyrightText: Copyright © 2026 Michael Shields
// SPDX-License-Identifier: MIT

import { Clipboard, LocalStorage, showHUD } from "@raycast/api";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { loadKeystrokeMap } from "../src/keyboard.js";
import PickCharacter, {
  CharacterItem,
  characterDisplay,
} from "../src/pick-character.js";
import type { CharacterEntry, KeystrokeDescription } from "../src/types.js";

interface ChildrenProps {
  children?: ReactNode;
}
interface ListProps extends ChildrenProps {
  isLoading?: boolean;
  onSearchTextChange?: (text: string) => void;
}
interface EmptyViewProps {
  title?: string;
}
interface Accessory {
  tag: string;
  tooltip?: string;
}
interface ListItemProps {
  title: string;
  accessories?: Accessory[];
  detail?: ReactNode;
  actions?: ReactNode;
}
interface DetailProps {
  markdown: string;
}
interface ActionProps {
  title: string;
  onAction?: () => void | Promise<void>;
}
interface CopyProps {
  title: string;
  content: string;
}

// Minimal stand-ins for the Raycast UI primitives: each renders a plain DOM
// node that exposes the props the component sets so tests can read them back
// and fire the action callbacks.
vi.mock("@raycast/api", () => {
  const List = Object.assign(
    ({ children, isLoading, onSearchTextChange }: ListProps) => (
      <div data-testid="list" data-loading={String(isLoading)}>
        <input
          data-testid="search"
          onChange={(e) => onSearchTextChange?.(e.target.value)}
        />
        {children}
      </div>
    ),
    {
      EmptyView: ({ title }: EmptyViewProps) => (
        <div data-testid="empty">{title}</div>
      ),
      Item: Object.assign(
        ({ title, accessories, detail, actions }: ListItemProps) => (
          <div data-testid="item" data-title={title}>
            {(accessories ?? []).map((a, i) => (
              <span key={i} data-tag={a.tag} />
            ))}
            {detail}
            {actions}
          </div>
        ),
        {
          Detail: ({ markdown }: DetailProps) => (
            <div data-testid="detail">{markdown}</div>
          ),
        },
      ),
    },
  );
  const Action = Object.assign(
    ({ title, onAction }: ActionProps) => (
      <button data-action={title} onClick={() => void onAction?.()}>
        {title}
      </button>
    ),
    {
      CopyToClipboard: ({ title, content }: CopyProps) => (
        <button data-action={title} data-content={content}>
          {title}
        </button>
      ),
    },
  );
  const ActionPanel = ({ children }: ChildrenProps) => (
    <div data-testid="actions">{children}</div>
  );
  return {
    List,
    Action,
    ActionPanel,
    Icon: { Clipboard: "clipboard", CopyClipboard: "copy" },
    Clipboard: { paste: vi.fn(), copy: vi.fn() },
    showHUD: vi.fn(),
    LocalStorage: { getItem: vi.fn(), setItem: vi.fn() },
  };
});

// A faithful-enough usePromise: it invokes the loader in an effect and exposes
// the resolved value, so the component cycles through its loading and loaded
// states the same way it does at runtime.
vi.mock("@raycast/utils", async () => {
  const { useEffect, useState } = await import("react");
  return {
    usePromise: <T,>(fn: () => Promise<T>) => {
      const [data, setData] = useState<T | undefined>(undefined);
      useEffect(() => {
        let active = true;
        void fn().then((result) => {
          if (active) setData(result);
        });
        return () => {
          active = false;
        };
      }, []);
      return {
        data,
        isLoading: data === undefined,
        revalidate: vi.fn(),
        mutate: vi.fn(),
        error: undefined,
      };
    },
  };
});

vi.mock("../src/keyboard.js", () => ({ loadKeystrokeMap: vi.fn() }));

vi.mock("../src/characters.js", () => ({
  characters: [
    {
      cp: 0x41,
      name: "LATIN CAPITAL LETTER A",
      keywords: ["alpha"],
      cat: "Lu",
    },
    { cp: 0x42, name: "LATIN CAPITAL LETTER B", keywords: [], cat: "Lu" },
    { cp: 0x61, name: "LATIN SMALL LETTER A", keywords: [], cat: "Ll" },
    { cp: 0x43, name: "LATIN CAPITAL LETTER C", keywords: [], cat: "Lu" },
    {
      cp: 0x1f1eb,
      cps: [0x1f1eb, 0x1f1f7],
      name: "FLAG: FRANCE",
      keywords: ["FR"],
      cat: "So",
    },
    // Constituents of the KEYCAP: 1 sequence, so its breakdown can resolve
    // each code point to a name (the France flag's are deliberately absent).
    { cp: 0x31, name: "DIGIT ONE", keywords: [], cat: "Nd" },
    { cp: 0xfe0f, name: "VARIATION SELECTOR-16", keywords: [], cat: "Mn" },
    { cp: 0x20e3, name: "COMBINING ENCLOSING KEYCAP", keywords: [], cat: "Me" },
  ],
}));

vi.mock("../src/variants.js", () => ({
  variants: {
    "1F44B": [{ cps: [0x1f44b, 0x1f3fb], label: "light skin tone" }],
    "0042": [],
  },
}));

const getItem = vi.mocked(LocalStorage.getItem);
const paste = vi.mocked(Clipboard.paste);
const copy = vi.mocked(Clipboard.copy);
const hud = vi.mocked(showHUD);
const keystrokeLoader = vi.mocked(loadKeystrokeMap);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("characterDisplay", () => {
  const make = (
    over: Partial<CharacterEntry> & { cp: number },
  ): CharacterEntry => ({ name: "X", keywords: [], cat: "So", ...over });

  it("renders a printable BMP character literally", () => {
    expect(characterDisplay(make({ cp: 0x41 }))).toBe("A");
  });

  it("renders a non-BMP character as its code point", () => {
    expect(characterDisplay(make({ cp: 0x1f4af }))).toBe("U+1F4AF");
  });

  it("brackets a C0 control character", () => {
    expect(characterDisplay(make({ cp: 0x07 }))).toBe("[U+0007]");
  });

  it("brackets a C1 control character", () => {
    expect(characterDisplay(make({ cp: 0x85 }))).toBe("[U+0085]");
  });

  it("treats a code point at or above U+00A0 as printable", () => {
    expect(characterDisplay(make({ cp: 0xa9 }))).toBe("©");
  });

  it("renders an all-BMP sequence literally", () => {
    expect(
      characterDisplay(make({ cp: 0x31, cps: [0x31, 0xfe0f, 0x20e3] })),
    ).toBe(String.fromCodePoint(0x31, 0xfe0f, 0x20e3));
  });

  it("abbreviates a sequence containing a non-BMP code point", () => {
    expect(
      characterDisplay(make({ cp: 0x1f1eb, cps: [0x1f1eb, 0x1f1f7] })),
    ).toBe("U+1F1EB…");
  });

  it("abbreviates a sequence containing a control code point", () => {
    expect(characterDisplay(make({ cp: 0x41, cps: [0x41, 0x07] }))).toBe(
      "U+0041…",
    );
  });
});

function itemMarkdown(
  entry: CharacterEntry,
  keystroke?: KeystrokeDescription,
): string {
  const { container } = render(
    <CharacterItem
      entry={entry}
      keystroke={keystroke}
      onSelect={vi.fn(() => Promise.resolve())}
    />,
  );
  return container.querySelector('[data-testid="detail"]')?.textContent ?? "";
}

describe("CharacterItem detail panel", () => {
  it("shows a control character as a bracketed heading and lists keywords", () => {
    const md = itemMarkdown({
      cp: 0x07,
      name: "BELL",
      keywords: ["BEL", "alert"],
      cat: "Cc",
    });
    expect(md).toContain("# [U+0007]");
    expect(md).toContain("BELL");
    expect(md).toContain("BEL, alert");
  });

  it("handles a C1 control character with no keywords", () => {
    const md = itemMarkdown({
      cp: 0x85,
      name: "NEXT LINE",
      keywords: [],
      cat: "Cc",
    });
    expect(md).toContain("# [U+0085]");
  });

  it("renders an SVG image and a keystroke line for a typable character", () => {
    const { container } = render(
      <CharacterItem
        entry={{
          cp: 0xa9,
          name: "COPYRIGHT SIGN",
          keywords: ["(c)"],
          cat: "So",
        }}
        keystroke={{ label: "⌥G", modifiers: "" }}
        onSelect={vi.fn(() => Promise.resolve())}
      />,
    );
    const md = container.querySelector('[data-testid="detail"]')?.textContent;
    expect(md).toContain("data:image/svg+xml;base64,");
    expect(md).toContain("Keystroke: **⌥G**");
    expect(container.querySelector('[data-tag="⌥G"]')).not.toBeNull();
  });

  it("adds a variation-selector comparison for a BMP emoji-variation character", () => {
    const md = itemMarkdown({
      cp: 0x2764,
      name: "HEAVY BLACK HEART",
      keywords: [],
      cat: "So",
      vs: true,
    });
    expect(md).toContain("Text:");
    expect(md).toContain("Emoji:");
  });

  it("omits the comparison for a non-BMP emoji-variation character", () => {
    const md = itemMarkdown({
      cp: 0x1f324,
      name: "WHITE SUN BEHIND CLOUD",
      keywords: [],
      cat: "So",
      vs: true,
    });
    expect(md).not.toContain("Text:");
  });

  it("lists skin-tone variants when the group is present", () => {
    const md = itemMarkdown({
      cp: 0x1f44b,
      name: "WAVING HAND SIGN",
      keywords: ["wave"],
      cat: "So",
    });
    expect(md).toContain("**Variants**");
    expect(md).toContain("light skin tone");
    expect(md).toContain("&#x1F44B;&#x1F3FB;");
  });

  it("omits the variants section when the group is empty", () => {
    const md = itemMarkdown({
      cp: 0x42,
      name: "LATIN CAPITAL LETTER B",
      keywords: [],
      cat: "Lu",
    });
    expect(md).not.toContain("**Variants**");
  });

  it("renders a multi-codepoint sequence with an SVG image and lists each code point with its name", () => {
    const md = itemMarkdown({
      cp: 0x31,
      cps: [0x31, 0xfe0f, 0x20e3],
      name: "KEYCAP: 1",
      keywords: ["keycap"],
      cat: "So",
    });
    expect(md).toContain("data:image/svg+xml;base64,");
    expect(md).toContain("KEYCAP: 1");
    // Each constituent appears on its own line as "U+XXXX  NAME".
    expect(md).toContain("U+0031  DIGIT ONE");
    expect(md).toContain("U+FE0F  VARIATION SELECTOR-16");
    expect(md).toContain("U+20E3  COMBINING ENCLOSING KEYCAP");
  });

  it("falls back to the bare code point when a sequence constituent has no name", () => {
    const md = itemMarkdown({
      cp: 0x1f1eb,
      cps: [0x1f1eb, 0x1f1f7],
      name: "FLAG: FRANCE",
      keywords: ["FR"],
      cat: "So",
    });
    expect(md).toContain("U+1F1EB");
    expect(md).toContain("U+1F1F7");
  });
});

describe("CharacterItem actions", () => {
  it("wires the paste, copy, and copy-code-point actions", async () => {
    const entry: CharacterEntry = {
      cp: 0x41,
      name: "LATIN CAPITAL LETTER A",
      keywords: [],
      cat: "Lu",
    };
    const onSelect = vi.fn(() => Promise.resolve());
    const { container } = render(
      <CharacterItem entry={entry} keystroke={undefined} onSelect={onSelect} />,
    );

    fireEvent.click(
      container.querySelector('[data-action="Paste Character"]')!,
    );
    expect(onSelect).toHaveBeenCalledWith(entry);

    fireEvent.click(container.querySelector('[data-action="Copy Character"]')!);
    await waitFor(() => expect(copy).toHaveBeenCalledWith("A"));
    expect(hud).toHaveBeenCalledWith("Copied to Clipboard");

    expect(
      container
        .querySelector('[data-action="Copy Code Point"]')
        ?.getAttribute("data-content"),
    ).toBe("U+0041");
  });
});

describe("PickCharacter", () => {
  it("orders recent, then keyboard, then the rest and pastes on selection", async () => {
    getItem.mockResolvedValue(JSON.stringify([{ cp: 0x41 }, { cp: 0x42 }]));
    keystrokeLoader.mockResolvedValue(
      new Map<string, KeystrokeDescription>([
        ["a", { label: "A", modifiers: "" }],
        ["", { label: "x", modifiers: "" }],
      ]),
    );

    const { container } = render(<PickCharacter />);

    // Until both loaders resolve the list reports that it is still loading.
    expect(
      container
        .querySelector('[data-testid="list"]')
        ?.getAttribute("data-loading"),
    ).toBe("true");

    // Once loaded, the keyboard-accessible 'a' shows its keystroke accessory.
    await waitFor(() =>
      expect(container.querySelector('[data-tag="A"]')).not.toBeNull(),
    );
    expect(
      container
        .querySelector('[data-testid="list"]')
        ?.getAttribute("data-loading"),
    ).toBe("false");

    const titles = () =>
      [...container.querySelectorAll('[data-testid="item"]')].map((el) =>
        el.getAttribute("data-title"),
      );
    expect(titles()).toHaveLength(8);
    // Most-recent character first (A, B), then keyboard-accessible 'a', then
    // the rest tier in data order (C, then the France flag at index 4).
    expect(titles()[0]).toBe("A  LATIN CAPITAL LETTER A");
    expect(titles()[4]).toBe("U+1F1EB…  FLAG: FRANCE");

    fireEvent.click(
      container.querySelectorAll('[data-action="Paste Character"]')[0]!,
    );
    await waitFor(() => expect(paste).toHaveBeenCalledWith("A"));

    fireEvent.change(container.querySelector('[data-testid="search"]')!, {
      target: { value: "letter b" },
    });
    await waitFor(() => {
      const shown = titles();
      expect(shown).toHaveLength(1);
      expect(shown[0]).toBe("B  LATIN CAPITAL LETTER B");
    });
  });
});
