import { execFile, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(
  new URL("../scripts/capture-raycast-stack.ts", import.meta.url),
);

describe("stack capture CLI", () => {
  it("reports a rejected WebSocket handshake and exits unsuccessfully", async () => {
    const server = createServer();
    server.on("upgrade", (_request, socket) => {
      socket.end(
        "HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const { port } = server.address() as AddressInfo;
      const capture = promisify(execFile)(
        process.execPath,
        [
          "--import",
          "tsx",
          script,
          String(process.pid),
          `ws://127.0.0.1:${port}/missing`,
        ],
        { encoding: "utf8", timeout: 10_000 },
      );
      await expect(capture).rejects.toMatchObject({
        code: 1,
        stdout: expect.stringContaining("Connecting to"),
        stderr: expect.stringContaining("Could not connect to inspector"),
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

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
