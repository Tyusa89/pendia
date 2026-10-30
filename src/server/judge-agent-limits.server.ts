// Durable, atomic ad-hoc counters. No question, answer, family record or raw IP is stored.
export const JUDGE_AGENT_RATE = { sessionHourly: 10, ipHourly: 30, globalDaily: 100, cooldownSeconds: 20 } as const;
export interface JudgeAgentEnv {
  JUDGE_AGENT_LIVE_ENABLED?: string;
  JUDGE_AGENT_REDIS_URL?: string;
  JUDGE_AGENT_REDIS_TOKEN?: string;
}
export function judgeLimitsConfigured(env: JudgeAgentEnv) {
  try { return new URL(env.JUDGE_AGENT_REDIS_URL ?? "").protocol === "https:" && !!env.JUDGE_AGENT_REDIS_TOKEN?.trim(); }
  catch { return false; }
}
export const JUDGE_LIMIT_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
for i=2,4 do
  if tonumber(redis.call('GET', KEYS[i]) or '0') >= tonumber(ARGV[i-1]) then return 0 end
end
redis.call('SET', KEYS[1], '1', 'EX', ARGV[4])
for i=2,4 do
  local n=redis.call('INCR', KEYS[i])
  if n==1 then redis.call('EXPIRE', KEYS[i], ARGV[i+3]) end
end
return 1`;

export async function takeJudgeRateSlot(env: JudgeAgentEnv, sessionId: string, ip: string | undefined, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!judgeLimitsConfigured(env) || !ip || !/^[a-fA-F0-9:.]+$/.test(ip)) throw new Error("usage_guard_unavailable");
  const token = env.JUDGE_AGENT_REDIS_TOKEN;
  const url = env.JUDGE_AGENT_REDIS_URL;
  if (!token || !url) throw new Error("usage_guard_unavailable");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(token), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ip));
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  const r = JUDGE_AGENT_RATE;
  const response = await fetchImpl(url, { method: "POST", redirect: "error", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify([
    "EVAL", JUDGE_LIMIT_SCRIPT, "4", `pendia:judge:cooldown:${sessionId}`, `pendia:judge:session:${sessionId}`, `pendia:judge:ip:${hash}`, "pendia:judge:global",
    String(r.sessionHourly), String(r.ipHourly), String(r.globalDaily), String(r.cooldownSeconds), "3600", "3600", "86400",
  ]) });
  if (!response.ok) throw new Error("usage_guard_unavailable");
  const result = await response.json() as { result?: unknown; error?: unknown };
  if (result.error || (result.result !== 0 && result.result !== 1)) throw new Error("usage_guard_unavailable");
  return result.result === 1;
}