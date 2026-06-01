// SPDX-FileCopyrightText: Copyright © 2026 Michael Shields
// SPDX-License-Identifier: MIT

// Runtime stub for @raycast/api. The real package ships type declarations only
// (Raycast injects the implementation when it builds the extension), so it has
// no resolvable entry point for vitest. This stub provides inert bindings so
// imports resolve; tests that exercise these APIs replace them with vi.mock.

const inert = () => (): null => null;

export const LocalStorage = {
  getItem: async (): Promise<string | undefined> => undefined,
  setItem: async (): Promise<void> => {},
  removeItem: async (): Promise<void> => {},
  clear: async (): Promise<void> => {},
};

export const Clipboard = {
  copy: async (): Promise<void> => {},
  paste: async (): Promise<void> => {},
};

export const showHUD = async (): Promise<void> => {};

export const Icon = {
  Clipboard: "Clipboard",
  CopyClipboard: "CopyClipboard",
} as const;

export const List = Object.assign(inert(), {
  EmptyView: inert(),
  Item: Object.assign(inert(), { Detail: inert() }),
});

export const Action = Object.assign(inert(), { CopyToClipboard: inert() });

export const ActionPanel = inert();
