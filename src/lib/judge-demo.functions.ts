import { createServerFn } from "@tanstack/react-start";
import { JUDGE_DEMO_USER_ID } from "./judge-demo";

// Intentionally public: grants only the dedicated guest identity, never an existing user's identity.
export const startJudgeDemo = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: account, error } = await supabaseAdmin.auth.admin.getUserById(JUDGE_DEMO_USER_ID);
  const { data: memberships, error: membershipError } = await supabaseAdmin.from("member").select("id").eq("user_id", JUDGE_DEMO_USER_ID).limit(1);
  if (error || membershipError || !account.user?.email || !memberships || memberships.length) {
    throw new Error("The judge demo is unavailable. Please try again later.");
  }
  // A fresh non-persistent client per request: concurrent judges must never share mutable auth state.
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  const password = process.env["PENDIA_JUDGE_DEMO_PASSWORD"];
  if (!url || !key || !password) throw new Error("The judge demo is unavailable.");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => {
    const headers = new Headers(init?.headers);
    if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) headers.delete("Authorization");
    headers.set("apikey", key);
    return fetch(input, { ...init, headers });
  } } });
  const { data, error: sessionError } = await client.auth.signInWithPassword({ email: account.user.email, password });
  if (sessionError || !data.session || data.session.user.id !== JUDGE_DEMO_USER_ID) throw new Error("The judge demo could not start.");
  return { access_token: data.session.access_token, refresh_token: data.session.refresh_token };
});