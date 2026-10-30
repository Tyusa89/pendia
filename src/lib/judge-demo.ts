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
export function assertDemoWritable() {
  if (isJudgeDemo()) throw new Error("This fictional demo is read-only. Shared records have not been changed.");
}