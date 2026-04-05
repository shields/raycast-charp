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

const MODIFIER_MAP: Record<number, ModifierInfo> = {
  0: { label: "", priority: 0 },
  1: { label: "⇧", priority: 1 },
  2: { label: "⇪", priority: 3 },
  3: { label: "⌥", priority: 2 },
  4: { label: "⇧⌥", priority: 4 },
  5: { label: "⇪⌥", priority: 5 },
  7: { label: "", priority: 10 },
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

/**
 * Derive key labels from the base layer of the layout itself,
 * so labels match the user's actual keyboard (AZERTY, QWERTZ, etc.).
 */
function deriveKeyLabels(
  keyMaps: Map<number, Map<number, string>>,
  keyActions: Map<number, Map<number, string>>,
  actionDefs: Map<string, ActionWhen[]>,
): Map<number, string> {
  const labels = new Map<number, string>();

  // Direct outputs from the base layer (index 0)
  const baseOutputs = keyMaps.get(0);
  if (baseOutputs) {
    for (const [code, output] of baseOutputs) {
      const cp = output.codePointAt(0);
      if (cp === undefined || isControlChar(cp)) continue;
      labels.set(code, output.toUpperCase());
    }
  }

  // Also resolve action-based keys on the base layer (state="none" output)
  const baseActions = keyActions.get(0);
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
        labels.set(code, noneOutput.output.toUpperCase());
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
  terminators: Map<string, string>;
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
      terminators: new Map(),
    };
  }

  // Parse keyMapSet → keyMap[]
  const keyMapSet = keyboard["keyMapSet"] as
    | Record<string, unknown>
    | undefined;
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

  // Parse terminators
  const terminators = new Map<string, string>();
  const rawTerminators = (
    keyboard["terminators"] as Record<string, unknown> | undefined
  )?.["when"] as WhenElement | WhenElement[] | undefined;
  for (const t of toArray(rawTerminators)) {
    if (t["@_output"] !== undefined) {
      terminators.set(String(t["@_state"]), String(t["@_output"]));
    }
  }

  return { keyMaps, keyActions, actionDefs, terminators };
}

export function buildKeystrokeMap(
  keylayoutXml: string,
): Map<string, KeystrokeDescription> {
  const {
    keyMaps,
    keyActions,
    actionDefs,
    terminators: _terminators,
  } = parseKeylayout(keylayoutXml);
  const keyLabels = deriveKeyLabels(keyMaps, keyActions, actionDefs);
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
      const oldPri = MODIFIER_MAP[existing.modifierIndex]?.priority ?? 99;
      const newPri = MODIFIER_MAP[modIndex]?.priority ?? 99;
      if (newPri < oldPri) {
        directMap.set(output, { modifierIndex: modIndex, keyCode });
      }
    }
  }

  // Collect direct outputs from keyMaps
  for (const [modIndex, outputs] of keyMaps) {
    if (MODIFIER_MAP[modIndex] === undefined) continue;
    for (const [keyCode, output] of outputs) {
      addDirect(output, modIndex, keyCode);
    }
  }

  // Collect direct outputs from actions (state="none" → output)
  for (const [modIndex, actions] of keyActions) {
    if (MODIFIER_MAP[modIndex] === undefined) continue;
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
    const mod = MODIFIER_MAP[info.modifierIndex];
    if (!mod) continue;
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

  // Build reverse index: state name → trigger info
  const stateToTrigger = new Map<
    string,
    { modifierLabel: string; keyLabel: string }
  >();
  for (const [, dkt] of deadKeyTriggers) {
    for (const trigger of dkt.triggers) {
      const mod = MODIFIER_MAP[trigger.modifierIndex];
      if (!mod) continue;
      // Prefer simplest modifier trigger for each state
      if (!stateToTrigger.has(dkt.state)) {
        stateToTrigger.set(dkt.state, {
          modifierLabel: mod.label,
          keyLabel: labelFor(trigger.keyCode),
        });
      }
    }
  }

  // Emit dead key keystrokes
  for (const [modIndex, actions] of keyActions) {
    if (MODIFIER_MAP[modIndex] === undefined) continue;
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
  try {
    const { stdout } = await execAsync(
      "defaults read com.apple.HIToolbox AppleSelectedInputSources",
      { timeout: 5000 },
    );

    const nameMatch = /"KeyboardLayout Name"\s*=\s*"?([^";]+)"?/.exec(stdout);
    if (!nameMatch) return new Map();
    const layoutName = nameMatch[1]!.trim();

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
      try {
        const xml = await readFile(layoutPath, "utf-8");
        return buildKeystrokeMap(xml);
      } catch {
        continue;
      }
    }

    return new Map();
  } catch {
    return new Map();
  }
}
