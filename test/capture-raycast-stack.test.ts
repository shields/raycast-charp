import { execFileSync, spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findProcess,
  inspectorUrl,
  localInspectorUrl,
} from "../scripts/capture-raycast-stack.js";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
  spawnSync: vi.fn(),
}));

const ps = vi.mocked(execFileSync);
const lsof = vi.mocked(spawnSync);
const fetchInspector = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchInspector);
  vi.spyOn(process, "kill").mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function sockets(stdout: string, status = 0): ReturnType<typeof spawnSync> {
  return {
    pid: 999,
    output: [null, stdout, ""],
    stdout,
    stderr: "",
    signal: null,
    status,
  };
}

describe("Raycast process discovery", () => {
  it("finds Raycast Backend among native helpers and unrelated Node processes", () => {
    ps.mockReturnValue(`
       1351 1 /Applications/Raycast.app/Contents/MacOS/Raycast
       1392 1351 Raycast Backend
       1490 1 /Applications/Raycast.app/Contents/XPCServices/Raycast Accessibility.xpc/Contents/MacOS/com.raycast.macos.Accessibility
       1512 1 /Applications/Raycast.app/Contents/XPCServices/Raycast Pasteboard.xpc/Contents/MacOS/com.raycast.macos.Pasteboard
       32499 32309 node
       36906 1 /opt/homebrew/bin/node
       38742 38597 node
       60053 60030 node
       60072 60053 /Volumes/Data/src/github.com/shields/raycast-charp/node_modules/@esbuild/darwin-arm64/bin/esbuild
       61773 59750 npm exec tsx scripts/capture-raycast-stack.ts
       61845 61773 node
       61867 61845 /opt/homebrew/Cellar/node/26.11.1/bin/node
    `);
    expect(findProcess()).toBe(1392);
  });

  it("requires the named backend to belong to Raycast", () => {
    ps.mockReturnValue("1392 1 Raycast Backend\n");
    expect(() => findProcess()).toThrow("found 0");
    expect(process.kill).not.toHaveBeenCalled();
  });

  it("finds a bundled Node executable outside bin/node", () => {
    ps.mockReturnValue(`
       100 1 /Applications/Raycast.app/Contents/MacOS/Raycast
       101 100 /Applications/Raycast.app/Contents/Resources/node
       200 1 /opt/homebrew/bin/node
    `);
    expect(findProcess()).toBe(101);
    expect(ps).toHaveBeenCalledWith("ps", ["axww", "-o", "pid=,ppid=,comm="], {
      encoding: "utf8",
      timeout: 5_000,
    });
  });

  it("uses ancestry to identify Node and excludes its subprocesses", () => {
    ps.mockReturnValue(`
       100 1 /Volumes/External Apps/Raycast Beta.app/Contents/MacOS/Raycast
       101 100 /opt/homebrew/bin/node
       102 101 /bin/sh
       103 102 /opt/homebrew/bin/node
       200 1 /opt/homebrew/bin/node
    `);
    expect(findProcess()).toBe(101);
  });

  it("recognizes the named extension helper", () => {
    ps.mockReturnValue("101 1 Raycast Helper (Extensions)\n");
    expect(findProcess()).toBe(101);
  });

  it("reports the process names when the runtime cannot be identified", () => {
    ps.mockReturnValue(`
       100 1 /Applications/Raycast.app/Contents/MacOS/Raycast
       200 1 /opt/homebrew/bin/node
    `);
    expect(() => findProcess()).toThrow("found 0");
    expect(() => findProcess()).toThrow(
      "PID 200, parent 1: /opt/homebrew/bin/node",
    );
    expect(process.kill).not.toHaveBeenCalled();
  });

  it("refuses to choose between independent Raycast runtimes", () => {
    ps.mockReturnValue(`
       100 1 /Applications/Raycast.app/Contents/MacOS/Raycast
       101 100 /opt/homebrew/bin/node
       102 100 /opt/homebrew/bin/node
    `);
    expect(() => findProcess()).toThrow("found 2");
    expect(process.kill).not.toHaveBeenCalled();
  });

  it("accepts an explicit PID without searching processes", () => {
    expect(findProcess("1234")).toBe(1234);
    expect(ps).not.toHaveBeenCalled();
  });

  it.each(["0", "1", "-2", "node"])("rejects invalid PID %s", (value) => {
    expect(() => findProcess(value)).toThrow("Usage:");
    expect(process.kill).not.toHaveBeenCalled();
  });
});

describe("Raycast inspector discovery", () => {
  it("accepts an exact debugger URL without process or port discovery", () => {
    const url = "ws://127.0.0.1:57734/94646570-e945-4e43-baed-8123f7ebf38e";
    expect(localInspectorUrl(url).href).toBe(url);
    expect(ps).not.toHaveBeenCalled();
    expect(lsof).not.toHaveBeenCalled();
  });

  it.each([
    "https://127.0.0.1:57734/debugger",
    "ws://example.com:57734/debugger",
    "ws://127.0.0.1/debugger",
  ])("rejects a debugger URL outside loopback: %s", (url) => {
    expect(() => localInspectorUrl(url)).toThrow("Expected a loopback");
  });

  it("connects to an existing inspector on a random port without signaling", async () => {
    lsof.mockReturnValue(sockets("p101\nn127.0.0.1:54321\n"));
    const url = "ws://127.0.0.1:54321/inspector-id";
    fetchInspector.mockResolvedValue(
      Response.json([{ webSocketDebuggerUrl: url }]),
    );

    expect(await inspectorUrl(101)).toBe(url);
    expect(lsof).toHaveBeenCalledWith(
      "lsof",
      ["-nP", "-a", "-p", "101", "-iTCP", "-sTCP:LISTEN", "-Fn"],
      { encoding: "utf8", timeout: 5_000 },
    );
    expect(fetchInspector.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:54321/json/list",
    );
    expect(process.kill).not.toHaveBeenCalled();
  });

  it("enables a closed inspector and discovers the newly opened port", async () => {
    lsof
      .mockReturnValueOnce(sockets("", 1))
      .mockReturnValue(sockets("p101\nn127.0.0.1:54322\n"));
    const url = "ws://127.0.0.1:54322/inspector-id";
    fetchInspector.mockResolvedValue(
      Response.json([{ webSocketDebuggerUrl: url }]),
    );

    expect(await inspectorUrl(101)).toBe(url);
    expect(process.kill).toHaveBeenCalledExactlyOnceWith(101, "SIGUSR1");
  });

  it("ignores other HTTP services owned by the same process", async () => {
    lsof.mockReturnValue(sockets("p101\nn127.0.0.1:54320\nn127.0.0.1:54321\n"));
    const url = "ws://127.0.0.1:54321/inspector-id";
    fetchInspector
      .mockResolvedValueOnce(new Response("Not found", { status: 404 }))
      .mockResolvedValueOnce(Response.json([{ webSocketDebuggerUrl: url }]));

    expect(await inspectorUrl(101)).toBe(url);
    expect(fetchInspector).toHaveBeenCalledTimes(2);
    expect(process.kill).not.toHaveBeenCalled();
  });

  it("surfaces port inspection errors before sending a signal", async () => {
    lsof.mockReturnValue({
      ...sockets("", 1),
      stderr: "permission denied",
    });
    await expect(inspectorUrl(101)).rejects.toThrow("permission denied");
    expect(process.kill).not.toHaveBeenCalled();
  });
});
