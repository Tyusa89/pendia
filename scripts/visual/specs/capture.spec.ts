// Produces the "before/after" screenshots reviewed by people. Output goes to ./visual-artifacts (git-ignored, uploaded by CI as an
// artifact) and is never committed. Run with fonts allowed so the images look like the real product:
//   ALLOW_FONTS=1 bun run visual:capture
import path from "node:path";
import { settle } from "../support/invariants.ts";
import { PUBLIC_ROUTES, SIGNED_IN_ROUTES } from "../support/routes.ts";
import { test } from "../support/test.ts";

const OUT = path.resolve(
  process.cwd(),
  "visual-artifacts",
  process.env["CAPTURE_LABEL"] ?? "before",
);
const name = (p: string) =>
  p === "/" ? "root" : p.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "_");

test.describe("signed-in", () => {
  test.use({ signedIn: true });
  for (const r of SIGNED_IN_ROUTES)
    for (const w of [390, 820, 1440])
      test(`capture ${r.path} @${w}`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: 900 });
        await page.goto(r.path, { waitUntil: "networkidle" });
        await settle(page);
        await page.screenshot({ path: path.join(OUT, `${name(r.path)}-${w}.png`), fullPage: true });
      });
});

test.describe("public", () => {
  for (const r of PUBLIC_ROUTES)
    for (const w of [390, 1440])
      test(`capture ${r.path} @${w}`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: 900 });
        await page.goto(r.path, { waitUntil: "networkidle" });
        await settle(page);
        await page.screenshot({
          path: path.join(OUT, `public-${name(r.path)}-${w}.png`),
          fullPage: true,
        });
      });
});
