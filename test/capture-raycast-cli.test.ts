import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(
  new URL("../scripts/capture-raycast-stack.ts", import.meta.url),
);

describe("stack capture CLI", () => {
  it.each(["direct", "linked file", "linked directory"])(
    "runs argument validation through a %s path",
    (kind) => {
      const directory = mkdtempSync(join(tmpdir(), "charp-capture-cli-"));
      try {
        let entry = script;
        if (kind === "linked file") {
          entry = join(directory, "capture.ts");
          symlinkSync(script, entry);
        } else if (kind === "linked directory") {
          const link = join(directory, "scripts");
          symlinkSync(dirname(script), link);
          entry = join(link, "capture-raycast-stack.ts");
        }
        const result = spawnSync(
          process.execPath,
          ["--import", "tsx", entry, "invalid"],
          { encoding: "utf8", timeout: 10_000 },
        );
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("Usage:");
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
