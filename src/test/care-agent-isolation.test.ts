// @vitest-environment node
// Structural guards for the Care Agent: where its secrets, network call and database reads may live, and what it must never touch.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { features } from "@/lib/features";

const root = process.cwd();
const read = (f: string) => readFileSync(join(root, f), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const rel = (p: string) => p.replace(`${root}/`, "");
const appFiles = walk(join(root, "src")).filter(
  (f) => /\.(ts|tsx)$/.test(f) && !/\/test\//.test(f),
);
const libFiles = walk(join(root, "src/lib/care-agent")).filter((f) => /\.(ts|tsx)$/.test(f));
const PURE = ["contract", "copy", "prefilter", "pack", "validate", "prompt"].map(
  (n) => `src/lib/care-agent/${n}.ts`,
);
const SERVER = ["src/server/care-agent.server.ts", "src/server/care-agent-source.server.ts"];

describe("secrets and configuration names exist only in the Care Agent server module", () => {
  it("AGENT_LIVE_ENABLED / AGENT_LIVE_USER_IDS appear only in the server module", () => {
    const hits = appFiles
      .filter((f) => /\bAGENT_LIVE_(ENABLED|USER_IDS)\b/.test(strip(readFileSync(f, "utf8"))))
      .map(rel)
      .sort();
    expect(hits).toEqual(["src/server/care-agent.server.ts"]);
  });
  it("the wrapper only hands the environment to the gated handler; the handler reads three named variables", () => {
    const w = strip(read("src/lib/care-agent/care-agent.functions.ts"));
    expect(w.match(/process\.env/g)).toHaveLength(3);
    const s = strip(read("src/server/care-agent.server.ts"));
    expect(s).not.toMatch(/process\.env/);
    expect(s).toMatch(/env\.AGENT_LIVE_ENABLED/);
    expect(s).toMatch(/env\.AGENT_LIVE_USER_IDS/);
    expect(s).toMatch(/env\.META_API_KEY/);
  });
  it("META_API_KEY is used only as the Bearer value; never in a body, URL, error or log", () => {
    const s = strip(read("src/server/care-agent.server.ts"));
    const uses = s.match(/.*apiKey.*/g) ?? [];
    expect(s).not.toMatch(/console\./);
    expect(s.match(/Authorization/g)).toHaveLength(1);
    expect(uses.join("\n")).not.toMatch(/JSON\.stringify|new Error|detail/);
  });
  it("the key never reaches the client bundle: no client file imports a server module", () => {
    const clients = appFiles.filter((f) => !/\/server\//.test(f));
    for (const f of clients) {
      const code = strip(readFileSync(f, "utf8"));
      expect(code, rel(f)).not.toMatch(/from "@\/server\/care-agent/);
      if (/care-agent/.test(rel(f)) || /CareAgent/.test(rel(f)))
        expect(code, rel(f)).not.toMatch(/META_API_KEY/);
    }
  });
});

describe("the wrapper", () => {
  const w = strip(read("src/lib/care-agent/care-agent.functions.ts"));
  it("requires a signed-in user on both functions", () => {
    expect(w.match(/createServerFn\(/g)).toHaveLength(2);
    expect(w.match(/\.middleware\(\[requireSupabaseAuth\]\)/g)).toHaveLength(2);
  });
  it("imports the server modules dynamically inside handlers only", () => {
    expect(w).not.toMatch(/^import .* from "@\/server\//m);
    expect(w.match(/await import\("@\/server\/care-agent\.server"\)/g)).toHaveLength(2);
    expect(w.match(/await import\("@\/server\/care-agent-source\.server"\)/g)).toHaveLength(2);
  });
  it("uses the caller's session client and never the service role", () => {
    expect(w).toMatch(/context\.supabase/);
    expect(w).not.toMatch(/service_role|supabaseAdmin|SERVICE_ROLE/i);
    expect(w).not.toMatch(/console\./);
  });
});

describe("the network call", () => {
  const s = strip(read("src/server/care-agent.server.ts"));
  it("there is exactly one fetch call site, one POST, redirects refused, a timeout, and no retry loop", () => {
    expect(s.match(/\bfetchImpl\(|\bfetch\(/g)).toHaveLength(1);
    expect(s.match(/method: "POST"/g)).toHaveLength(1);
    expect(s).toMatch(/redirect: "manual"/);
    expect(s).toMatch(/AbortSignal\.timeout/);
    expect(s).not.toMatch(/\bretry\b|attempts|for \(let \w+ = 0; \w+ < [23]/i);
  });
  it("reuses only wire primitives from the Spark module; no Spark extraction/caller is referenced", () => {
    expect(s).not.toMatch(
      /buildChatCompletionsBody|callSparkOnce|callSparkChat|runLiveSpark|spark-live\.server/,
    );
  });
  it("sets no tools, functions or streaming, and no web/search fields", () => {
    expect(s).not.toMatch(/\btools\b|tool_choice|functions:|stream:|web_search|browse/i);
  });
});

describe("read-only and stateless", () => {
  it("no write to the database or storage anywhere in the Care Agent code", () => {
    for (const f of [...SERVER, ...libFiles.map(rel)]) {
      const code = strip(read(f));
      expect(code, f).not.toMatch(
        /\.(insert|update|upsert|delete)\(|\.storage\b|\.functions\.invoke|\.channel\(/,
      );
      expect(code, f).not.toMatch(/service_role|supabaseAdmin|SERVICE_ROLE/i);
    }
  });
  it("no console, storage, cookie or global-state API in server or pure code", () => {
    for (const f of [...SERVER, ...PURE]) {
      const code = strip(read(f));
      expect(code, f).not.toMatch(
        /console\.|localStorage|sessionStorage|indexedDB|document\.|window\.|navigator|cookie/,
      );
    }
  });
  it("the pure modules have no network, environment or server access", () => {
    for (const f of PURE) {
      const code = strip(read(f));
      expect(code, f).not.toMatch(
        /\bfetch\b|XMLHttpRequest|WebSocket|process\.env|import\.meta\.env|@\/server\/|supabase/,
      );
    }
  });
  it("the only module-level mutable state is the in-memory rate limiter", () => {
    const s = strip(read("src/server/care-agent.server.ts"));
    const lets = s.match(/^(let|var) .*$/gm) ?? [];
    expect(lets).toEqual(["let instanceCalls: number[] = [];"]);
    expect(s.match(/^const \w+ = new Map/gm) ?? []).toHaveLength(1);
  });
  it("the source module never selects '*' and never takes a client other than the one handed in", () => {
    const s = strip(read("src/server/care-agent-source.server.ts"));
    expect(s).not.toMatch(/select\(["'`]\*|createClient|client\.server|supabaseAdmin/);
  });
});

describe("what the agent does not touch", () => {
  it("does not import the protected Spark extraction, verifier, dose or transcription modules", () => {
    for (const f of [...SERVER, ...libFiles.map(rel)]) {
      const code = strip(read(f));
      expect(code, f).not.toMatch(
        /visit-pipeline\/(?!spark-contract)|meta-transcribe|dose-verifier|verifier|extraction|contributor/i,
      );
    }
  });
  it("the Care Agent is switched off by default and the sidebar feature flag is untouched", () => {
    expect(features.assistant).toBe(false);
  });
  it("Demo Mode, public routes and the visit pipeline cannot reach it", () => {
    const demo = appFiles.filter((f) =>
      /components\/visit-demo\/|lib\/visit-demo\/|routes\/demo\.tsx|routes\/_authenticated\/visits\.demo\.tsx|lib\/visit-pipeline\//.test(
        f,
      ),
    );
    expect(demo.length).toBeGreaterThan(8);
    for (const f of demo)
      expect(strip(readFileSync(f, "utf8")), rel(f)).not.toMatch(/care-agent|CareAgent/);
  });
  it("no production file outside the Care Agent, its route and the page imports the Care Agent modules", () => {
    const importers = appFiles
      .filter((f) => !/care-agent|CareAgent/.test(rel(f)))
      .filter((f) => /care-agent|CareAgent/.test(strip(readFileSync(f, "utf8"))))
      .map(rel)
      .sort();
    expect(importers).toEqual(
      ["src/routes/_authenticated/ask.tsx", "src/server/judge-agent-source.server.ts"],
    );
  });
});
