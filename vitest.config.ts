// SPDX-FileCopyrightText: Copyright © 2026 Michael Shields
// SPDX-License-Identifier: MIT

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // The real @raycast/api ships only type declarations, so point its
      // runtime at a stub for tests (see test/stubs/raycast-api.ts).
      "@raycast/api": fileURLToPath(
        new URL("./test/stubs/raycast-api.ts", import.meta.url),
      ),
    },
  },
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
