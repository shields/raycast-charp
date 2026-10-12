import { readFileSync } from "node:fs";
import { characters } from "../../src/characters.js";
import { searchCharacters } from "../../src/search.js";

const kind = process.argv[2];
const value = process.argv[3];
const iterations = Number(process.argv[4]);
if (
  value === undefined ||
  !Number.isSafeInteger(iterations) ||
  iterations < 1
) {
  throw new Error("Expected a benchmark value and positive iteration count");
}

let work: () => unknown;
if (kind === "parse") {
  const raw = readFileSync(value, "utf8");
  work = () => JSON.parse(raw);
} else if (kind === "search") {
  work = () => searchCharacters(characters, value);
} else {
  throw new Error(`Unknown benchmark: ${kind}`);
}

for (let i = 0; i < 3; i++) work();
const start = process.threadCpuUsage();
for (let i = 0; i < iterations; i++) work();
const { user, system } = process.threadCpuUsage(start);
console.log((user + system) / 1000 / iterations);
