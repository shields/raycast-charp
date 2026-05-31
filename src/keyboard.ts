// SPDX-FileCopyrightText: Copyright © 2026 Michael Shields
// SPDX-License-Identifier: MIT

import { exec } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { XMLParser } from "fast-xml-parser";
import type { KeystrokeDescription } from "./types.js";

interface ModifierInfo {
  label: string;
  priority: number;
}

type Modifier = "shift" | "option" | "control" | "caps" | "command";

// Order in which modifier symbols are concatenated into a label (matches the
// macOS convention used elsewhere, e.g. ⇧⌥ and ⇪⌥).
const MODIFIER_DISPLAY: { mod: Modifier; symbol: string }[] = [
  { mod: "shift", symbol: "⇧" },
  { mod: "caps", symbol: "⇪" },
  { mod: "control", symbol: "⌃" },
  { mod: "option", symbol: "⌥" },
  { mod: "command", symbol: "⌘" },
];

// Lower rank = simpler modifier, preferred when a character is reachable from
// several layers. Combinations sort after singles (10 added per modifier).
const MODIFIER_RANK: Record<Modifier, number> = {
  shift: 1,
  option: 2,
  caps: 3,
  control: 4,
  command: 5,
};

// Parsed representations of .keylayout XML elements
interface KeyElement {
  "@_code": string;
  "@_output"?: string;
  "@_action"?: string;
}
interface WhenElement {
  "@_state": string;
  "@_output"?: string;
  "@_next"?: string;
}
interface ActionElement {
  "@_id": string;
  when: WhenElement | WhenElement[];
}
interface KeyMapElement {
  "@_index": string;
  key: KeyElement | KeyElement[];
}
interface ModifierElement {
  "@_keys"?: string;
}
interface KeyMapSelectElement {
  "@_mapIndex": string;
  modifier: ModifierElement | ModifierElement[];
}
interface ModifierMapElement {
  "@_id"?: string;
  keyMapSelect: KeyMapSelectElement | KeyMapSelectElement[];
}
interface LayoutElement {
  "@_modifiers"?: string;
}

interface ActionWhen {
  state: string;
  output?: string | undefined;
  next?: string | undefined;
}

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function isControlChar(cp: number): boolean {
  return cp < 0x20 || cp === 0x7f;
}

function formatKeystroke(modLabel: string, keyLabel: string): string {
  return modLabel ? `${modLabel}${keyLabel}` : keyLabel;
}

// A non-BMP character in a key label would reach Raycast's render tree and
// crash its Swift JSON parser (see CLAUDE.md), so show its code point instead.
function keyLabelFor(output: string): string {
  const cp = output.codePointAt(0)!;
  if (cp > 0xffff) {
    return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
  }
  return output.toUpperCase();
}

function classifyModifier(token: string): Modifier | null {
  const lower = token.toLowerCase();
  const mods: Modifier[] = ["shift", "option", "control", "command", "caps"];
  for (const mod of mods) {
    if (lower.includes(mod)) return mod;
  }
  return null;
}

// A keyMapSelect's `keys` attribute is a space-separated list of modifier
// tokens (e.g. "anyShift anyOption"). A trailing "?" marks a modifier optional
// (don't-care), which we ignore when deriving a label.
function modifiersFromKeys(keys: string): Set<Modifier> {
  const mods = new Set<Modifier>();
  for (const token of keys.trim().split(/\s+/)) {
    if (token === "" || token.endsWith("?")) continue;
    const mod = classifyModifier(token);
    if (mod) mods.add(mod);
  }
  return mods;
}

function modifierInfo(mods: Set<Modifier>): ModifierInfo {
  const label = MODIFIER_DISPLAY.filter(({ mod }) => mods.has(mod))
    .map(({ symbol }) => symbol)
    .join("");
  let priority = mods.size * 10;
  for (const mod of mods) priority += MODIFIER_RANK[mod];
  return { label, priority };
}

// Derive, per keyMap index, the modifier label/priority from the layout's own
// <modifierMap> rather than assuming conventional index meanings. Command and
// control layers are application shortcuts, not character input, so their
// indices are left unmapped (and thus skipped downstream).
function parseModifierMap(
  keyboard: Record<string, unknown>,
): Map<number, ModifierInfo> {
  const result = new Map<number, ModifierInfo>();
  const modMaps = toArray(
    keyboard["modifierMap"] as
      | ModifierMapElement
      | ModifierMapElement[]
      | undefined,
  );
  if (modMaps.length === 0) return result;

  // A layout selects its modifierMap by id; fall back to the first map.
  const layouts = toArray(
    (keyboard["layouts"] as Record<string, unknown> | undefined)?.["layout"] as
      | LayoutElement
      | LayoutElement[]
      | undefined,
  );
  const wantedId = layouts[0]?.["@_modifiers"];
  const modMap = modMaps.find((m) => m["@_id"] === wantedId) ?? modMaps[0]!;

  for (const sel of toArray(modMap.keyMapSelect)) {
    const index = Number.parseInt(String(sel["@_mapIndex"]), 10);
    if (Number.isNaN(index)) continue;
    let best: ModifierInfo | undefined;
    for (const modifier of toArray(sel.modifier)) {
      const mods = modifiersFromKeys(String(modifier["@_keys"] ?? ""));
      if (mods.has("command") || mods.has("control")) continue;
      const info = modifierInfo(mods);
      if (!best || info.priority < best.priority) best = info;
    }
    if (best) result.set(index, best);
  }
  return result;
}

/**
 * Derive key labels from the base (unmodified) layer of the layout itself, so
 * labels match the user's actual keyboard (AZERTY, QWERTZ, etc.). The base
 * layer is not always keyMap index 0 — some layouts (e.g. Greek, Arabic) put a
 * Latin command layer there — so the caller passes the index whose modifier
 * set is empty.
 */
function deriveKeyLabels(
  keyMaps: Map<number, Map<number, string>>,
  keyActions: Map<number, Map<number, string>>,
  actionDefs: Map<string, ActionWhen[]>,
  baseIndex: number,
): Map<number, string> {
  const labels = new Map<number, string>();

  // Direct outputs from the base layer
  const baseOutputs = keyMaps.get(baseIndex);
  if (baseOutputs) {
    for (const [code, output] of baseOutputs) {
      const cp = output.codePointAt(0);
      if (cp === undefined || isControlChar(cp)) continue;
      labels.set(code, keyLabelFor(output));
    }
  }

  // Also resolve action-based keys on the base layer (state="none" output)
  const baseActions = keyActions.get(baseIndex);
  if (baseActions) {
    for (const [code, actionId] of baseActions) {
      if (labels.has(code)) continue;
      const whens = actionDefs.get(actionId);
      if (!whens) continue;
      const noneOutput = whens.find(
        (w) => w.state === "none" && w.output !== undefined,
      );
      if (noneOutput?.output) {
        const cp = noneOutput.output.codePointAt(0);
        if (cp === undefined || isControlChar(cp)) continue;
        labels.set(code, keyLabelFor(noneOutput.output));
      }
    }
  }

  if (!labels.has(49)) labels.set(49, "Space");
  return labels;
}

interface ParsedLayout {
  keyMaps: Map<number, Map<number, string>>;
  keyActions: Map<number, Map<number, string>>;
  actionDefs: Map<string, ActionWhen[]>;
  modifiers: Map<number, ModifierInfo>;
}

function parseKeylayout(xml: string): ParsedLayout {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    processEntities: true,
    htmlEntities: true,
    trimValues: false,
  });
  const doc = parser.parse(xml) as Record<string, unknown>;
  const keyboard = doc["keyboard"] as Record<string, unknown> | undefined;
  if (!keyboard) {
    return {
      keyMaps: new Map(),
      keyActions: new Map(),
      actionDefs: new Map(),
      modifiers: new Map(),
    };
  }

  // Parse keyMapSet → keyMap[]. Layouts may have multiple keyMapSet
  // elements (e.g. one per keyboard device type); use the first.
  const rawKeyMapSet = keyboard["keyMapSet"];
  const keyMapSet = (
    Array.isArray(rawKeyMapSet) ? rawKeyMapSet[0] : rawKeyMapSet
  ) as Record<string, unknown> | undefined;
  const rawKeyMaps = toArray(
    keyMapSet?.["keyMap"] as KeyMapElement | KeyMapElement[] | undefined,
  );

  const keyMaps = new Map<number, Map<number, string>>();
  const keyActions = new Map<number, Map<number, string>>();

  for (const km of rawKeyMaps) {
    const index = Number.parseInt(String(km["@_index"]), 10);
    const outputs = new Map<number, string>();
    const actions = new Map<number, string>();

    for (const k of toArray(km.key)) {
      const code = Number.parseInt(String(k["@_code"]), 10);
      if (k["@_output"] !== undefined) {
        outputs.set(code, String(k["@_output"]));
      } else if (k["@_action"] !== undefined) {
        actions.set(code, String(k["@_action"]));
      }
    }
    keyMaps.set(index, outputs);
    keyActions.set(index, actions);
  }

  // Parse actions
  const rawActions = toArray(
    (keyboard["actions"] as Record<string, unknown> | undefined)?.["action"] as
      | ActionElement
      | ActionElement[]
      | undefined,
  );
  const actionDefs = new Map<string, ActionWhen[]>();

  for (const action of rawActions) {
    const id = String(action["@_id"]);
    const whens = toArray(action.when).map((w) => ({
      state: String(w["@_state"]),
      output: w["@_output"] !== undefined ? String(w["@_output"]) : undefined,
      next: w["@_next"] !== undefined ? String(w["@_next"]) : undefined,
    }));
    actionDefs.set(id, whens);
  }

  return {
    keyMaps,
    keyActions,
    actionDefs,
    modifiers: parseModifierMap(keyboard),
  };
}

export function buildKeystrokeMap(
  keylayoutXml: string,
): Map<string, KeystrokeDescription> {
  const { keyMaps, keyActions, actionDefs, modifiers } =
    parseKeylayout(keylayoutXml);
  // The unmodified layer is the keyMap index whose modifier set is empty.
  const baseIndex =
    [...modifiers].find(([, info]) => info.label === "")?.[0] ?? 0;
  const keyLabels = deriveKeyLabels(keyMaps, keyActions, actionDefs, baseIndex);
  const map = new Map<string, KeystrokeDescription>();

  function labelFor(code: number): string {
    return keyLabels.get(code) ?? `Key${String(code)}`;
  }

  // Track direct char → keystroke (prefer simplest modifier)
  const directMap = new Map<
    string,
    { modifierIndex: number; keyCode: number }
  >();

  function addDirect(output: string, modIndex: number, keyCode: number): void {
    if (output.length === 0) return;
    const cp = output.codePointAt(0)!;
    if (isControlChar(cp)) return;

    const existing = directMap.get(output);
    if (!existing) {
      directMap.set(output, { modifierIndex: modIndex, keyCode });
    } else {
      const oldPri = modifiers.get(existing.modifierIndex)!.priority;
      const newPri = modifiers.get(modIndex)!.priority;
      if (newPri < oldPri) {
        directMap.set(output, { modifierIndex: modIndex, keyCode });
      }
    }
  }

  // Collect direct outputs from keyMaps
  for (const [modIndex, outputs] of keyMaps) {
    if (!modifiers.has(modIndex)) continue;
    for (const [keyCode, output] of outputs) {
      addDirect(output, modIndex, keyCode);
    }
  }

  // Collect direct outputs from actions (state="none" → output)
  for (const [modIndex, actions] of keyActions) {
    if (!modifiers.has(modIndex)) continue;
    for (const [keyCode, actionId] of actions) {
      const whens = actionDefs.get(actionId);
      if (!whens) continue;
      const noneOutput = whens.find(
        (w) => w.state === "none" && w.output !== undefined,
      );
      if (noneOutput?.output) {
        addDirect(noneOutput.output, modIndex, keyCode);
      }
    }
  }

  // Emit direct keystrokes
  for (const [char, info] of directMap) {
    const mod = modifiers.get(info.modifierIndex)!;
    map.set(char, {
      label: formatKeystroke(mod.label, labelFor(info.keyCode)),
      modifiers: mod.label || "none",
    });
  }

  // Identify dead key triggers: action with state="none" next="X"
  const deadKeyTriggers = new Map<
    string,
    { state: string; triggers: { modifierIndex: number; keyCode: number }[] }
  >();
  for (const [actionId, whens] of actionDefs) {
    const noneWhen = whens.find(
      (w) => w.state === "none" && w.next !== undefined,
    );
    if (noneWhen?.next) {
      deadKeyTriggers.set(actionId, { state: noneWhen.next, triggers: [] });
    }
  }
  for (const [modIndex, actions] of keyActions) {
    for (const [keyCode, actionId] of actions) {
      const dkt = deadKeyTriggers.get(actionId);
      if (dkt) {
        dkt.triggers.push({ modifierIndex: modIndex, keyCode });
      }
    }
  }

  // Build reverse index: state name → trigger info, preferring the
  // simplest modifier (lowest priority) when a state is reachable from
  // several layers.
  const stateToTrigger = new Map<
    string,
    { modifierLabel: string; keyLabel: string; priority: number }
  >();
  for (const [, dkt] of deadKeyTriggers) {
    for (const trigger of dkt.triggers) {
      const mod = modifiers.get(trigger.modifierIndex);
      if (!mod) continue;
      const existing = stateToTrigger.get(dkt.state);
      if (existing && existing.priority <= mod.priority) continue;
      stateToTrigger.set(dkt.state, {
        modifierLabel: mod.label,
        keyLabel: labelFor(trigger.keyCode),
        priority: mod.priority,
      });
    }
  }

  // Emit dead key keystrokes
  for (const [modIndex, actions] of keyActions) {
    if (!modifiers.has(modIndex)) continue;
    for (const [keyCode, actionId] of actions) {
      const whens = actionDefs.get(actionId);
      if (!whens) continue;

      for (const when of whens) {
        if (when.state === "none" || !when.output) continue;
        const cp = when.output.codePointAt(0);
        if (cp === undefined || isControlChar(cp)) continue;
        if (map.has(when.output)) continue;

        const trigger = stateToTrigger.get(when.state);
        if (!trigger) continue;

        const triggerLabel = formatKeystroke(
          trigger.modifierLabel,
          trigger.keyLabel,
        );
        map.set(when.output, {
          label: `${triggerLabel} ${labelFor(keyCode)}`,
          modifiers: trigger.modifierLabel || "none",
          deadKey: { trigger: triggerLabel, completion: labelFor(keyCode) },
        });
      }
    }
  }

  return map;
}

const execAsync = promisify(exec);

export async function loadKeystrokeMap(): Promise<
  Map<string, KeystrokeDescription>
> {
  const { stdout } = await execAsync(
    "defaults read com.apple.HIToolbox AppleSelectedInputSources",
    { timeout: 5000 },
  );

  const nameMatch = /"KeyboardLayout Name"\s*=\s*"?([^";]+)"?/.exec(stdout);
  if (!nameMatch) return new Map();
  const layoutName = nameMatch[1]!.trim();

  // Let errors propagate so they surface in the UI rather than silently
  // degrading to an empty keystroke map.
  //
  // System layouts live in AppleKeyboardLayouts.bundle as a binary .dat
  // file, not as individual .keylayout XML. Only user-installed .keylayout
  // files can be parsed. This covers custom layouts; standard layouts lack
  // interesting compose sequences anyway.
  const userPath = join(
    homedir(),
    "Library",
    "Keyboard Layouts",
    `${layoutName}.keylayout`,
  );
  const systemPath = join(
    "/Library",
    "Keyboard Layouts",
    `${layoutName}.keylayout`,
  );

  for (const layoutPath of [userPath, systemPath]) {
    let xml: string;
    try {
      xml = await readFile(layoutPath, "utf-8");
    } catch {
      continue;
    }
    // Intentionally outside try/catch: if we found the file but parsing
    // fails, that's a bug worth surfacing, not a reason to try another path.
    const map = buildKeystrokeMap(xml);
    if (map.size === 0) {
      console.warn(`Parsed ${layoutPath} but keystroke map is empty`);
    }
    return map;
  }

  return new Map();
}
