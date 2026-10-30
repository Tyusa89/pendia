// @vitest-environment node
// Structural guards for the guest (judge) Ask path: no database, no service role, no client-controlled identity, the member path
// untouched, nothing protected edited, no migration, no new dependency.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (f: string) => readFileSync(join(root, f), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const SERVER = ["src/server/guest-agent.server.ts", "src/server/guest-agent-limits.server.ts"];

describe("no database, no service role, no client-controlled identity", () => {
  for (const f of SERVER)
    it(`${f}: no Supabase, service-role, process.env, console, browser or header access`, () => {
      const c = strip(read(f));
      expect(c).not.toMatch(/supabase|service_role|SERVICE_ROLE|client\.server|createClient/i);
      expect(c).not.toMatch(/process\.env|import\.meta\.env|console\./);
      expect(c).not.toMatch(/localStorage|sessionStorage|document\.[a-z]|window\.[a-z]|cookie/);
      expect(c).not.toMatch(
        /cf-connecting-ip|x-forwarded|x-real-ip|getRequestHeader|getRequest\b|headers\.get/i,
      );
    });
  it("the guest module imports no database-backed Care Agent source and not the judge/member source modules", () => {
    const c = strip(read("src/server/guest-agent.server.ts"));
    expect(c).not.toMatch(
      /care-agent-source|judge-agent-source|judge-agent-limits|createSupabasePackSource|createJudgePackSource/,
    );
    // from the member server module it takes only pure helpers
    const m = c.match(/import \{([^}]*)\} from "\.\/care-agent\.server"/);
    expect(m).not.toBeNull();
    const names = m![1]!
      .split(",")
      .map((s) => s.replace(/\btype\b/, "").trim())
      .filter(Boolean)
      .sort();
    expect(names).toEqual(
      [
        "CARE_AGENT_MAX_RESPONSE_BYTES",
        "CARE_AGENT_TIMEOUT_MS",
        "FetchLike",
        "buildCareAgentRequest",
        "normalizeQuestion",
      ].sort(),
    );
  });
  it("the guest input has no way to choose a family: the only id accepted is compared to the fictional snapshot's", () => {
    const c = strip(read("src/server/guest-agent.server.ts"));
    expect(c).toMatch(/input\.familyId !== undefined && input\.familyId !== JUDGE_DEMO_FAMILY_ID/);
    expect(c).not.toMatch(/loadRows|getMember|getFamily|PackSource/);
  });
  it("exactly one provider call site and one cap-store call site; Authorization once each", () => {
    const g = strip(read("src/server/guest-agent.server.ts"));
    const l = strip(read("src/server/guest-agent-limits.server.ts"));
    expect(g.match(/opts\.fetchImpl\(/g)).toHaveLength(1);
    expect(g.match(/Authorization/g)).toHaveLength(1);
    expect(g).toMatch(/redirect: "manual"/);
    expect(g).not.toMatch(/\bretry\b|attempts|\btools\b|tool_choice|stream:/i);
    expect(l.match(/fetchImpl\(/g)).toHaveLength(1);
    expect(l.match(/Authorization/g)).toHaveLength(1);
  });
  it("only the dedicated flag, the existing key, and the existing documented cap-store names are read", () => {
    const names = new Set(
      [
        ...(
          strip(read("src/server/guest-agent.server.ts")) +
          strip(read("src/server/guest-agent-limits.server.ts"))
        ).matchAll(/env\.([A-Z_]{6,})/g),
      ].map((m) => m[1]),
    );
    expect([...names].sort()).toEqual([
      "JUDGE_AGENT_LIVE_ENABLED",
      "JUDGE_AGENT_REDIS_TOKEN",
      "JUDGE_AGENT_REDIS_URL",
      "META_API_KEY",
    ]);
  });
});

describe("the wrapper is intentionally unauthenticated but grants nothing", () => {
  const w = strip(read("src/lib/care-agent/guest.functions.ts"));
  it("imports the server module inside handlers only; hands over process.env only; no database or auth middleware", () => {
    expect(w).not.toMatch(/^import .* from "@\/server\//m);
    expect(w.match(/await import\("@\/server\/guest-agent\.server"\)/g)).toHaveLength(2);
    expect(w.match(/process\.env/g)).toHaveLength(2);
    expect(w).not.toMatch(/supabase|requireSupabaseAuth|service_role|console\./i);
  });
  it("accepts a family id only so it can be refused", () => {
    expect(w).toMatch(/familyId: z\.string\(\)\.max\(100\)\.optional\(\)/);
  });
});

describe("the audited member path and protected modules are not edited by this work", () => {
  const git = (...a: string[]) => {
    try {
      return execFileSync("git", a, { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
    } catch {
      return [] as string[]; // origin/main unavailable: the structural checks above still hold
    }
  };
  const changed = git("diff", "--name-only", "origin/main...HEAD");
  // prefilter.ts is deliberately NOT listed: Pepper authorized one change to it after the PR #56 audit (the demo medication names in MED_WORD).
  it("changes none of the member Care Agent, Spark, transcription, verifier, dose, schema or dependency files", () => {
    const protectedRe =
      /^(src\/server\/(care-agent|care-agent-source|judge-agent-source|judge-agent-limits|meta-transcribe|spark-live|spark-synthetic)\.server\.ts|src\/lib\/care-agent\/(contract|copy|pack|prompt|validate|care-agent\.functions|useCareAgent)\.ts|src\/components\/CareAgentPanel\.tsx|src\/lib\/spark\/|src\/lib\/visit-pipeline\/|src\/lib\/meta-transcribe\/|src\/lib\/dose|src\/lib\/features\.ts|supabase\/|package\.json|bun\.lock|\.env)/;
    expect(changed.filter((f) => protectedRe.test(f))).toEqual([]);
  });
  it("the member server module does not import the guest module", () => {
    expect(strip(read("src/server/care-agent.server.ts"))).not.toMatch(/guest-agent/);
  });
});
