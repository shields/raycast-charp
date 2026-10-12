import { environment } from "@raycast/api";
import { open, url } from "node:inspector";
import { isMainThread, threadId } from "node:worker_threads";

export function startDevelopmentInspector(): (() => void) | undefined {
  if (!environment.isDevelopment) return undefined;

  // Debugging stays available during React unmount; worker termination closes the inspector.
  if (!url()) open(0, "127.0.0.1");
  const address = url();
  if (!address) throw new Error("Node inspector did not expose a debugger URL");
  console.log(
    "[Charp] debugger",
    JSON.stringify({
      pid: process.pid,
      node: process.version,
      isMainThread,
      threadId,
      url: address,
    }),
  );
  console.log(
    "[Charp] capture command",
    `npx tsx scripts/capture-raycast-stack.ts ${process.pid} '${address}'`,
  );
  return () => {
    console.log(
      "[Charp] command unmounted",
      JSON.stringify({ pid: process.pid, threadId, url: url() }),
    );
  };
}
