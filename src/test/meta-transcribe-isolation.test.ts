// @vitest-environment node
// Static guards for the Handoff voice-transcription integration: authentication stays server-side, the browser bundle never sees
// the key, the endpoint is written once, the default transcriber stays disconnected, and Demo Mode cannot reach any of it.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dictationTranscriber } from "@/services/dictation";

const root = join(__dirname, "../..");
const rel = (f: string) => f.replace(`${root}/`, "");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const read = (p: string) => strip(readFileSync(join(root, p), "utf8"));
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
const appFiles = walk(join(root, "src")).filter((f) => !/\/test\//.test(f));
const SERVER = "src/server/meta-transcribe.server.ts";
const FUNCTIONS = "src/lib/meta-transcribe/transcribe.functions.ts";

describe("server functions", () => {
  const src = read(FUNCTIONS);
  it("both require a signed-in user and validate their input", () => {
    expect(src.match(/createServerFn\(/g)).toHaveLength(2);
    expect(src.match(/\.middleware\(\[requireSupabaseAuth\]\)/g)).toHaveLength(2);
    expect(src.match(/\.validator\(/g)).toHaveLength(2);
    expect(src).toMatch(/transcribeInputSchema\.parse/);
    expect(src).toMatch(/statusInputSchema\.parse/);
  });
  it("import the server module inside the handlers only, and log nothing", () => {
    expect(src).not.toMatch(/^import .* from "@\/server\//m);
    expect(src.match(/await import\("@\/server\/meta-transcribe\.server"\)/g)).toHaveLength(2);
    expect(src).not.toMatch(/console\./);
  });
  it("check family permission with the caller's own session, never a service key", () => {
    expect(src).toMatch(/context\.supabase/);
    expect(src).not.toMatch(/service_role|SERVICE_ROLE|client\.server|supabaseAdmin/);
    // one shared lookup, used by BOTH handlers; it throws on a lookup error instead of answering "no"
    expect(src.match(/role === "organizer"/g)).toHaveLength(1);
    expect(
      src.match(/memberIsOrganizer\(context\.supabase, context\.userId, familyId\)/g),
    ).toHaveLength(2);
    expect(src).toMatch(/if \(error\) throw new Error\("member_lookup_failed"\)/);
  });
});

describe("the key, the flag and the endpoint", () => {
  const SECRET = /META_API_KEY|META_TRANSCRIBE_ENABLED/;
  it("the key and flag names appear in this feature only in the server module and the pure input-free server functions' env hand-off", () => {
    const hits = appFiles
      .filter((f) => /meta-transcribe/.test(f))
      .filter((f) => SECRET.test(strip(readFileSync(f, "utf8"))))
      .map(rel);
    expect(hits).toEqual([SERVER]);
  });
  it("no client, component, hook, route or service file mentions the key or the flag", () => {
    const hits = appFiles
      .filter((f) => !/\/server\//.test(f))
      .filter((f) => SECRET.test(strip(readFileSync(f, "utf8"))))
      .map(rel);
    expect(hits).toEqual([]);
  });
  it("the Authorization header is built only in the server module", () => {
    const hits = appFiles
      .filter((f) => /meta-transcribe/.test(f))
      .filter((f) => /Authorization|Bearer/.test(strip(readFileSync(f, "utf8"))))
      .map(rel);
    expect(hits).toEqual([SERVER]);
  });
  it("the transcription endpoint is written once, in the pure contract; only the server module uses its URL constant", () => {
    const withHost = appFiles
      .filter((f) => /api\.meta\.ai\/v1\/asr/.test(strip(readFileSync(f, "utf8"))))
      .map(rel);
    expect(withHost).toEqual(["src/lib/meta-transcribe/contract.ts"]);
    const users = appFiles
      .filter((f) => /META_TRANSCRIBE_URL/.test(strip(readFileSync(f, "utf8"))))
      .map(rel)
      .sort();
    expect(users).toEqual(["src/lib/meta-transcribe/contract.ts", SERVER]);
  });
  it("the server module makes one fetch call site, refuses redirects, sets a timeout, has no retry loop, and logs nothing", () => {
    const code = read(SERVER);
    expect(code.match(/opts\.fetchImpl\(/g)).toHaveLength(1);
    expect(code).toMatch(/redirect: "manual"/);
    expect(code).toMatch(/AbortSignal\.timeout\(/);
    expect(code).not.toMatch(/\b(for|while)\s*\([^)]*retry|retries|attempt/i);
    expect(code).not.toMatch(/console\./);
    expect(code).not.toMatch(
      /localStorage|sessionStorage|document\.|window\.|from "react|@\/components|@\/services|@\/hooks|supabase/,
    );
  });
  it("the pure modules have no network, environment or storage access", () => {
    for (const f of [
      "src/lib/meta-transcribe/contract.ts",
      "src/lib/meta-transcribe/response.ts",
      "src/lib/meta-transcribe/input.ts",
    ])
      expect(read(f), f).not.toMatch(
        /\bfetch\b|process\.env|import\.meta\.env|localStorage|XMLHttpRequest|WebSocket/,
      );
  });
});

describe("existing behaviour and boundaries", () => {
  it("the default transcriber is still unavailable; only the Handoffs page supplies a connected one", () => {
    expect(dictationTranscriber.available).toBe(false);
    const users = appFiles
      .filter((f) =>
        /meta-transcribe\/client|useMetaTranscriber/.test(strip(readFileSync(f, "utf8"))),
      )
      .map(rel)
      .sort();
    expect(users).toEqual([
      "src/lib/meta-transcribe/client.ts",
      "src/routes/_authenticated/handoffs.tsx",
    ]);
  });
  it("Demo Mode and the visit pipeline cannot reach the integration", () => {
    const demo = appFiles.filter((f) =>
      /components\/visit-demo\/|lib\/visit-demo\/|routes\/demo\.tsx|routes\/_authenticated\/visits\.demo\.tsx|lib\/visit-pipeline\//.test(
        f,
      ),
    );
    expect(demo.length).toBeGreaterThan(8);
    for (const f of demo)
      expect(strip(readFileSync(f, "utf8")), rel(f)).not.toMatch(
        /meta-transcribe|services\/dictation|HandoffDictation/,
      );
  });
  it("nothing in the integration touches the database schema or storage", () => {
    for (const f of appFiles.filter((f) => /meta-transcribe/.test(f)))
      expect(strip(readFileSync(f, "utf8")), rel(f)).not.toMatch(
        /\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(|\.storage|recordingService|handoffService/,
      );
  });
});
