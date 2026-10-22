import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Captures hold transcript text, so they may only be written to the git-ignored spike-output/ folder or to a place outside
 * this repository. Anything else (a tracked folder, the repo root) is refused. Files are created owner-only (0600).
 */
export const REPO = resolve(new URL("../..", import.meta.url).pathname);
export function safeOutputPath(requested: string | undefined, fallbackName: string): string {
  const p = resolve(requested ?? `${REPO}/spike-output/${fallbackName}`);
  const insideRepo = p === REPO || p.startsWith(`${REPO}/`);
  if (insideRepo && !p.startsWith(`${REPO}/spike-output/`))
    throw new Error(
      `Refusing to write ${p}: inside the repository but outside the git-ignored spike-output/ folder.`,
    );
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  return p;
}
