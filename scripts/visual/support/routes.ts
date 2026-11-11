export interface RouteSpec {
  path: string;
  /** Signed-in routes render inside the app shell and need the fake Judge Demo session. */
  signedIn: boolean;
}

// Every application and public route that exists on main. Judge Demo data supplies the content, so no backend is involved.
export const SIGNED_IN_ROUTES: RouteSpec[] = [
  "/family",
  "/members",
  "/visits",
  "/visits/new",
  "/visits/upload",
  "/visits/demo",
  "/visits/demo-appointment",
  "/visits/edit/demo-appointment",
  "/meds",
  "/coverage",
  "/handoffs",
  "/digest",
  "/ask",
  "/preferences",
  "/medical-integrations",
].map((path) => ({ path, signedIn: true }));

export const PUBLIC_ROUTES: RouteSpec[] = [
  "/",
  "/auth",
  "/pricing",
  "/about",
  "/contact",
  "/terms",
  "/privacy",
  "/demo",
  "/demo-meds",
].map((path) => ({ path, signedIn: false }));

/** Widths from the approved test matrix, plus the 767/768 and 1023/1024 breakpoint boundaries. */
export const SIGNED_IN_WIDTHS = [
  320, 375, 390, 767, 768, 820, 1023, 1024, 1280, 1440, 1920,
] as const;
export const PUBLIC_WIDTHS = [320, 768, 1024, 1440] as const;
export const A11Y_WIDTHS = [390, 820, 1440] as const;
export const PREF_WIDTHS = [320, 390, 820, 1440] as const;

/** All four existing display preferences on, in the exact shape PreferencesProvider stores. */
export const ALL_PREFERENCES_ON = {
  language: null,
  textSize: "large",
  highContrast: true,
  reduceMotion: true,
  largeButtons: true,
};
export const PREFERENCES_KEY = "pendia-display-preferences";
