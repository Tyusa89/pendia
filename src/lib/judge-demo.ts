// Presentation-only guest marker. It never grants database or AI authorization.
export const JUDGE_DEMO_FAMILY_ID = "7bba35bf-8dd1-477b-bc1c-d77dd5e751f7";
export const JUDGE_DEMO_USER_ID = "cd7b5f56-40b6-4416-9951-af5a3cf651d4";
const KEY = "pendia.judgeDemo";
export function isJudgeDemo(): boolean {
  try { return typeof window !== "undefined" && window.sessionStorage.getItem(KEY) === "true"; }
  catch { return false; }
}
export function setJudgeDemo(active: boolean) {
  if (active) window.sessionStorage.setItem(KEY, "true");
  else window.sessionStorage.removeItem(KEY);
}
export const JUDGE_DEMO_READ_ONLY_MESSAGE = "This fictional demo is read-only. Shared records have not been changed.";
export function assertDemoWritable() {
  if (isJudgeDemo()) throw new Error(JUDGE_DEMO_READ_ONLY_MESSAGE);
}
/**
 * The guest marker must never outlive the guest session. If it is set but the signed-in user is anyone other than the dedicated judge
 * identity (a sign-up, a confirmation link, another sign-in path, an expired guest token), it is stale: clear it so the real account
 * gets its own data and write actions. Returns true if it cleared the marker.
 */
export function reconcileJudgeDemo(userId: string | null | undefined): boolean {
  if (!isJudgeDemo() || userId === JUDGE_DEMO_USER_ID) return false;
  setJudgeDemo(false);
  return true;
}