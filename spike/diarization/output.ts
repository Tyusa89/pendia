import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Captures hold transcript text, so they may only be written to the git-ignored spike-output/ folder or to a place outside
 * this repository. Anything else (a tracked folder, the repo root) is refused. Files are created owner-only (0600).
 *
 * Paths are handled with Node's path functions and `fileURLToPath` (never a URL's `.pathname`, which is `/C:/...` on
 * Windows), and "inside the repository" is decided with `path.relative`, so it holds with backslashes and any drive letter.
 */
type PathModule = Pick<typeof path, "resolve" | "relative" | "isAbsolute" | "join" | "sep">;

/** The repository root for a module two folders below it (spike/<name>/file.ts). */
export function repoRootFrom(
  moduleUrl: string | URL,
  pm: PathModule = path,
  windows: boolean = process.platform === "win32",
): string {
  return pm.resolve(fileURLToPath(new URL("../..", moduleUrl), { windows }));
}

export const REPO = repoRootFrom(import.meta.url);

export type OutputClass = "outside" | "output" | "forbidden";

/** `outside` the repo (allowed), inside `spike-output/` (allowed), or anywhere else in the repo (forbidden). */
export function classifyOutputPath(p: string, repo: string, pm: PathModule = path): OutputClass {
  const rel = pm.relative(repo, pm.resolve(p));
  if (rel === "") return "forbidden"; // the repository root itself
  const climbs = rel === ".." || rel.startsWith(`..${pm.sep}`) || pm.isAbsolute(rel);
  if (climbs) return "outside"; // a different folder or drive
  const [first, ...rest] = rel.split(pm.sep);
  return first === "spike-output" && rest.length > 0 ? "output" : "forbidden";
}

export function safeOutputPath(requested: string | undefined, fallbackName: string): string {
  const p = path.resolve(requested ?? path.join(REPO, "spike-output", fallbackName));
  if (classifyOutputPath(p, REPO) === "forbidden")
    throw new Error(
      `Refusing to write ${p}: inside the repository but outside the git-ignored spike-output/ folder.`,
    );
  mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  return p;
}
