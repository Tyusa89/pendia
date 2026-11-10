// A ratchet, not a pixel gate. Baselines (small JSON files committed under ./baselines) record today's counts of known layout and
// accessibility issues per route and width. A test fails only if a count GETS WORSE; improvements pass and can be re-recorded.
// Appearance is expected to change during the redesign, so screenshots are reviewed by people as CI artifacts instead.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINES = path.resolve(HERE, "../baselines");
const UPDATES = path.resolve(HERE, "../../../test-results/baseline-updates");

export const UPDATING = process.env["UPDATE_VISUAL_BASELINES"] === "1";

type Json = Record<string, number | Record<string, number>>;
const cache = new Map<string, Json>();

function load(name: string): Json {
  const hit = cache.get(name);
  if (hit) return hit;
  const file = path.join(BASELINES, `${name}.json`);
  const data: Json = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Json) : {};
  cache.set(name, data);
  return data;
}

function record(name: string, key: string, value: unknown): void {
  fs.mkdirSync(UPDATES, { recursive: true });
  fs.appendFileSync(path.join(UPDATES, `${name}.jsonl`), JSON.stringify({ key, value }) + "\n");
}

export function checkCount(name: string, key: string, actual: number, detail = ""): void {
  if (UPDATING) return record(name, key, actual);
  const allowed = (load(name)[key] as number | undefined) ?? 0;
  expect(actual, `${name} ${key}: ${actual} > baseline ${allowed}. ${detail}`).toBeLessThanOrEqual(
    allowed,
  );
}

export function checkCounts(name: string, key: string, actual: Record<string, number>): void {
  if (UPDATING) return record(name, key, actual);
  const allowed = (load(name)[key] as Record<string, number> | undefined) ?? {};
  const worse = Object.entries(actual).filter(([rule, n]) => n > (allowed[rule] ?? 0));
  expect(worse, `${name} ${key}: new or increased violations (rule, count)`).toEqual([]);
}
