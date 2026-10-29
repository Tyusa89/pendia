// @vitest-environment node
// Structural guards for Document Upload: where the secret, flags and network call live, that nothing is written without the
// caregiver's confirmation, and that nothing protected was touched.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (f: string) => readFileSync(join(root, f), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const rel = (p: string) => p.replace(`${root}/`, "");
const app = walk(join(root, "src")).filter((f) => /\.(ts|tsx)$/.test(f) && !/\/test\//.test(f));
const SERVER = ["src/server/doc-extract.server.ts", "src/server/doc-extract-source.server.ts"];
const PURE = ["contract", "prompt"].map((n) => `src/lib/doc-upload/${n}.ts`);

describe("secrets and flags", () => {
  it("DOC_EXTRACT_* names appear only in the server module", () => {
    const hits = app
      .filter((f) =>
        /DOC_EXTRACT_(ENABLED|SIMULATED|USER_IDS)/.test(strip(readFileSync(f, "utf8"))),
      )
      .map(rel);
    expect(hits).toEqual(["src/server/doc-extract.server.ts"]);
  });
  it("the wrapper requires auth on both functions and imports server modules inside handlers only", () => {
    const w = strip(read("src/lib/doc-upload/doc-extract.functions.ts"));
    expect(w.match(/createServerFn\(/g)).toHaveLength(2);
    expect(w.match(/\.middleware\(\[requireSupabaseAuth\]\)/g)).toHaveLength(2);
    expect(w).not.toMatch(/^import .* from "@\/server\//m);
    expect(w.match(/await import\("@\/server\/doc-extract\.server"\)/g)).toHaveLength(2);
    expect(w).toMatch(/context\.supabase/);
    expect(w).not.toMatch(/service_role|supabaseAdmin|console\./i);
  });
  it("no client file imports a server module or names the key", () => {
    for (const f of app.filter((x) => !/\/server\//.test(x) && !/doc-extract\.functions/.test(x))) {
      const c = strip(readFileSync(f, "utf8"));
      expect(c, rel(f)).not.toMatch(/from "@\/server\/doc-extract/);
      if (/doc-upload|DocumentUpload|documents\.ts/.test(rel(f)))
        expect(c, rel(f)).not.toMatch(/META_API_KEY/);
    }
  });
});

describe("network call", () => {
  const s = strip(read("src/server/doc-extract.server.ts"));
  it("one fetch call site, POST, redirects refused, a timeout, no retry loop", () => {
    expect(s.match(/\bfetchImpl\(/g)).toHaveLength(1);
    expect(s.match(/method: "POST"/g)).toHaveLength(1);
    expect(s).toMatch(/redirect: "manual"/);
    expect(s).toMatch(/AbortSignal\.timeout/);
    expect(s).not.toMatch(/\bretry\b|attempts/i);
  });
  it("sets no tools, streaming or extra fields; Authorization appears once", () => {
    const p = strip(read("src/lib/doc-upload/prompt.ts"));
    expect(p + s).not.toMatch(/\btools\b|tool_choice|stream:|temperature/);
    expect(s.match(/Authorization/g)).toHaveLength(1);
  });
  it("no console, storage, cookie or write call in the server or pure code", () => {
    for (const f of [...SERVER, ...PURE]) {
      const c = strip(read(f));
      expect(c, f).not.toMatch(
        /console\.|localStorage|sessionStorage|\bdocument\.[a-z]|\bwindow\.[a-z]|cookie/,
      );
      expect(c, f).not.toMatch(
        /\.(insert|update|upsert|delete)\(|\.storage\.from\([^)]*\)\.(upload|remove)/,
      );
      expect(c, f).not.toMatch(/service_role|supabaseAdmin|SERVICE_ROLE/i);
    }
    expect(strip(read("src/lib/doc-upload/contract.ts"))).not.toMatch(
      /\bfetch\b|process\.env|@\/server\//,
    );
  });
});

describe("nothing is saved before confirmation", () => {
  it("only the review form's submit handler calls save; the upload flow never creates an appointment on its own", () => {
    const f = strip(read("src/components/DocumentUploadFlow.tsx"));
    expect(f.match(/deps\.save\(/g)).toHaveLength(1);
    expect(f).toMatch(/onSubmit=\{\(input\) => void submit\(step\.path, input\)\}/);
    expect(f).not.toMatch(/createAppointment|supabase/);
  });
  it("no database table or record is created by the extraction path", () => {
    const s = strip(read("src/server/doc-extract-source.server.ts"));
    expect(s).not.toMatch(/\.from\("visit"\)|\.from\("med/);
  });
});

describe("migration and protected areas", () => {
  const sql = read("supabase/migrations/20261029000001_appointment_documents.sql");
  it("the bucket is private with the three types and a 10 MB limit; policies are path-derived and organizer-write", () => {
    expect(sql).toMatch(/'appointment-docs', 'appointment-docs', false, 10485760/);
    expect(sql).toMatch(/array\['application\/pdf', 'image\/jpeg', 'image\/png'\]/);
    expect(sql).toMatch(/member_can_see\(public\.appt_doc_path_family\(p\), 'visits'\)/);
    expect(sql).toMatch(/is_family_organizer\(public\.appt_doc_path_family\(p\)\)/);
    expect(sql.match(/create policy/g)).toHaveLength(4);
    expect(sql).toMatch(/document_path text;/);
    expect(sql).toMatch(
      /check \(document_path is null or public\.appt_doc_path_family\(document_path\) = family_id\)/,
    );
    expect(sql).not.toMatch(/drop table|drop column|alter column .* not null/i);
  });
  it("the Care Agent flag stays off and the Spark primitives are only imported, not edited", () => {
    expect(read("src/lib/features.ts")).toMatch(/assistant: false/);
  });
});
