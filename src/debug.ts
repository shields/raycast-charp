import { environment } from "@raycast/api";
import { open, url } from "node:inspector";
import { isMainThread, threadId } from "node:worker_threads";

export function startDevelopmentInspector(): (() => void) | undefined {
  if (!environment.isDevelopment) return undefined;

  const inspector = url() ? undefined : open(0, "127.0.0.1");
  console.log(
    "[Charp] debugger",
    JSON.stringify({
      pid: process.pid,
      node: process.version,
      isMainThread,
      threadId,
      url: url(),
    }),
  );
  return inspector ? () => inspector[Symbol.dispose]() : undefined;
}
