import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildKeystrokeMap } from "../src/keyboard.js";
import { FIXTURE_LAYOUT_PATH } from "./helpers.js";

function loadLayout(): string {
  return readFileSync(FIXTURE_LAYOUT_PATH, "utf-8");
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
    const minimal = `<?xml version="1.0" encoding="UTF-8"?>
<keyboard group="0" id="0" name="Empty" maxout="1">
  <layouts><layout first="0" last="0" mapSet="m" modifiers="mod"/></layouts>
  <modifierMap id="mod" defaultIndex="0">
    <keyMapSelect mapIndex="0"><modifier keys=""/></keyMapSelect>
  </modifierMap>
  <keyMapSet id="m">
    <keyMap index="0">
      <key code="0" output="a"/>
    </keyMap>
  </keyMapSet>
</keyboard>`;
    const map = buildKeystrokeMap(minimal);
    expect(map.size).toBeGreaterThanOrEqual(1);
    expect(map.get("a")).toBeDefined();
  });
});
