// Shared Playwright `test` with an always-on network fence.
//
// Every request the browser makes is intercepted. Only the local app server and the local harness server are allowed through; the
// single fake auth call the Judge Demo needs is answered locally; Google Fonts are answered with empty responses (hermetic, fallback
// fonts) unless ALLOW_FONTS=1 (screenshot capture only). Anything else is aborted AND recorded, and the test fails if even one such
// request was attempted. Combined with the dead-backend environment in ./env.ts, no test can reach a real service.
import { expect, test as base } from "@playwright/test";
import { APP_PORT, AUTH_STORAGE_KEY, DEAD_BACKEND, HARNESS_PORT } from "./env.ts";
import { ALL_PREFERENCES_ON, PREFERENCES_KEY } from "./routes.ts";

/** The dedicated fictional Judge identity (public marker in src/lib/judge-demo.ts). Not a real account. */
const JUDGE_USER_ID = "cd7b5f56-40b6-4416-9951-af5a3cf651d4";
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const FAR_FUTURE = 4102444800;

const USER = {
  id: JUDGE_USER_ID,
  aud: "authenticated",
  role: "authenticated",
  email: "judge@example.invalid",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};
const SESSION = {
  access_token: `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: JUDGE_USER_ID, aud: "authenticated", role: "authenticated", exp: FAR_FUTURE })}.fake`,
  refresh_token: "fake-refresh",
  expires_in: 3600,
  expires_at: FAR_FUTURE,
  token_type: "bearer",
  user: USER,
};

const LOCAL_HOSTS = new Set([`127.0.0.1:${APP_PORT}`, `127.0.0.1:${HARNESS_PORT}`]);
const FONT_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);
const DEAD_HOST = new URL(DEAD_BACKEND).host;

export interface FenceOptions {
  /** Start with the fake Judge Demo session and the Judge marker (signed-in routes). */
  signedIn: boolean;
  /** "all-on" stores every display preference as enabled before the app starts. */
  preferences: "default" | "all-on";
}

export const test = base.extend<FenceOptions & { blocked: string[] }>({
  signedIn: [false, { option: true }],
  preferences: ["default", { option: true }],
  blocked: [
    async ({ context, signedIn, preferences }, use) => {
      const blocked: string[] = [];
      await context.addInitScript(
        (a) => {
          try {
            if (a.signedIn) {
              localStorage.setItem(a.authKey, JSON.stringify(a.session));
              sessionStorage.setItem("pendia.judgeDemo", "true");
            }
            if (a.prefs) localStorage.setItem(a.prefKey, JSON.stringify(a.prefs));
          } catch {
            /* storage unavailable: the app handles that itself */
          }
        },
        {
          signedIn,
          authKey: AUTH_STORAGE_KEY,
          session: SESSION,
          prefKey: PREFERENCES_KEY,
          prefs: preferences === "all-on" ? ALL_PREFERENCES_ON : null,
        },
      );
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (LOCAL_HOSTS.has(url.host)) return route.continue();
        if (signedIn && url.host === DEAD_HOST && url.pathname === "/auth/v1/user") {
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(USER),
          });
        }
        if (FONT_HOSTS.has(url.host)) {
          if (process.env["ALLOW_FONTS"] === "1") return route.continue();
          return route.fulfill({
            status: 200,
            contentType: url.host === "fonts.googleapis.com" ? "text/css" : "font/woff2",
            body: "",
          });
        }
        blocked.push(`${route.request().method()} ${url.host}${url.pathname}`);
        return route.abort();
      });
      await use(blocked);
      expect(blocked, "the browser attempted requests outside the fence").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
