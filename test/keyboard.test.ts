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
});

describe("loadKeystrokeMap", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns empty map when defaults read fails", async () => {
    mockExecError();
    const map = await loadKeystrokeMap();
    expect(map.size).toBe(0);
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
});
