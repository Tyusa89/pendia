// @vitest-environment node
// The live call can only happen through an explicit command typed on the operator's own machine. There is NO GitHub
// Actions workflow for it. These tests pin that down.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APPROVAL_TOKEN } from "../config.ts";
import { FAKE_KEY, wavBytes } from "./helpers.ts";

const root = new URL("../../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("no GitHub Actions workflow can run the live call", () => {
  const dir = join(root, ".github/workflows");
  const files = existsSync(dir) ? readdirSync(dir) : [];
  it("the live-capable workflow file is gone", () => {
    expect(existsSync(join(dir, "meta-rest-spike.yml"))).toBe(false);
  });
  it("no workflow file exists that mentions the spike, the key, or the environment", () => {
    for (const f of files)
      expect(read(`.github/workflows/${f}`), f).not.toMatch(
        /spike\/rest|spike:rest|META_API_KEY|META_SPIKE|meta-spike|asr\/transcribe/,
      );
  });
  it("the repository defines no workflow_dispatch workflow at all", () => {
    for (const f of files)
      expect(read(`.github/workflows/${f}`), f).not.toMatch(/workflow_dispatch/);
  });
});

describe("no accidental invocation", () => {
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  it("no normal script (dev, build, lint, test, preview, format) runs the REST spike", () => {
    for (const k of [
      "dev",
      "build",
      "build:dev",
      "preview",
      "lint",
      "format",
      "test",
      "test:watch",
      "spike:test",
    ])
      expect(pkg.scripts[k]).not.toMatch(/spike\/rest|spike:rest/);
    expect(pkg.scripts["spike:rest"]).toBe("node spike/rest/cli.ts");
  });
  it("no test or application source spawns the REST CLI with --live or imports the runner", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
          if (!["node_modules", ".git", "dist", ".output"].includes(e.name)) walk(p);
        } else if (
          /\.(ts|tsx|mjs|js|json|yml)$/.test(e.name) &&
          !p.endsWith("workflow.test.ts") &&
          !p.includes("/spike/rest/")
        ) {
          if (/spike\/rest|spike:rest/.test(readFileSync(p, "utf8")))
            hits.push(p.replace(root, ""));
        }
      }
    };
    walk(join(root, "src"));
    walk(join(root, "supabase"));
    expect(hits.filter((h) => !h.startsWith("package.json"))).toEqual([]);
  });
  it("the application source reads META_API_KEY only in the one gated, server-only Spark module", () => {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (
          /\.(ts|tsx)$/.test(e.name) &&
          !/\/test\//.test(p) &&
          /META_API_KEY/.test(readFileSync(p, "utf8"))
        )
          found.push(p.replace(root, ""));
      }
    };
    walk(join(root, "src"));
    // src/server/*.server.ts cannot be imported by client code (the build denies it); the Spark live provider is gated
    // behind SPARK_LIVE_ENABLED and an allow-list. Nothing else in src may mention the key.
    // meta-transcribe.server.ts is the Handoff voice-transcription module: server-only, behind META_TRANSCRIBE_ENABLED, organizer-only.
    // care-agent.server.ts is the Care Agent server module: server-only, behind AGENT_LIVE_ENABLED and an allow-list.
    // doc-extract.server.ts is the Document Upload extraction module: server-only, behind DOC_EXTRACT_ENABLED, an allow-list and demo families.
    // guest-agent.server.ts is the guest (judge) Ask module: server-only, behind JUDGE_AGENT_LIVE_ENABLED and a hard global cap.
    expect(found).toEqual([
      "src/server/care-agent.server.ts",
      "src/server/doc-extract.server.ts",
      "src/server/guest-agent.server.ts",
      "src/server/meta-transcribe.server.ts",
      "src/server/spark-synthetic.server.ts",
    ]);
  });
});

describe("the command line is disabled by default", () => {
  const dir = mkdtempSync(join(tmpdir(), "rest-cli-"));
  const wavPath = join(dir, "t.wav");
  writeFileSync(wavPath, wavBytes({ seconds: 3 }));
  const preload = new URL("./no-network.mjs", import.meta.url).href;
  const cli = (args: string[], env: Record<string, string>) =>
    spawnSync(process.execPath, ["--import", preload, join(root, "spike/rest/cli.ts"), ...args], {
      env: { PATH: process.env["PATH"] ?? "", ...env },
      encoding: "utf8",
      cwd: root,
    });

  it("`run` without --live does nothing and exits 2", () => {
    const r = cli(["run", "--wav", wavPath], {
      META_API_KEY: FAKE_KEY,
      SPIKE_ALLOW_LIVE: APPROVAL_TOKEN,
    });
    expect(r.status).toBe(2);
    expect(r.stdout).toMatch(/Disabled/);
    expect(r.stdout + r.stderr).not.toContain(FAKE_KEY);
  });
  it("`--live` without SPIKE_ALLOW_LIVE is refused before any request, with the key never printed", () => {
    const lock = join(root, "spike-output/rest-call.lock");
    const before = existsSync(lock);
    const r = cli(["run", "--wav", wavPath, "--live", "--confirm-one-call"], {
      META_API_KEY: FAKE_KEY,
    });
    expect(r.status).toBe(1); // a refused run is a failed run: its scorecard says not_scorable
    expect(r.stderr).toMatch(/live_not_approved/);
    expect(r.stdout + r.stderr).not.toContain(FAKE_KEY);
    expect(existsSync(lock)).toBe(before); // the single call was never claimed
  });
  it.each([
    ["an empty key (what GitHub supplies for a missing secret)", { META_API_KEY: "" }],
    ["an unset key", {}],
    ["a blank key", { META_API_KEY: "   " }],
  ])(
    "refuses a live run with %s, before any request, and does not claim the single call",
    (_n, keyEnv) => {
      const lock = join(root, "spike-output/rest-call.lock");
      const before = existsSync(lock);
      const r = cli(["run", "--wav", wavPath, "--live", "--confirm-one-call"], {
        SPIKE_ALLOW_LIVE: APPROVAL_TOKEN,
        ...keyEnv,
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/missing_key/);
      expect(r.stderr).not.toMatch(/network blocked/); // it never even tried to reach the network
      expect(existsSync(lock)).toBe(before);
    },
  );
  it("`plan` and `check` work offline and print no credential", () => {
    const p = cli(["plan", "--wav", wavPath], { META_API_KEY: FAKE_KEY });
    expect(p.status).toBe(0);
    expect(p.stdout).toContain("Bearer ***");
    expect(p.stdout + p.stderr).not.toContain(FAKE_KEY);
    expect(cli(["check", "--wav", wavPath], {}).status).toBe(0);
  });
  it("cleans up", () => rmSync(dir, { recursive: true, force: true }));
});

describe("documentation", () => {
  const readme = read("spike/rest/README.md");
  it("says there is no GitHub Actions path and the run is local", () => {
    expect(readme).toMatch(/There is no GitHub Actions workflow/);
    expect(readme).toMatch(/Running the single test locally on Windows/);
    expect(readme).not.toMatch(/Run workflow|Environment secrets|environment `meta-spike`/);
  });
  it("documents the official multipart layout: `request` is JSON with no filename, and `audio` is the WAV", () => {
    expect(readme).toMatch(/type=application\/json/);
    expect(readme).toMatch(/\*\*no filename\*\*/);
    expect(readme).toContain("rest-synthetic.wav");
  });
  it("documents the Windows path handling and secure key entry", () => {
    expect(readme).toContain("fileURLToPath");
    expect(readme).toMatch(/Read-Host[^\n]*-AsSecureString/);
    expect(readme).not.toMatch(/setx\s+META/);
  });
  it("documents the raw response files: what is saved, what never is, and that truncation is recorded", () => {
    expect(readme).toContain("rest-raw-response.body");
    expect(readme).toContain("rest-raw-response.meta.json");
    expect(readme).toMatch(/before (anything|the reply is)[^\n]*(checks|parsed|parses)/i);
    expect(readme).toMatch(/truncated/);
    expect(readme).toMatch(/never (stored|saved|written)/i);
  });
});
