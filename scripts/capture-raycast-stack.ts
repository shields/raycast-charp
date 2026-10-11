import { execFileSync } from "node:child_process";
import { once } from "node:events";
import type { Debugger, Runtime } from "node:inspector";
import { setTimeout as delay } from "node:timers/promises";

const timeoutMilliseconds = 5_000;

function findProcess(): number {
  const explicitPid = process.argv[2];
  if (explicitPid !== undefined) {
    if (!/^[1-9]\d*$/.test(explicitPid) || Number(explicitPid) < 2) {
      throw new Error(
        "Usage: npx tsx scripts/capture-raycast-stack.ts [node-pid]",
      );
    }
    return Number(explicitPid);
  }

  const processes = execFileSync("ps", ["-eo", "pid,command"], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(
      (line) =>
        line.includes("Raycast Helper (Extensions)") ||
        (line.includes("Raycast.app") && line.includes("bin/node")),
    );
  if (processes.length !== 1) {
    throw new Error(
      `Expected one Raycast extension process; found ${processes.length}. Keep the hung command open, or provide its Node PID as an argument.`,
    );
  }
  return Number(processes[0]!.trim().split(/\s+/, 1)[0]);
}

async function inspectorUrl(): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:9229/json/list", {
        signal: AbortSignal.timeout(500),
      });
      if (!response.ok) throw new Error(`Inspector HTTP ${response.status}`);
      const targets = (await response.json()) as {
        webSocketDebuggerUrl?: string;
      }[];
      const url = targets[0]?.webSocketDebuggerUrl;
      if (targets.length !== 1 || !url) {
        throw new Error("Expected one Node inspector target on port 9229");
      }
      const parsed = new URL(url);
      if (parsed.protocol !== "ws:" || parsed.hostname !== "127.0.0.1") {
        throw new Error("Expected a local Node inspector WebSocket");
      }
      return url;
    } catch (error) {
      lastError = error;
      await delay(100);
    }
  }
  throw new Error("Could not reach the Node inspector on port 9229", {
    cause: lastError,
  });
}

type InspectorMessage = {
  id?: number;
  result?: unknown;
  error?: { message: string };
  method?: string;
  params?: unknown;
};

async function capture(pid: number): Promise<void> {
  process.kill(pid, "SIGUSR1");
  const socket = new WebSocket(await inspectorUrl());
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const scripts = new Map<string, string>();
  let nextId = 0;
  let paused = false;
  let pauseRequested = false;
  let onPause: ((event: Debugger.PausedEventDataType) => void) | undefined;

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as InspectorMessage;
    if (message.id !== undefined) {
      const request = pending.get(message.id);
      if (message.error) request?.reject(new Error(message.error.message));
      else request?.resolve(message.result);
    } else if (message.method === "Debugger.scriptParsed") {
      const script = message.params as Debugger.ScriptParsedEventDataType;
      scripts.set(script.scriptId, script.url);
    } else if (message.method === "Debugger.paused") {
      paused = true;
      onPause?.(message.params as Debugger.PausedEventDataType);
    } else if (message.method === "Debugger.resumed") {
      paused = false;
    }
  });
  socket.addEventListener("close", () => {
    for (const request of pending.values()) {
      request.reject(new Error("Inspector connection closed"));
    }
  });

  async function send<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const id = ++nextId;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return (await new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        timer = setTimeout(
          () => reject(new Error(`Inspector timed out: ${method}`)),
          timeoutMilliseconds,
        );
        socket.send(JSON.stringify({ id, method, params }));
      })) as T;
    } finally {
      clearTimeout(timer);
      pending.delete(id);
    }
  }

  try {
    await once(socket, "open", {
      signal: AbortSignal.timeout(timeoutMilliseconds),
    });
    const identity = await send<Runtime.EvaluateReturnType>(
      "Runtime.evaluate",
      {
        expression: "({ pid: process.pid, version: process.version })",
        returnByValue: true,
        timeout: timeoutMilliseconds,
      },
    );
    const value = identity.result.value as
      { pid: number; version: string } | undefined;
    if (value?.pid !== pid) {
      throw new Error(
        `Inspector belongs to PID ${value?.pid ?? "unknown"}, expected ${pid}. Close the other Node debugger using port 9229 and retry.`,
      );
    }
    console.log(`Raycast extension PID ${pid}, Node ${value.version}`);
    await send("Debugger.enable");

    const frames = new Promise<Debugger.PausedEventDataType>((resolve) => {
      onPause = resolve;
    });
    pauseRequested = true;
    await send("Debugger.pause");
    let pauseTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const event = await Promise.race([
        frames,
        new Promise<never>((_, reject) => {
          pauseTimer = setTimeout(
            () => reject(new Error("No JavaScript pause event received")),
            timeoutMilliseconds,
          );
        }),
      ]);
      console.log(`Pause reason: ${event.reason}`);
      for (const frame of event.callFrames.slice(0, 20)) {
        const location = frame.location;
        const url = scripts.get(location.scriptId) || frame.url || "<unknown>";
        console.log(
          `  ${frame.functionName || "<anonymous>"} at ${url}:${location.lineNumber + 1}:${(location.columnNumber ?? 0) + 1}`,
        );
      }
      for (const frame of event.callFrames.slice(0, 3)) {
        const location = frame.location;
        const { scriptSource } = await send<Debugger.GetScriptSourceReturnType>(
          "Debugger.getScriptSource",
          { scriptId: location.scriptId },
        );
        const line = scriptSource.split("\n")[location.lineNumber] ?? "";
        const column = location.columnNumber ?? 0;
        console.log(
          `Source near ${frame.functionName || "<anonymous>"}: ${line.slice(Math.max(0, column - 150), column + 250)}`,
        );
      }
    } finally {
      clearTimeout(pauseTimer);
    }
  } finally {
    try {
      if (socket.readyState === WebSocket.OPEN && pauseRequested) {
        if (paused) await send("Debugger.resume");
        await send("Debugger.disable");
        console.log("Debugger detached; execution resumed.");
      }
    } finally {
      socket.close();
    }
  }
}

capture(findProcess()).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
