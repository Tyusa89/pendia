// @vitest-environment node
// The live provider must stay behind its gates and out of reach of Demo Mode and the client bundle.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PIPELINE_MODE, getVisitPipeline } from "@/lib/visit-pipeline";

const root = join(__dirname, "../..");
const rel = (f: string) => f.replace(`${root}/`, "");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
const appFiles = walk(join(root, "src")).filter((f) => !/\/test\//.test(f));

describe("the server functions are authenticated, gated and take no content", () => {
  const src = strip(read("src/lib/spark/spark-live.functions.ts"));
  it("both require a signed-in user", () => {
    expect(src.match(/createServerFn\(/g)).toHaveLength(2);
    expect(src.match(/\.middleware\(\[requireSupabaseAuth\]\)/g)).toHaveLength(2);
  });
  it("the run function validates its input with the fixed-fixture schema and passes nothing else on", () => {
    expect(src).toMatch(/method: "POST"/);
    expect(src).toMatch(/\.validator\(\(data: unknown\) => sparkInputSchema\.parse\(data\)\)/);
    expect(src).not.toMatch(/\bdata\.|\{ data \}|\(\{[^)]*data[^)]*\}\)/);
    expect(src).not.toMatch(/transcript|speakerMap|messages|prompt/i);
  });
  it("the server modules are imported inside the handlers only, never statically", () => {
    expect(src).not.toMatch(/^import .* from "@\/server\//m);
    expect(src.match(/await import\("@\/server\/spark-synthetic\.server"\)/g)).toHaveLength(2);
  });
  it("environment is read only to hand to the gated handler; nothing is logged", () => {
    expect(src.match(/process\.env/g)).toHaveLength(2);
    expect(src).not.toMatch(/console\./);
  });
});

describe("secrets and the live client exist only on the server", () => {
  const SECRET = /META_API_KEY|SPARK_LIVE_ENABLED|SPARK_LIVE_USER_IDS/;
  it("those names appear only in the two server modules and the function wrapper", () => {
    const offenders = appFiles
      .filter((f) => SECRET.test(strip(readFileSync(f, "utf8"))))
      .map(rel)
      .sort();
    // meta-transcribe.server.ts is the Handoff voice-transcription server module (see meta-transcribe-isolation.test.ts).
    expect(offenders).toEqual([
      "src/server/meta-transcribe.server.ts",
      "src/server/spark-synthetic.server.ts",
    ]);
  });
  it("the Meta host is written once, in the pure builder module, and only the server client uses the URL constant", () => {
    const withUrl = appFiles
      .filter((f) => /api\.meta\.ai/.test(strip(readFileSync(f, "utf8"))))
      .map(rel)
      .sort();
    // lib/meta-transcribe/contract.ts holds the separate speech-to-text endpoint (a different path from Spark's).
    expect(withUrl).toEqual(["src/lib/meta-transcribe/contract.ts", "src/lib/spark/spark-http.ts"]);
    const users = appFiles
      .filter((f) => /SPARK_CHAT_URL/.test(strip(readFileSync(f, "utf8"))))
      .map(rel)
      .sort();
    expect(users).toEqual(["src/lib/spark/spark-http.ts", "src/server/spark-live.server.ts"]);
  });
  it("server modules read no browser or storage API and import no UI, service or hook", () => {
    for (const f of ["src/server/spark-live.server.ts", "src/server/spark-synthetic.server.ts"]) {
      const code = strip(read(f));
      expect(code, f).not.toMatch(
        /localStorage|sessionStorage|document\.|window\.|from "react|@\/components|@\/services|@\/hooks|supabase/,
      );
      expect(code, f).not.toMatch(/console\./);
    }
  });
  it("the pure modules have no network, environment or storage access", () => {
    for (const f of ["src/lib/spark/spark-http.ts", "src/lib/spark/spark-live-input.ts"]) {
      expect(strip(read(f)), f).not.toMatch(
        /\bfetch\b|process\.env|import\.meta\.env|localStorage|XMLHttpRequest|WebSocket/,
      );
    }
  });
});

describe("Demo Mode cannot reach any of it", () => {
  const LIVE =
    /spark-http|spark-live-input|spark-live\.functions|@\/server\/|spark-contract|@\/lib\/spark\//;
  it("only the dev route imports the function wrapper and the input constant; nothing else in the app imports any live module", () => {
    const importers = appFiles
      .filter(
        (f) =>
          !/spark-(http|contract|live-input|live\.functions)\.ts$|\/server\/|\/lib\/spark\//.test(
            f,
          ),
      )
      .filter((f) => LIVE.test(strip(readFileSync(f, "utf8"))))
      .map(rel)
      .sort();
    // transcribe.functions.ts is the Handoff transcription wrapper, not a Spark module; it is covered by its own isolation test.
    expect(importers).toEqual([
      "src/lib/meta-transcribe/transcribe.functions.ts",
      "src/routes/_authenticated/dev-spark.tsx",
    ]);
  });
  it("no demo component, demo logic, public route or pipeline index/provider refers to them", () => {
    const demo = appFiles.filter((f) =>
      /components\/visit-demo\/|lib\/visit-demo\/|routes\/demo\.tsx|routes\/_authenticated\/visits\.demo\.tsx|visit-pipeline\/(index|demo|fixture|guard|schema|labels|types)\.ts$/.test(
        f,
      ),
    );
    expect(demo.length).toBeGreaterThan(8);
    for (const f of demo) expect(strip(readFileSync(f, "utf8")), rel(f)).not.toMatch(LIVE);
  });
  it("Demo Mode still cannot be switched to live", () => {
    expect(PIPELINE_MODE).toBe("demo");
    expect(() => getVisitPipeline("live")).toThrow(/not enabled/);
  });
});

describe("the dev page is protected and not reachable through navigation", () => {
  const page = read("src/routes/_authenticated/dev-spark.tsx");
  it("lives under the signed-in layout and asks the server for status, so knowing the URL grants nothing", () => {
    expect(page).toMatch(/createFileRoute\("\/_authenticated\/dev-spark"\)/);
    expect(page).toMatch(/getSparkLiveStatus\(\)/);
    expect(page).toMatch(/status\.data\?\.enabled/); // the run button only exists when the server says enabled
  });
  it("is excluded from search, imports nothing from Demo Mode, and sends only the fixed id", () => {
    expect(page).toMatch(/noindex/);
    expect(page).not.toMatch(/visit-demo|VisitDemo/);
    expect(page).toMatch(
      /runSparkSyntheticExtraction\(\{ data: \{ fixtureId: SPARK_FIXTURE_ID \} \}\)/,
    );
  });
  it("shows the not-medical-advice footer and a development notice", () => {
    expect(page).toMatch(/NOT_MEDICAL_ADVICE/);
    expect(page).toMatch(/DEV TOOL/);
  });
  it("no link, menu, redirect or shell code anywhere mentions the page", () => {
    const mentions = appFiles
      .filter((f) => /dev-spark/.test(readFileSync(f, "utf8")))
      .map(rel)
      .sort();
    expect(mentions).toEqual(["src/routeTree.gen.ts", "src/routes/_authenticated/dev-spark.tsx"]);
  });
  it("the feature is off by default: the status of an empty server environment is not enabled", async () => {
    const { sparkStatus } = await import("@/server/spark-synthetic.server");
    expect(sparkStatus({}, "any-user")).toEqual({ enabled: false });
  });
});
