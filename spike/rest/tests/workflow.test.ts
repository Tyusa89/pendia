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
  it("uses ONLY the environment secret META_SPIKE_ENV_API_KEY and never the repository-level META_API_KEY", () => {
    expect(code.match(/secrets\./g)).toHaveLength(1);
    expect(code.match(/secrets\.META_SPIKE_ENV_API_KEY\b/g)).toHaveLength(1);
    expect(code).not.toMatch(/secrets\.META_API_KEY\b/);
    expect(code).not.toMatch(
      /secrets\.GITHUB_TOKEN|secrets\.\w*\[|toJSON\(secrets\)|secrets: inherit/,
    );
  });
  it("exposes the secret to exactly one step, as an environment variable, and never prints it", () => {
    const steps = code.split(/^\s+- name: /m).slice(1);
    const withSecret = steps.filter((s) => s.includes("secrets.META_SPIKE_ENV_API_KEY"));
    expect(withSecret).toHaveLength(1);
    expect(withSecret[0]).toMatch(/^ONE live transcription request/);
    expect(withSecret[0]).toMatch(/META_API_KEY: \$\{\{ secrets\.META_SPIKE_ENV_API_KEY \}\}/);
    // nothing prints, traces or dumps the environment
    expect(code).not.toMatch(
      /(echo|printf|cat|tee)[^\n]*\$\{?META_API_KEY|set -x|printenv|^\s*env\s*$|toJSON|--debug|ACTIONS_STEP_DEBUG/m,
    );
  });
  it("refuses when the secret is absent or empty: a guard in the live step runs BEFORE the CLI and exits non-zero", () => {
    const step = code
      .split(/^\s+- name: /m)
      .find((x) => x.startsWith("ONE live transcription request"))!;
    const guard = step.indexOf('if [ -z "${META_API_KEY}" ]; then');
    const exit1 = step.indexOf("exit 1", guard);
    const cli = step.indexOf("node spike/rest/cli.ts run");
    expect(guard).toBeGreaterThan(-1);
    expect(exit1).toBeGreaterThan(guard);
    expect(cli).toBeGreaterThan(exit1); // the refusal comes first, so no request can follow it
    expect(step).toMatch(/No request was made/);
    // the guard's only use of the variable is the emptiness test (never its value)
    expect(step.match(/\$\{?META_API_KEY/g)).toHaveLength(1);
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

describe("setup documentation", () => {
  const readme = read("spike/rest/README.md");
  it("names the environment-only secret and says the repository-level key is not used", () => {
    expect(readme).toContain("META_SPIKE_ENV_API_KEY");
    expect(readme).toMatch(/repository-level `META_API_KEY`[\s\S]{0,80}?\*\*not used\*\*/);
  });
  it("says reviewer and main-only rules must be configured and verified in GitHub before merge", () => {
    expect(readme).toMatch(/Required reviewers/);
    expect(readme).toMatch(/Selected branches/);
    expect(readme).toMatch(/verif(y|ied) (them )?(independently )?in GitHub/i);
    expect(readme).toMatch(/before (this PR is )?merg/i);
  });
  it("documents the official multipart layout: `request` is JSON with no filename, and `audio` is the WAV", () => {
    expect(readme).toMatch(/type=application\/json/);
    expect(readme).toMatch(/\*\*no filename\*\*/);
    expect(readme).toContain("rest-synthetic.wav");
    expect(readme).not.toContain("Unverified multipart detail");
  });
  it("documents the local Windows run, the Windows path handling, and that Required reviewers is unavailable", () => {
    expect(readme).toMatch(/Running the single test locally on Windows/);
    expect(readme).toContain("fileURLToPath");
    expect(readme).toMatch(/Required reviewers is unavailable/);
    expect(readme).toMatch(/Read-Host[^\n]*-AsSecureString/);
    expect(readme).not.toMatch(/setx\s+META/);
  });
});
