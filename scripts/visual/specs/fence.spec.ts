// Proves the isolation itself: the app talks only to the local dead backend (answered by the fence), and a request to anywhere else
// is blocked and reported.
import { expect, test } from "../support/test.ts";
import { DEAD_BACKEND } from "../support/env.ts";

test.describe("network fence", () => {
  test.use({ signedIn: true });

  test("the signed-in app only ever reaches the local dead backend, never a real host", async ({
    page,
    blocked,
  }) => {
    const hosts = new Set<string>();
    page.on("request", (r) => hosts.add(new URL(r.url()).host));
    await page.goto("/family", { waitUntil: "networkidle" });
    await expect(page.locator("main").first()).toBeVisible();
    const external = [...hosts].filter(
      (h) =>
        !h.startsWith("127.0.0.1:") && !["fonts.googleapis.com", "fonts.gstatic.com"].includes(h),
    );
    expect(external, "unexpected external hosts contacted").toEqual([]);
    expect(
      hosts.has(new URL(DEAD_BACKEND).host),
      "the app should have asked the fenced fake auth endpoint",
    ).toBe(true);
    expect(blocked).toEqual([]);
  });

  test("a request to a non-local host is blocked and recorded", async ({ page, blocked }) => {
    await page.goto("/family", { waitUntil: "networkidle" });
    const outcome = await page.evaluate(() =>
      fetch("https://example.org/probe").then(
        () => "reached",
        () => "blocked",
      ),
    );
    expect(outcome).toBe("blocked");
    expect(blocked).toEqual(["GET example.org/probe"]);
    blocked.length = 0; // expected for this test only; the fixture asserts emptiness afterwards
  });

  test("the fake Judge session is what makes the app render signed-in pages", async ({ page }) => {
    await page.goto("/family", { waitUntil: "networkidle" });
    await expect(
      page.getByText("Interactive demo · Sample data only · Read-only · No real patient information"),
    ).toBeVisible();
  });
});

test.describe("public routes need no session", () => {
  test("the landing page renders with no backend call blocked", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Coordinate Care");
  });
});
