// @vitest-environment node
// The live call can only happen through the protected workflow or an explicit command. These tests pin that down.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APPROVAL_TOKEN } from "../config.ts";
import { FAKE_KEY, wavBytes } from "./helpers.ts";

const root = new URL("../../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(root, p), "utf8");
const wf = read(".github/workflows/meta-rest-spike.yml");
const code = wf.replace(/^\s*#.*$/gm, ""); // ignore comments

describe("protected manual workflow", () => {
  it("is workflow_dispatch only: no push, pull request, schedule, merge or other trigger", () => {
    const on = code.split(/^permissions:/m)[0]!;
    expect(on).toMatch(/^on:\n {2}workflow_dispatch:/m);
    for (const t of [
      "push",
      "pull_request",
      "pull_request_target",
      "schedule",
      "workflow_run",
      "repository_dispatch",
      "release",
      "merge_group",
      "issues",
      "issue_comment",
    ])
      expect(on).not.toMatch(new RegExp(`^\\s*${t}:`, "m"));
  });
  it("needs the protected environment, a typed approval phrase and main, with a timeout and concurrency guard", () => {
    expect(code).toMatch(/^\s+environment: meta-spike$/m);
    expect(code).toMatch(/^\s+timeout-minutes: 10$/m);
    expect(code).toMatch(
      /^concurrency:\n {2}group: meta-rest-spike\n {2}cancel-in-progress: false/m,
    );
    expect(code).toMatch(
      /if: github\.ref == 'refs\/heads\/main' && inputs\.approval == 'I_HAVE_APPROVAL'/,
    );
    expect(APPROVAL_TOKEN).toBe("I_HAVE_APPROVAL");
  });
  it("has read-only permissions and never asks for write access", () => {
    expect(code).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(code).not.toMatch(/:\s*write\b/);
    expect(code).not.toMatch(/id-token|pull-requests|actions:|packages|deployments/);
  });
  it("exposes META_API_KEY to exactly one step, as an environment variable, and never prints it", () => {
    expect(code.match(/secrets\./g)).toHaveLength(1);
    expect(code.match(/secrets\.META_API_KEY/g)).toHaveLength(1);
    const steps = code.split(/^\s+- name: /m).slice(1);
    const withSecret = steps.filter((s) => s.includes("secrets.META_API_KEY"));
    expect(withSecret).toHaveLength(1);
    expect(withSecret[0]).toMatch(/^ONE live transcription request/);
    expect(withSecret[0]).toMatch(/META_API_KEY: \$\{\{ secrets\.META_API_KEY \}\}/);
    expect(code).not.toMatch(
      /echo[^\n]*META_API_KEY|set -x|printenv|\benv\b\s*$|\$META_API_KEY|\$\{META_API_KEY/m,
    );
  });
  it("makes the one live call once, with the confirm flag, and uploads no artifacts", () => {
    expect(code.match(/spike\/rest\/cli\.ts run/g)).toHaveLength(1);
    expect(code).toMatch(/--live --confirm-one-call/);
    expect(code).not.toMatch(/upload-artifact|actions\/cache|download-artifact|release/);
    expect(code).not.toMatch(/\bcurl\b|\bwget\b/);
  });
  it("pins every action to a full commit SHA, drops checkout credentials and installs no dependencies", () => {
    const uses = [...code.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]!);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    expect(code).toMatch(/persist-credentials: false/);
    expect(code).not.toMatch(/npm (ci|install)|bun (install|i)\b|pnpm|yarn/);
  });
  it("is the only workflow, so nothing else can reach the runner", () => {
    for (const f of readdirSync(join(root, ".github/workflows")))
      if (f !== "meta-rest-spike.yml")
        expect(read(`.github/workflows/${f}`)).not.toMatch(/spike\/rest|META_API_KEY/);
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
  it("the application source never reads META_API_KEY", () => {
    const bad: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (
          /\.(ts|tsx)$/.test(e.name) &&
          !/\/test\//.test(p) &&
          /META_API_KEY/.test(readFileSync(p, "utf8"))
        )
          bad.push(p);
      }
    };
    walk(join(root, "src"));
    expect(bad).toEqual([]);
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
  it("`plan` and `check` work offline and print no credential", () => {
    const p = cli(["plan", "--wav", wavPath], { META_API_KEY: FAKE_KEY });
    expect(p.status).toBe(0);
    expect(p.stdout).toContain("Bearer ***");
    expect(p.stdout + p.stderr).not.toContain(FAKE_KEY);
    expect(cli(["check", "--wav", wavPath], {}).status).toBe(0);
  });
  it("cleans up", () => rmSync(dir, { recursive: true, force: true }));
});
