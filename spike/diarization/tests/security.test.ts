// @vitest-environment node
import "./no-network.mjs"; // in this process, any non-loopback WebSocket throws
// Repository and output hygiene for the spike: recordings, transcripts and captures must never be committed or printed.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Capture } from "../capture.ts";
import { inspectCapture, redactValues } from "../events.ts";
import { REPO, safeOutputPath } from "../output.ts";

const APPROVED_WORKFLOW = "meta-rest-spike.yml";
const git = (...a: string[]) => spawnSync("git", a, { cwd: REPO, encoding: "utf8" });
const tracked = () => git("ls-files").stdout.split("\n").filter(Boolean);

describe("nothing sensitive can be committed", () => {
  it("no audio, capture, timing or transcript file is tracked anywhere in the repository", () => {
    const bad = tracked().filter(
      (f) =>
        /\.(wav|pcm|raw|mp3|m4a|webm|ogg|flac|jsonl)$/i.test(f) ||
        /(^|\/)(capture|timings)[^/]*\.(json|txt)$/i.test(f) ||
        f.startsWith("spike-output/"),
    );
    expect(bad).toEqual([]);
  });

  it.each([
    "spike-output/capture.jsonl",
    "spike-output/two-voice.wav",
    "two-voice.wav",
    "fixtures/spike/two-voice.wav",
    "fixtures/spike/anything.pcm",
    "capture.jsonl",
    "some/dir/run.jsonl",
    "capture-abc.json",
    "timings.local.json",
    "recording.m4a",
    "clip.webm",
    ".env.local",
  ])("git ignores %s", (path) => {
    expect(git("check-ignore", "-q", path).status, `${path} must be ignored`).toBe(0);
  });

  it("the fixture script itself stays committable (only the audio is ignored)", () => {
    expect(git("check-ignore", "-q", "fixtures/spike/two-voice-script.md").status).toBe(1);
  });

  it("`.env` (tracked, Lovable-managed) holds only publishable Supabase values: no Meta key, no service role, no secret", () => {
    const names = readFileSync(join(REPO, ".env"), "utf8")
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => l.split("=")[0]!.trim());
    expect(names.every((n) => /SUPABASE_(PROJECT_ID|PUBLISHABLE_KEY|URL)$/.test(n))).toBe(true);
    expect(names.join(",")).not.toMatch(/META|SERVICE_ROLE|SECRET|PRIVATE|TWILIO/i);
  });
});

describe("merging this work cannot deploy anything or call Meta", () => {
  it("adds no Edge Function, Supabase config, migration or CI workflow", () => {
    expect(existsSync(join(REPO, "supabase/functions"))).toBe(false);
    // Phase M1 (founder-approved preparation) adds exactly ONE workflow: the manual, protected REST spike. No other workflow
    // may exist; its own properties are pinned in spike/rest/tests/workflow.test.ts.
    const workflows = existsSync(join(REPO, ".github/workflows"))
      ? readdirSync(join(REPO, ".github/workflows"))
      : [];
    expect(workflows.filter((f) => f !== APPROVED_WORKFLOW)).toEqual([]);
    const changed = git("diff", "--name-only", "origin/main...HEAD")
      .stdout.split("\n")
      .filter(Boolean);
    // (when origin/main is unavailable the list is empty; the checks above still hold)
    expect(
      changed.filter(
        (f) =>
          /^supabase\/(functions|migrations|config)/.test(f) ||
          (f.startsWith(".github/") && f !== `.github/workflows/${APPROVED_WORKFLOW}`),
      ),
    ).toEqual([]);
  });

  it("no package script runs the spike automatically (no install hook, and `test`/`build` never call the CLI)", () => {
    const scripts = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).scripts as Record<
      string,
      string
    >;
    for (const hook of [
      "preinstall",
      "install",
      "postinstall",
      "prepare",
      "prepublish",
      "prepack",
      "pretest",
      "posttest",
      "prebuild",
      "postbuild",
    ])
      expect(scripts[hook]).toBeUndefined();
    for (const name of ["test", "build", "dev", "lint"])
      expect(scripts[name] ?? "").not.toMatch(/spike/);
    expect(scripts["spike"]).toBe("node spike/diarization/cli.ts");
  });

  it("the only code that reads META_API_KEY or the approval variable is the command line; nothing reads them at import time", () => {
    const files = readdirSync(join(REPO, "spike/diarization")).filter((f) => f.endsWith(".ts"));
    const readers = files.filter((f) =>
      /process\.env/.test(readFileSync(join(REPO, "spike/diarization", f), "utf8")),
    );
    expect(readers).toEqual(["cli.ts"]);
  });

  it("no source file contains anything that looks like a real credential", () => {
    const dir = join(REPO, "spike/diarization");
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((f) =>
        statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)],
      );
    for (const f of walk(dir)) {
      const t = readFileSync(f, "utf8");
      expect(t, f).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{20,}/);
      expect(t, f).not.toMatch(/\b(sk|pk)-[A-Za-z0-9]{16,}/);
      expect(t, f).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\./);
    }
  });
});

describe("outputs go only where they cannot be committed", () => {
  it("default output is inside the git-ignored spike-output/ folder", () => {
    const p = safeOutputPath(undefined, "x.jsonl");
    expect(p).toBe(`${REPO}/spike-output/x.jsonl`);
    expect(git("check-ignore", "-q", p).status).toBe(0);
  });
  it("refuses the repo root, tracked folders, and ../ tricks; allows spike-output/ and outside the repo", () => {
    expect(() => safeOutputPath(`${REPO}/capture.jsonl`, "x")).toThrow(/Refusing/);
    expect(() => safeOutputPath(`${REPO}/src/capture.jsonl`, "x")).toThrow(/Refusing/);
    expect(() => safeOutputPath(`${REPO}/fixtures/spike/out.jsonl`, "x")).toThrow(/Refusing/);
    expect(() => safeOutputPath(`${REPO}/spike-output/../src/x.jsonl`, "x")).toThrow(/Refusing/);
    expect(() => safeOutputPath("capture.jsonl", "x")).toThrow(/Refusing/); // relative to this process's cwd (the repo)
    expect(safeOutputPath(`${REPO}/spike-output/ok.jsonl`, "x")).toBe(
      `${REPO}/spike-output/ok.jsonl`,
    );
    expect(safeOutputPath("/tmp/spike-outside/ok.jsonl", "x")).toBe("/tmp/spike-outside/ok.jsonl");
  });
});

describe("transcript text is not printed by default", () => {
  const SECRET_WORDS = "my blood pressure is twenty milligrams";
  const cap = (): Capture => ({
    meta: {
      sessionId: "s",
      url: "ws://x",
      model: "m",
      live: false,
      startedAt: "",
      handshakeSentAtMs: 1,
      framesSent: 1,
      audioSeconds: 1,
      maxPacingDriftMs: 0,
      close: { code: 1000, reason: "", meaning: "normal close", expected: true },
      endStreamSent: true,
    },
    entries: [
      {
        t: 1,
        dir: "recv",
        kind: "text",
        type: "speaker",
        raw: JSON.stringify({
          type: "speaker",
          speaker: "A",
          text: SECRET_WORDS,
          start: 1.5,
          final: true,
        }),
        json: { type: "speaker", speaker: "A", text: SECRET_WORDS, start: 1.5, final: true },
      },
    ],
  });
  it("inspect shows the structure (keys, types, speaker label, numbers) but not the words", () => {
    const out = inspectCapture(cap());
    expect(out).not.toContain("blood pressure");
    expect(out).not.toContain("twenty");
    expect(out).toMatch(/"speaker":"A"/);
    expect(out).toMatch(/<string \d+ chars>/);
    expect(out).toMatch(/text: string/);
  });
  it("the words appear only with an explicit local opt-in", () => {
    expect(inspectCapture(cap(), { showText: true })).toContain("blood pressure");
  });
  it("redactValues keeps numbers and event words, hides every other string, recursively", () => {
    expect(
      redactValues({
        type: "transcript",
        payload: { text: "secret words", speakerId: "spk_1", startMs: 5, words: ["a", "b"] },
      }),
    ).toEqual({
      type: "transcript",
      payload: {
        text: "<string 12 chars>",
        speakerId: "spk_1",
        startMs: 5,
        words: ["<string 1 chars>", "<string 1 chars>"],
      },
    });
  });
  it("the command line honours it: `inspect` prints no words unless --show-text", () => {
    const sim = spawnSync(
      "node",
      [
        "--import",
        new URL("./no-network.mjs", import.meta.url).pathname,
        new URL("../cli.ts", import.meta.url).pathname,
        "simulate",
        "--scenario",
        "perfect",
      ],
      { cwd: REPO, encoding: "utf8" },
    );
    expect(sim.status).toBe(0);
    expect(sim.stdout).not.toContain("Lisinopril, ten milligrams"); // the script's own words
    expect(sim.stdout).not.toMatch(/I want to increase/);
  });
  it("`simulate --out` to the repo root is refused", () => {
    const r = spawnSync(
      "node",
      [
        "--import",
        new URL("./no-network.mjs", import.meta.url).pathname,
        new URL("../cli.ts", import.meta.url).pathname,
        "simulate",
        "--out",
        `${REPO}/capture.jsonl`,
      ],
      { cwd: REPO, encoding: "utf8" },
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Refusing to write/);
    expect(existsSync(`${REPO}/capture.jsonl`)).toBe(false);
  });
});
