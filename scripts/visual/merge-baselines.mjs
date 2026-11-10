// Merges the per-test records written during `UPDATE_VISUAL_BASELINES=1` runs into the committed baseline JSON files.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const updates = path.join(root, "test-results/baseline-updates");
const out = path.join(root, "scripts/visual/baselines");
if (!fs.existsSync(updates)) {
  console.error("No baseline updates found. Run `bun run visual:baselines` first.");
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(updates).filter((x) => x.endsWith(".jsonl"))) {
  const merged = {};
  for (const line of fs.readFileSync(path.join(updates, f), "utf8").split("\n").filter(Boolean)) {
    const { key, value } = JSON.parse(line);
    merged[key] = value;
  }
  const sorted = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(
    path.join(out, f.replace(/\.jsonl$/, ".json")),
    JSON.stringify(sorted, null, 2) + "\n",
  );
  console.log(
    `wrote baselines/${f.replace(/\.jsonl$/, ".json")} (${Object.keys(sorted).length} keys)`,
  );
}
