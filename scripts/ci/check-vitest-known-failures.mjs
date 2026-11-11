// Compares a Vitest JSON report with the allow-list of failures that already existed on main.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const report = JSON.parse(fs.readFileSync(process.argv[2] ?? "vitest-results.json", "utf8"));
const known = JSON.parse(
  fs.readFileSync(path.join(root, "scripts/ci/known-failures.json"), "utf8"),
).failures;
const rel = (f) => path.relative(root, f).split(path.sep).join("/");

const failed = [];
for (const suite of report.testResults ?? []) {
  const file = rel(suite.name);
  const assertions = suite.assertionResults ?? [];
  for (const t of assertions)
    if (t.status === "failed") failed.push({ file, name: t.fullName ?? t.title });
  if (suite.status === "failed" && !assertions.some((t) => t.status === "failed"))
    failed.push({ file, name: "(suite failed to run)" });
}

const isKnown = (f) => known.some((k) => k.file === f.file && k.name === f.name);
const unexpected = failed.filter((f) => !isKnown(f));
const tolerated = failed.filter(isKnown);
const nowPassing = known.filter((k) => !failed.some((f) => f.file === k.file && f.name === k.name));

console.log(
  `vitest: ${report.numPassedTests} passed, ${report.numFailedTests} failed, ${report.numTotalTests} total`,
);
for (const f of tolerated) console.log(`  known failure (tolerated): ${f.file} > ${f.name}`);
for (const k of nowPassing)
  console.log(`  note: known failure currently passes: ${k.file} > ${k.name}`);
if (unexpected.length) {
  console.error("UNEXPECTED test failures:");
  for (const f of unexpected) console.error(`  ${f.file} > ${f.name}`);
  process.exit(1);
}
console.log("vitest: no unexpected failures");
