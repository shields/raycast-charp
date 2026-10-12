import { environment } from "@raycast/api";
import { open, url } from "node:inspector";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startDevelopmentInspector } from "../src/debug.js";

vi.mock("@raycast/api", () => ({ environment: { isDevelopment: true } }));
vi.mock("node:inspector", () => ({ open: vi.fn(), url: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(environment, "isDevelopment", "get").mockReturnValue(true);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("development inspector", () => {
  it("does not access the inspector outside development", () => {
    vi.spyOn(environment, "isDevelopment", "get").mockReturnValue(false);
    expect(startDevelopmentInspector()).toBeUndefined();
    expect(url).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it("keeps the worker inspector open across React cleanup and remount", () => {
    const dispose = vi.fn();
    vi.mocked(open).mockReturnValue({ [Symbol.dispose]: dispose });
    const address = "ws://127.0.0.1:54321/charp";
    vi.mocked(url).mockReturnValueOnce(undefined).mockReturnValue(address);

    const cleanup = startDevelopmentInspector();
    expect(open).toHaveBeenCalledExactlyOnceWith(0, "127.0.0.1");
    expect(console.log).toHaveBeenCalledWith(
      "[Charp] debugger",
      expect.stringContaining(address),
    );
    expect(console.log).toHaveBeenCalledWith(
      "[Charp] capture command",
      `npx tsx scripts/capture-raycast-stack.ts ${process.pid} '${address}'`,
    );
    expect(dispose).not.toHaveBeenCalled();
    expect(cleanup).toBeTypeOf("function");
    cleanup!();
    expect(dispose).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(
      "[Charp] command unmounted",
      expect.stringContaining(address),
    );
    startDevelopmentInspector();
    expect(open).toHaveBeenCalledOnce();
  });

  it("preserves an inspector that is already open", () => {
    vi.mocked(url).mockReturnValue("ws://127.0.0.1:54321/existing");
    expect(startDevelopmentInspector()).toBeTypeOf("function");
    expect(open).not.toHaveBeenCalled();
  });

  it("surfaces inspector startup failures", () => {
    vi.mocked(url).mockReturnValue(undefined);
    vi.mocked(open).mockImplementation(() => {
      throw new Error("inspector unavailable");
    });
    expect(startDevelopmentInspector).toThrow("inspector unavailable");
  });

  it("fails if opening the inspector does not provide a URL", () => {
    vi.mocked(url).mockReturnValue(undefined);
    expect(startDevelopmentInspector).toThrow("did not expose a debugger URL");
    expect(console.log).not.toHaveBeenCalled();
  });
});
