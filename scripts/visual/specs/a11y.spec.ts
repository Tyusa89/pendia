// axe-core (WCAG 2.0/2.1 A and AA) on every signed-in route at three widths, with default preferences and with all four on.
// Violations are ratcheted per rule: no new rule and no higher node count than the recorded baseline.
import { axeCounts, settle } from "../support/invariants.ts";
import { checkCounts } from "../support/ratchet.ts";
import { A11Y_WIDTHS, PUBLIC_ROUTES, SIGNED_IN_ROUTES } from "../support/routes.ts";
import { test } from "../support/test.ts";

test.describe("axe: signed-in, default preferences", () => {
  test.use({ signedIn: true });
  for (const route of SIGNED_IN_ROUTES) {
    for (const w of A11Y_WIDTHS) {
      test(`${route.path} @${w}`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: 900 });
        await page.goto(route.path, { waitUntil: "networkidle" });
        await settle(page);
        checkCounts("axe", `${route.path}@${w}`, await axeCounts(page));
      });
    }
  }
});

test.describe("axe: signed-in, all display preferences on", () => {
  test.use({ signedIn: true, preferences: "all-on" });
  for (const route of SIGNED_IN_ROUTES) {
    for (const w of A11Y_WIDTHS) {
      test(`${route.path} @${w} prefs`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: 900 });
        await page.goto(route.path, { waitUntil: "networkidle" });
        await settle(page);
        checkCounts("axe", `${route.path}@${w}:prefs`, await axeCounts(page));
      });
    }
  }
});

test.describe("axe: public routes", () => {
  for (const route of PUBLIC_ROUTES) {
    for (const w of A11Y_WIDTHS) {
      test(`${route.path} @${w}`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: 900 });
        await page.goto(route.path, { waitUntil: "networkidle" });
        await settle(page);
        checkCounts("axe", `${route.path}@${w}:public`, await axeCounts(page));
      });
    }
  }
});
