// Shell-agnostic layout invariants for every route at every approved width, plus the same checks with all four display
// preferences on. Valid on main today and still valid after the shell changes. Counts of known issues are ratcheted.
import { collectLayout, settle } from "../support/invariants.ts";
import { checkCount } from "../support/ratchet.ts";
import {
  ALL_PREFERENCES_ON,
  PREF_WIDTHS,
  PUBLIC_ROUTES,
  PUBLIC_WIDTHS,
  SIGNED_IN_ROUTES,
  SIGNED_IN_WIDTHS,
} from "../support/routes.ts";
import { expect, test } from "../support/test.ts";

const key = (path: string, w: number, suffix = "") => `${path}@${w}${suffix}`;

test.describe("signed-in routes", () => {
  test.use({ signedIn: true });
  for (const route of SIGNED_IN_ROUTES) {
    for (const w of SIGNED_IN_WIDTHS) {
      test(`${route.path} @${w}`, async ({ page }) => {
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
        await page.setViewportSize({ width: w, height: 900 });
        await page.goto(route.path, { waitUntil: "networkidle" });
        await settle(page);
        const f = await collectLayout(page);
        expect(errors, "uncaught page errors").toEqual([]);
        checkCount("overflow", key(route.path, w), f.overflowX, "horizontal overflow in px");
        expect(f.mains, "exactly one <main>").toBe(1);
        expect(f.navs, "some navigation is visible").toBeGreaterThan(0);
        expect(f.skipLink, "skip link to #care-content").toBe(true);
        expect(f.judgeBanner, "Judge Demo read-only banner").toBe(true);
        expect(f.medicalNote, "medical-advice note").toBe(true);
        checkCount(
          "target-sizes",
          key(route.path, w),
          f.smallTargets.length,
          f.smallTargets.join(" | "),
        );
        checkCount("clipped-text", key(route.path, w), f.clipped.length, f.clipped.join(" | "));
      });
    }
  }
});

test.describe("signed-in routes with every display preference on", () => {
  test.use({ signedIn: true, preferences: "all-on" });
  for (const route of SIGNED_IN_ROUTES) {
    for (const w of PREF_WIDTHS) {
      test(`${route.path} @${w} prefs`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: 900 });
        await page.goto(route.path, { waitUntil: "networkidle" });
        await settle(page);
        const f = await collectLayout(page);
        expect(f.prefs).toEqual({
          textSize: ALL_PREFERENCES_ON.textSize,
          highContrast: "true",
          reduceMotion: "true",
          largeButtons: "true",
        });
        expect(f.rootFontSize, "large text is 125% of 16px").toBe(20);
        checkCount(
          "overflow",
          key(route.path, w, ":prefs"),
          f.overflowX,
          "horizontal overflow in px",
        );
        expect(f.mains).toBe(1);
        checkCount(
          "target-sizes",
          key(route.path, w, ":prefs"),
          f.smallTargets.length,
          f.smallTargets.join(" | "),
        );
        checkCount(
          "clipped-text",
          key(route.path, w, ":prefs"),
          f.clipped.length,
          f.clipped.join(" | "),
        );
      });
    }
  }
});

test.describe("public routes", () => {
  for (const route of PUBLIC_ROUTES) {
    for (const w of PUBLIC_WIDTHS) {
      test(`${route.path} @${w}`, async ({ page }) => {
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
        await page.setViewportSize({ width: w, height: 900 });
        await page.goto(route.path, { waitUntil: "networkidle" });
        await settle(page);
        const f = await collectLayout(page);
        expect(errors, "uncaught page errors").toEqual([]);
        checkCount(
          "overflow",
          key(route.path, w, ":public"),
          f.overflowX,
          "horizontal overflow in px",
        );
        checkCount(
          "target-sizes",
          key(route.path, w, ":public"),
          f.smallTargets.length,
          f.smallTargets.join(" | "),
        );
        checkCount(
          "clipped-text",
          key(route.path, w, ":public"),
          f.clipped.length,
          f.clipped.join(" | "),
        );
      });
    }
  }
});
