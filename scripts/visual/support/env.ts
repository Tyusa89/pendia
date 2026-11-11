// Ports and the environment the app's dev server is started with for browser tests.
//
// ISOLATION: every Supabase address is pointed at a dead local port and every secret is blanked, so neither the browser nor the
// dev server can reach production, another Supabase project, Meta, or any other backend. The browser side is additionally fenced
// request by request in ./test.ts. Nothing here changes the application's own configuration; it only overrides the dev-server
// process environment for the duration of a test run.
export const APP_PORT = 5310;
export const HARNESS_PORT = 5311;
export const DEAD_BACKEND = "http://127.0.0.1:9";
export const FAKE_PUBLISHABLE_KEY = "sb_publishable_visual_fence_not_a_real_key";

export const FENCE_ENV: Record<string, string> = {
  VITE_SUPABASE_URL: DEAD_BACKEND,
  VITE_SUPABASE_PUBLISHABLE_KEY: FAKE_PUBLISHABLE_KEY,
  VITE_SUPABASE_PROJECT_ID: "visual-fence",
  SUPABASE_URL: DEAD_BACKEND,
  SUPABASE_PUBLISHABLE_KEY: FAKE_PUBLISHABLE_KEY,
  SUPABASE_ANON_KEY: FAKE_PUBLISHABLE_KEY,
  SUPABASE_PROJECT_ID: "visual-fence",
  SUPABASE_SERVICE_ROLE_KEY: "",
  META_API_KEY: "",
  DOC_EXTRACT_ENABLED: "",
  DOC_EXTRACT_SIMULATED: "",
  DOC_EXTRACT_USER_IDS: "",
  JUDGE_AGENT_ENABLED: "",
  GUEST_AGENT_ENABLED: "",
  CARE_AGENT_ENABLED: "",
};

/** supabase-js derives its auth storage key from the first label of the URL host ("127" for 127.0.0.1). */
export const AUTH_STORAGE_KEY = "sb-127-auth-token";
