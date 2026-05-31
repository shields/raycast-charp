// SPDX-FileCopyrightText: Copyright © 2026 Michael Shields
// SPDX-License-Identifier: MIT

import { exec } from "node:child_process";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildKeystrokeMap, loadKeystrokeMap } from "../src/keyboard.js";
import { FIXTURE_LAYOUT_PATH } from "./helpers.js";

vi.mock("node:child_process", () => ({ exec: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));
vi.mock("node:os", () => ({ homedir: () => "/mock-home" }));

function loadLayout(): string {
  return readFileSync(FIXTURE_LAYOUT_PATH, "utf-8");
}

const MINIMAL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<keyboard group="0" id="0" name="Test" maxout="1">
  <layouts><layout first="0" last="0" mapSet="m" modifiers="mod"/></layouts>
  <modifierMap id="mod" defaultIndex="0">
    <keyMapSelect mapIndex="0"><modifier keys=""/></keyMapSelect>
  </modifierMap>
  <keyMapSet id="m">
    <keyMap index="0"><key code="0" output="a"/></keyMap>
  </keyMapSet>
</keyboard>`;

function mockExecResult(stdout: string): void {
  vi.mocked(exec).mockImplementation(
    (_cmd: unknown, _opts: unknown, cb: unknown) => {
      (cb as (err: null, result: { stdout: string }) => void)(null, {
        stdout,
      });
      return undefined as never;
    },
  );
}

function mockExecError(): void {
  vi.mocked(exec).mockImplementation(
    (_cmd: unknown, _opts: unknown, cb: unknown) => {
      (cb as (err: Error) => void)(new Error("command failed"));
      return undefined as never;
    },
  );
}

describe("buildKeystrokeMap", () => {
  it("parses a .keylayout file without errors", () => {
    const map = buildKeystrokeMap(loadLayout());
    expect(map.size).toBeGreaterThan(0);
  });

  it("maps base layer characters", () => {
    const map = buildKeystrokeMap(loadLayout());

    const a = map.get("a");
    expect(a).toBeDefined();
    expect(a!.label).toBe("A");
    expect(a!.modifiers).toBe("none");

    const s = map.get("s");
    expect(s).toBeDefined();
    expect(s!.label).toBe("S");
  });

  it("maps shift layer characters", () => {
    const map = buildKeystrokeMap(loadLayout());

    const bigA = map.get("A");
    expect(bigA).toBeDefined();
    expect(bigA!.label).toBe("⇧A");
    expect(bigA!.modifiers).toBe("⇧");
  });

  it("maps option layer characters", () => {
    const map = buildKeystrokeMap(loadLayout());

    const alpha = map.get("α");
    expect(alpha).toBeDefined();
    expect(alpha!.label).toBe("⌥A");
    expect(alpha!.modifiers).toBe("⌥");

    const pi = map.get("π");
    expect(pi).toBeDefined();
    expect(pi!.label).toBe("⌥P");
  });

  it("maps shift+option layer characters", () => {
    const map = buildKeystrokeMap(loadLayout());

    const cCedilla = map.get("Ç");
    expect(cCedilla).toBeDefined();
    expect(cCedilla!.label).toBe("⇧⌥C");
  });

  it("maps dead key sequences", () => {
    const map = buildKeystrokeMap(loadLayout());

    // Option+E is acute dead key, then E → é
    const eAcute = map.get("é");
    expect(eAcute).toBeDefined();
    expect(eAcute!.deadKey).toBeDefined();
    expect(eAcute!.label).toContain("E");

    // Acute dead key then A → á
    const aAcute = map.get("á");
    expect(aAcute).toBeDefined();
    expect(aAcute!.deadKey).toBeDefined();
  });

  it("prefers simpler modifier for shared characters", () => {
    const map = buildKeystrokeMap(loadLayout());

    // Space should map to base layer, not any modifier variant
    const space = map.get(" ");
    expect(space).toBeDefined();
    expect(space!.modifiers).toBe("none");
  });

  it("does not map control characters", () => {
    const map = buildKeystrokeMap(loadLayout());

    expect(map.has("\r")).toBe(false);
    expect(map.has("\n")).toBe(false);
    expect(map.has("\t")).toBe(false);
  });

  it("handles an empty or minimal layout", () => {
    const map = buildKeystrokeMap(MINIMAL_XML);
    expect(map.size).toBeGreaterThanOrEqual(1);
    expect(map.get("a")).toBeDefined();
  });

  it("returns empty map when XML has no keyboard element", () => {
    const map = buildKeystrokeMap(`<?xml version="1.0"?><other/>`);
    expect(map.size).toBe(0);
  });

  it("handles edge cases in parsing and mapping", () => {
    // Crafted layout that exercises all guard-clause branches: missing/empty
    // attributes, unknown modifier indices, undefined actions, control-char
    // outputs, and dead key trigger deduplication.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<keyboard group="0" id="0" name="Edge" maxout="1">
  <layouts><layout first="0" last="0" mapSet="m" modifiers="mod"/></layouts>
  <modifierMap id="mod" defaultIndex="0">
    <keyMapSelect mapIndex="0"><modifier keys=""/></keyMapSelect>
    <keyMapSelect mapIndex="1"><modifier keys="shift"/></keyMapSelect>
    <keyMapSelect mapIndex="3"><modifier keys="anyOption"/></keyMapSelect>
    <keyMapSelect mapIndex="99"><modifier keys="command"/></keyMapSelect>
  </modifierMap>
  <keyMapSet id="m">
    <keyMap index="0">
      <key code="0" output="a"/>
      <key code="1" output=""/>
      <key code="2"/>
      <key code="3" output="b"/>
      <key code="3" action="deadAction"/>
      <key code="4" action="noSuchAction"/>
      <key code="5" action="ctrlAction"/>
      <key code="6" action="noNoneAction"/>
    </keyMap>
    <keyMap index="1">
      <key code="10" action="deadAction"/>
    </keyMap>
    <keyMap index="3">
      <key code="7" action="missingAction"/>
      <key code="8" output="q"/>
    </keyMap>
    <keyMap index="99">
      <key code="0" output="z"/>
      <key code="9" action="deadAction"/>
    </keyMap>
  </keyMapSet>
  <actions>
    <action id="deadAction">
      <when state="none" next="acuteState"/>
      <when state="acuteState" output="é"/>
      <when state="acuteState" output="&#x000D;"/>
    </action>
    <action id="ctrlAction">
      <when state="none" output="&#x000D;"/>
    </action>
    <action id="noNoneAction">
      <when state="someState" output="x"/>
    </action>
  </actions>
  <terminators>
    <when state="acuteState" output="´"/>
    <when state="noOutput"/>
  </terminators>
</keyboard>`;
    const map = buildKeystrokeMap(xml);
    expect(map.get("a")).toBeDefined();
    expect(map.get("b")).toBeDefined();
    expect(map.get("q")!.label).toBe("⌥Key8");
    expect(map.get("é")).toBeDefined();
    expect(map.get("é")!.deadKey).toBeDefined();
    expect(map.has("\r")).toBe(false);
    expect(map.has("z")).toBe(false);
  });

  it("replaces a worse modifier with a better one", () => {
    // keyMap index="3" (option, priority 2) appears before index="0" (base,
    // priority 0) in XML order, so the Map iterates option first. Character "x"
    // in both layers — base layer must replace the option entry.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<keyboard group="0" id="0" name="Test" maxout="1">
  <layouts><layout first="0" last="0" mapSet="m" modifiers="mod"/></layouts>
  <modifierMap id="mod" defaultIndex="0">
    <keyMapSelect mapIndex="0"><modifier keys=""/></keyMapSelect>
    <keyMapSelect mapIndex="3"><modifier keys="anyOption"/></keyMapSelect>
  </modifierMap>
  <keyMapSet id="m">
    <keyMap index="3">
      <key code="7" output="x"/>
    </keyMap>
    <keyMap index="0">
      <key code="7" output="x"/>
    </keyMap>
  </keyMapSet>
</keyboard>`;
    const map = buildKeystrokeMap(xml);
    const x = map.get("x");
    expect(x).toBeDefined();
    expect(x!.modifiers).toBe("none");
  });

  it("prefers the simplest modifier for a dead key reachable from many layers", () => {
    // The same dead-key state "acute" is reachable from the shift+option layer
    // (index 4, priority 4) and the option layer (index 3, priority 2). The
    // shift+option trigger appears first in XML order, but the resulting label
    // must use the simpler ⌥ trigger, not ⇧⌥.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<keyboard group="0" id="0" name="Test" maxout="1">
  <layouts><layout first="0" last="0" mapSet="m" modifiers="mod"/></layouts>
  <modifierMap id="mod" defaultIndex="0">
    <keyMapSelect mapIndex="0"><modifier keys=""/></keyMapSelect>
    <keyMapSelect mapIndex="3"><modifier keys="anyOption"/></keyMapSelect>
    <keyMapSelect mapIndex="4"><modifier keys="anyShift anyOption"/></keyMapSelect>
  </modifierMap>
  <keyMapSet id="m">
    <keyMap index="0">
      <key code="14" output="e"/>
      <key code="20" output="t"/>
      <key code="0" action="a_a"/>
    </keyMap>
    <keyMap index="4">
      <key code="20" action="deadAcute"/>
    </keyMap>
    <keyMap index="3">
      <key code="14" action="deadAcute"/>
    </keyMap>
  </keyMapSet>
  <actions>
    <action id="deadAcute"><when state="none" next="acute"/></action>
    <action id="a_a">
      <when state="none" output="a"/>
      <when state="acute" output="&#x00E1;"/>
    </action>
  </actions>
</keyboard>`;
    const map = buildKeystrokeMap(xml);
    const aAcute = map.get("á");
    expect(aAcute).toBeDefined();
    expect(aAcute!.deadKey).toBeDefined();
    expect(aAcute!.deadKey!.trigger).toBe("⌥E");
    expect(aAcute!.label).toBe("⌥E A");
  });

  it("uses the first keyMapSet when several are present", () => {
    // Layouts can carry one keyMapSet per device type. Only the first should
    // be parsed; the second must be ignored.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<keyboard group="0" id="0" name="Test" maxout="1">
  <layouts><layout first="0" last="0" mapSet="ansi" modifiers="mod"/></layouts>
  <modifierMap id="mod" defaultIndex="0">
    <keyMapSelect mapIndex="0"><modifier keys=""/></keyMapSelect>
  </modifierMap>
  <keyMapSet id="ansi">
    <keyMap index="0"><key code="0" output="a"/></keyMap>
  </keyMapSet>
  <keyMapSet id="iso">
    <keyMap index="0"><key code="0" output="z"/></keyMap>
  </keyMapSet>
</keyboard>`;
    const map = buildKeystrokeMap(xml);
    expect(map.get("a")).toBeDefined();
    expect(map.has("z")).toBe(false);
  });

  it("derives modifier labels from the layout's modifierMap, not fixed indices", () => {
    // Indices are deliberately non-conventional: shift on index 2 (caps under
    // the old hardcoded table) and option on index 5 (caps+option before). An
    // unrecognized token in the keys list is ignored.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<keyboard group="0" id="0" name="NonStd" maxout="1">
  <layouts><layout first="0" last="0" mapSet="m" modifiers="mod"/></layouts>
  <modifierMap id="mod" defaultIndex="0">
    <keyMapSelect mapIndex="0"><modifier keys=""/></keyMapSelect>
    <keyMapSelect mapIndex="2"><modifier keys="anyShift"/></keyMapSelect>
    <keyMapSelect mapIndex="5"><modifier keys="anyOption junk"/></keyMapSelect>
    <keyMapSelect mapIndex="6"><modifier/></keyMapSelect>
  </modifierMap>
  <keyMapSet id="m">
    <keyMap index="0"><key code="0" output="a"/></keyMap>
    <keyMap index="2"><key code="0" output="A"/></keyMap>
    <keyMap index="5"><key code="1" output="x"/></keyMap>
    <keyMap index="6"><key code="2" output="n"/></keyMap>
  </keyMapSet>
</keyboard>`;
    const map = buildKeystrokeMap(xml);
    expect(map.get("a")!.modifiers).toBe("none");
    expect(map.get("A")!.modifiers).toBe("⇧");
    expect(map.get("x")!.modifiers).toBe("⌥");
    // A <modifier> with no keys attribute means no modifiers (base layer).
    expect(map.get("n")!.modifiers).toBe("none");
  });

  it("falls back to the first modifierMap and skips control/unparseable indices", () => {
    // No <layouts>, so the modifierMap reference is unresolved and the first
    // map wins. A control layer and a non-numeric index are skipped; a
    // keyMapSelect with several alternatives takes the simplest one.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<keyboard group="0" id="0" name="Fallback" maxout="1">
  <modifierMap id="primary" defaultIndex="0">
    <keyMapSelect mapIndex="0"><modifier keys=""/></keyMapSelect>
    <keyMapSelect mapIndex="bad"><modifier keys="anyShift"/></keyMapSelect>
    <keyMapSelect mapIndex="1"><modifier keys="anyControl"/></keyMapSelect>
    <keyMapSelect mapIndex="2"><modifier keys="anyShift anyOption"/><modifier keys="anyShift"/></keyMapSelect>
    <keyMapSelect mapIndex="3"><modifier keys="anyShift"/><modifier keys="anyShift anyOption"/></keyMapSelect>
  </modifierMap>
  <modifierMap id="other" defaultIndex="0">
    <keyMapSelect mapIndex="0"><modifier keys="anyOption"/></keyMapSelect>
  </modifierMap>
  <keyMapSet id="m">
    <keyMap index="0"><key code="0" output="a"/></keyMap>
    <keyMap index="1"><key code="1" output="c"/></keyMap>
    <keyMap index="2"><key code="2" output="b"/></keyMap>
    <keyMap index="3"><key code="3" output="d"/></keyMap>
  </keyMapSet>
</keyboard>`;
    const map = buildKeystrokeMap(xml);
    expect(map.get("a")!.modifiers).toBe("none");
    expect(map.has("c")).toBe(false);
    expect(map.get("b")!.modifiers).toBe("⇧");
    expect(map.get("d")!.modifiers).toBe("⇧");
  });

  it("renders a non-BMP key label as its code point", () => {
    // A base-layer key whose output is non-BMP (U+1D400) must not put that
    // character into a label (it would crash Raycast's JSON parser).
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<keyboard group="0" id="0" name="NonBMP" maxout="2">
  <layouts><layout first="0" last="0" mapSet="m" modifiers="mod"/></layouts>
  <modifierMap id="mod" defaultIndex="0">
    <keyMapSelect mapIndex="0"><modifier keys=""/></keyMapSelect>
    <keyMapSelect mapIndex="1"><modifier keys="anyShift"/></keyMapSelect>
  </modifierMap>
  <keyMapSet id="m">
    <keyMap index="0"><key code="0" output="&#x1D400;"/></keyMap>
    <keyMap index="1"><key code="0" output="z"/></keyMap>
  </keyMapSet>
</keyboard>`;
    const map = buildKeystrokeMap(xml);
    expect(map.get(String.fromCodePoint(0x1d400))!.label).toBe("U+1D400");
    expect(map.get("z")!.label).toBe("⇧U+1D400");
  });

  it("yields an empty map when the keyboard has no modifierMap", () => {
    // With no <modifierMap>, no keyMap index has a known modifier, so every
    // key is skipped and the result is empty.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<keyboard group="0" id="0" name="NoMods" maxout="1">
  <keyMapSet id="m">
    <keyMap index="0"><key code="0" output="a"/></keyMap>
  </keyMapSet>
</keyboard>`;
    expect(buildKeystrokeMap(xml).size).toBe(0);
  });

  it("derives key labels from the real base layer when it is not index 0", () => {
    // Some non-Latin layouts (Greek, Arabic, …) put a Latin command layer at
    // index 0 and the real unmodified layer at another index. Keycap labels
    // must come from the real base layer, not index 0.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<keyboard group="0" id="0" name="Greekish" maxout="1">
  <layouts><layout first="0" last="0" mapSet="m" modifiers="mod"/></layouts>
  <modifierMap id="mod" defaultIndex="1">
    <keyMapSelect mapIndex="0"><modifier keys="command"/></keyMapSelect>
    <keyMapSelect mapIndex="1"><modifier keys=""/></keyMapSelect>
    <keyMapSelect mapIndex="2"><modifier keys="anyShift"/></keyMapSelect>
  </modifierMap>
  <keyMapSet id="m">
    <keyMap index="0"><key code="0" output="s"/></keyMap>
    <keyMap index="1"><key code="0" output="σ"/></keyMap>
    <keyMap index="2"><key code="0" output="Σ"/></keyMap>
  </keyMapSet>
</keyboard>`;
    const map = buildKeystrokeMap(xml);
    expect(map.has("s")).toBe(false); // index 0 is a command layer, skipped
    expect(map.get("σ")!.modifiers).toBe("none");
    expect(map.get("σ")!.label).toBe("Σ"); // keycap from the real base layer
    expect(map.get("Σ")!.label).toBe("⇧Σ");
  });
});

describe("loadKeystrokeMap", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("rejects when defaults read fails", async () => {
    mockExecError();
    await expect(loadKeystrokeMap()).rejects.toThrow("command failed");
  });

  it("returns empty map when no keyboard layout name found", async () => {
    mockExecResult("no matching content here");
    const map = await loadKeystrokeMap();
    expect(map.size).toBe(0);
  });

  it("returns empty map when keylayout files not found", async () => {
    mockExecResult('"KeyboardLayout Name" = "TestLayout";');
    vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"));
    const map = await loadKeystrokeMap();
    expect(map.size).toBe(0);
  });

  it("returns keystroke map when user keylayout file is found", async () => {
    mockExecResult('"KeyboardLayout Name" = "TestLayout";');
    vi.mocked(readFile).mockResolvedValueOnce(MINIMAL_XML as never);
    const map = await loadKeystrokeMap();
    expect(map.size).toBeGreaterThan(0);
    expect(map.get("a")).toBeDefined();
  });

  it("falls back to system path when user path fails", async () => {
    mockExecResult('"KeyboardLayout Name" = "TestLayout";');
    vi.mocked(readFile)
      .mockRejectedValueOnce(new Error("ENOENT"))
      .mockResolvedValueOnce(MINIMAL_XML as never);
    const map = await loadKeystrokeMap();
    expect(map.size).toBeGreaterThan(0);
  });

  it("warns and returns the map when a parsed layout is empty", async () => {
    mockExecResult('"KeyboardLayout Name" = "TestLayout";');
    // loadKeystrokeMap already console.warns when a layout file is found but
    // parses to an empty map (see the map.size === 0 branch); this exercises it.
    // A keyboard element with no usable keys parses to an empty map.
    vi.mocked(readFile).mockResolvedValueOnce(
      '<?xml version="1.0"?><keyboard></keyboard>' as never,
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const map = await loadKeystrokeMap();
    expect(map.size).toBe(0);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
