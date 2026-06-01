// SPDX-FileCopyrightText: Copyright © 2026 Michael Shields
// SPDX-License-Identifier: MIT

// Counts code points in the Leipzig Corpora Collection English sentences and
// writes src/leipzig-freq.json (code point → raw count). Leipzig text is NOT
// Unicode-normalized, so it preserves the compatibility characters (™, ½, NBSP,
// …) that FineFreq's NFKC pipeline folds away — generate-data.ts calibrates
// these counts onto FineFreq's scale to rank those characters. CC BY (see
// NOTICE); run with `make leipzig` to refresh. Needs tar on PATH to extract.

import {
  createReadStream,
  existsSync,
  mkdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = join(PROJECT_ROOT, "data", "leipzig");
const OUT_PATH = join(PROJECT_ROOT, "src", "leipzig-freq.json");

// A news corpus and a web corpus, combined for broader symbol coverage. Both
// are the 1M-sentence English editions.
const CORPORA = ["eng-com_web-public_2018_1M", "eng_news_2020_1M"];
const BASE = "https://downloads.wortschatz-leipzig.de/corpora";

// Drop hapax noise; everything at or above this is committed.
const FLOOR = 2;

async function ensureSentences(id: string): Promise<string> {
  const sentences = join(CACHE_DIR, `${id}-sentences.txt`);
  if (existsSync(sentences)) return sentences;
  const tar = join(CACHE_DIR, `${id}.tar.gz`);
  if (!existsSync(tar)) {
    console.log(`  downloading ${id}…`);
    const res = await fetch(`${BASE}/${id}.tar.gz`);
    if (!res.ok) throw new Error(`Failed to download ${id}: ${res.status}`);
    // Write to a temp path then rename, so an interrupted run never leaves a
    // truncated tarball that a later run would treat as a valid cache.
    const part = `${tar}.part`;
    writeFileSync(part, Buffer.from(await res.arrayBuffer()));
    renameSync(part, tar);
  }
  // Node ships gzip but not tar, so extract the one sentences file we need with
  // the system tar. The member is named by its exact path (not a `*/` wildcard)
  // so it works the same under bsdtar and GNU tar.
  console.log(`  extracting ${id}-sentences.txt…`);
  execFileSync(
    "tar",
    [
      "-xzf",
      tar,
      "--strip-components=1",
      "-C",
      CACHE_DIR,
      `${id}/${id}-sentences.txt`,
    ],
    { stdio: "inherit" },
  );
  return sentences;
}

async function countFile(
  path: string,
  counts: Map<number, number>,
): Promise<void> {
  const rl = createInterface({
    input: createReadStream(path, "utf-8"),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    // Each line is "<id>\t<sentence>"; count the sentence only, skipping any
    // line without a tab so the numeric id digits are never tallied.
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    for (const ch of line.slice(tab + 1)) {
      const cp = ch.codePointAt(0)!;
      counts.set(cp, (counts.get(cp) ?? 0) + 1);
    }
  }
}

async function main(): Promise<void> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const counts = new Map<number, number>();
  for (const id of CORPORA) {
    const path = await ensureSentences(id);
    console.log(`  counting ${id}…`);
    await countFile(path, counts);
  }

  const obj: Record<string, number> = {};
  for (const cp of [...counts.keys()].sort((a, b) => a - b)) {
    const n = counts.get(cp)!;
    if (n >= FLOOR) obj[cp.toString(16).toUpperCase().padStart(4, "0")] = n;
  }
  writeFileSync(OUT_PATH, JSON.stringify(obj) + "\n");
  console.log(
    `  wrote ${Object.keys(obj).length} code-point counts to src/leipzig-freq.json`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
