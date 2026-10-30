// SERVER ONLY. The hard GLOBAL usage ceiling for the guest (judge) Ask path. It counts every guest provider call together:
// there is no per-IP, per-session or header-derived key anywhere, so nothing a visitor sends can raise, split or reset it.
//   guest ceiling: <= 60 asks per hour and <= 300 per day across ALL guests (brief, Oct 29).
// Two layers, both must allow:
//   1. durable shared counters in the Redis REST store (atomic EVAL; fixed UTC hour/day buckets with TTL): the real cap, shared by
//      every worker instance;
//   2. an in-memory counter per server instance: a backstop that can only make the cap stricter.
// If the Redis store is not configured, errors, or answers anything unexpected, the cap CANNOT be verified: the call is refused
// (the caller returns the canned unavailable response). There is no in-memory-only fallback. Nothing about a question, answer,
// visitor or IP is stored: the counters are bare integers under two fixed key names.
// Reuses the Redis secret NAMES already documented in docs/judge-agent-activation.md; no other secret is read here.
export const GUEST_CAP = { hourly: 60, daily: 300 } as const;
export const GUEST_REDIS_TIMEOUT_MS = 5_000;

export interface GuestCapEnv {
  JUDGE_AGENT_REDIS_URL?: string | undefined;
  JUDGE_AGENT_REDIS_TOKEN?: string | undefined;
}
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export function guestCapConfigured(env: GuestCapEnv): boolean {
  try {
    return (
      new URL(env.JUDGE_AGENT_REDIS_URL ?? "").protocol === "https:" &&
      (env.JUDGE_AGENT_REDIS_TOKEN ?? "").trim() !== ""
    );
  } catch {
    return false;
  }
}

export const GUEST_CAP_SCRIPT = `
local h = tonumber(redis.call('GET', KEYS[1]) or '0')
local d = tonumber(redis.call('GET', KEYS[2]) or '0')
if h >= tonumber(ARGV[1]) or d >= tonumber(ARGV[2]) then return 0 end
if redis.call('INCR', KEYS[1]) == 1 then redis.call('EXPIRE', KEYS[1], ARGV[3]) end
if redis.call('INCR', KEYS[2]) == 1 then redis.call('EXPIRE', KEYS[2], ARGV[4]) end
return 1`;

// per-instance backstop
let hourStart = 0;
let hourCount = 0;
let dayStart = 0;
let dayCount = 0;
export function resetGuestCapMemory(): void {
  hourStart = hourCount = dayStart = dayCount = 0;
}
function takeLocal(clock: number): boolean {
  const h = Math.floor(clock / 3_600_000);
  const d = Math.floor(clock / 86_400_000);
  if (h !== hourStart) [hourStart, hourCount] = [h, 0];
  if (d !== dayStart) [dayStart, dayCount] = [d, 0];
  if (hourCount >= GUEST_CAP.hourly || dayCount >= GUEST_CAP.daily) return false;
  hourCount++;
  dayCount++;
  return true;
}

/** Reserves one guest ask. true = reserved; false = ceiling reached. THROWS when the shared cap cannot be verified. */
export async function takeGuestSlot(
  env: GuestCapEnv,
  clock: number,
  fetchImpl: FetchLike,
): Promise<boolean> {
  if (!guestCapConfigured(env)) throw new Error("cap_unavailable");
  const url = env.JUDGE_AGENT_REDIS_URL!;
  const token = env.JUDGE_AGENT_REDIS_TOKEN!.trim();
  if (!takeLocal(clock)) return false;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      redirect: "manual",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify([
        "EVAL",
        GUEST_CAP_SCRIPT,
        "2",
        `pendia:guest:h:${Math.floor(clock / 3_600_000)}`,
        `pendia:guest:d:${Math.floor(clock / 86_400_000)}`,
        String(GUEST_CAP.hourly),
        String(GUEST_CAP.daily),
        "7200",
        "172800",
      ]),
      signal: AbortSignal.timeout(GUEST_REDIS_TIMEOUT_MS),
    });
  } catch {
    throw new Error("cap_unavailable");
  }
  if (!res.ok) throw new Error("cap_unavailable");
  let json: { result?: unknown; error?: unknown };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    throw new Error("cap_unavailable");
  }
  if (json.error || (json.result !== 0 && json.result !== 1)) throw new Error("cap_unavailable");
  return json.result === 1;
}
