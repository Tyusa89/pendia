// @vitest-environment node
// Windows regression tests. They run on any host by feeding Windows paths and URLs through Node's win32 path rules.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyOutputPath, REPO, repoRootFrom, safeOutputPath } from "../output.ts";

const win = path.win32;
const posix = path.posix;
const WIN_MODULE = "file:///C:/Users/dre/pendia/spike/diarization/output.ts";
const WIN_REPO = "C:\\Users\\dre\\pendia";

describe("repository root from a module URL", () => {
  it("is a Windows drive path, not /C:/... (the pre-fix bug produced C:\\C:\\Users\\...)", () => {
    expect(repoRootFrom(WIN_MODULE, win, true)).toBe(WIN_REPO);
    // what the old `new URL(...).pathname` code did, so the regression is documented and pinned
    const old = win.resolve(new URL("../..", WIN_MODULE).pathname);
    expect(old).toMatch(/\\[A-Z]:\\/i); // a drive letter after a root: not a valid Windows path
    expect(old).not.toBe(WIN_REPO);
    expect(repoRootFrom(WIN_MODULE, win, true)).not.toMatch(/:.*:/);
  });
  it("handles spaces and percent-encoding in the folder names", () => {
    expect(
      repoRootFrom("file:///C:/Users/Dre%20Tyus/My%20Projects/pendia/spike/rest/cli.ts", win, true),
    ).toBe("C:\\Users\\Dre Tyus\\My Projects\\pendia");
  });
  it("handles another drive letter and a network share", () => {
    expect(repoRootFrom("file:///D:/work/pendia/spike/diarization/output.ts", win, true)).toBe(
      "D:\\work\\pendia",
    );
    expect(repoRootFrom("file://server/share/pendia/spike/diarization/output.ts", win, true)).toBe(
      "\\\\server\\share\\pendia",
    );
  });
  it("still gives the POSIX root on POSIX, and the real REPO is an absolute path to this checkout", () => {
    expect(repoRootFrom("file:///home/dre/pendia/spike/diarization/output.ts", posix, false)).toBe(
      "/home/dre/pendia",
    );
    expect(path.isAbsolute(REPO)).toBe(true);
    expect(REPO).toBe(path.resolve(fileURLToPath(new URL("../../..", import.meta.url))));
  });
});

describe("output-path rule with Windows paths", () => {
  const c = (p: string) => classifyOutputPath(p, WIN_REPO, win);
  it("allows spike-output inside the repo, with backslashes or slashes, in any letter case", () => {
    expect(c(`${WIN_REPO}\\spike-output\\rest-call.lock`)).toBe("output");
    expect(c(`${WIN_REPO}\\spike-output\\sub\\a.json`)).toBe("output");
    expect(c("C:/Users/dre/pendia/spike-output/rest-scorecard.json")).toBe("output");
    expect(c("c:\\users\\DRE\\Pendia\\SPIKE-OUTPUT\\x.json")).toBe("forbidden"); // folder name case differs from the ignored folder
    expect(c("c:\\USERS\\dre\\PENDIA\\spike-output\\x.json")).toBe("output"); // drive/parent case is irrelevant on Windows
  });
  it("refuses everything else inside the repo, including the root and spike-output itself", () => {
    for (const p of [
      WIN_REPO,
      `${WIN_REPO}\\spike-output`,
      `${WIN_REPO}\\src\\App.tsx`,
      `${WIN_REPO}\\package.json`,
      `${WIN_REPO}\\fixtures\\spike\\two-voice-script.md`,
      `${WIN_REPO}\\spike-output\\..\\src\\x.ts`, // traversal out of the output folder
      `${WIN_REPO}\\spike-output\\..\\..\\pendia\\package.json`,
    ])
      expect(c(p), p).toBe("forbidden");
  });
  it("allows places outside the repo, including look-alike prefixes and other drives", () => {
    for (const p of [
      "C:\\pendia-spike\\audio\\rest-synthetic.wav",
      "C:\\Users\\dre\\pendia-other\\x.json", // prefix trap: shares the characters but not the folder
      "C:\\Users\\dre\\pendia2\\spike-output\\x",
      "D:\\elsewhere\\x.json",
      "\\\\server\\share\\x.json",
    ])
      expect(c(p), p).toBe("outside");
  });
});

describe("output-path rule with POSIX paths is unchanged", () => {
  const c = (p: string) => classifyOutputPath(p, "/work/pendia", posix);
  it("behaves as before", () => {
    expect(c("/work/pendia/spike-output/a.json")).toBe("output");
    expect(c("/work/pendia/spike-output")).toBe("forbidden");
    expect(c("/work/pendia/src/x.ts")).toBe("forbidden");
    expect(c("/work/pendia")).toBe("forbidden");
    expect(c("/work/pendia/spike-output/../src/x.ts")).toBe("forbidden");
    expect(c("/work/pendia-other/x")).toBe("outside");
    expect(c("/tmp/x")).toBe("outside");
  });
  it("safeOutputPath still refuses a tracked in-repo file and accepts the default output path", () => {
    expect(() => safeOutputPath(path.join(REPO, "package.json"), "x")).toThrow(/Refusing/);
    expect(safeOutputPath(undefined, "win-regression.tmp")).toBe(
      path.join(REPO, "spike-output", "win-regression.tmp"),
    );
  });
});

describe("no module derives a filesystem path from a URL's .pathname", () => {
  it.each([
    "diarization/output.ts",
    "diarization/cli.ts",
    "rest/cli.ts",
    "rest/synth.ts",
    "rest/run.ts",
  ])("%s", (f) => {
    const src = readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
    // the endpoint URL's own .pathname (https://...) in run.ts is a URL path, not a file path
    const bad = src
      .split("\n")
      .filter((l) => /import\.meta\.url[^\n]*\.pathname|\)\.pathname\)/.test(l));
    expect(bad).toEqual([]);
  });
});
