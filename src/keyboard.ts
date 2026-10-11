// SPDX-FileCopyrightText: Copyright © 2026 Michael Shields
// SPDX-License-Identifier: MIT

import { systemKeystrokes } from "swift:../swift";
import type { KeystrokeDescription } from "./types.js";

interface NativeKeystroke extends KeystrokeDescription {
  character: string;
}

export async function loadKeystrokeMap(): Promise<
  Map<string, KeystrokeDescription>
> {
  const entries = JSON.parse(await systemKeystrokes()) as NativeKeystroke[];
  return new Map(
    entries.map(({ character, ...keystroke }) => [character, keystroke]),
  );
}
