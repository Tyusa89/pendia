// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  createDocumentService,
  DOC_SIGNED_URL_TTL_SECONDS,
  type DocStorage,
} from "@/services/documents";
import { docPathFamily } from "@/lib/doc-upload/contract";
import { DOC_ID, FAM_A, FAM_B, PATH_A } from "./doc-upload-helpers";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

function fakeStorage(
  tree: Record<string, Array<{ name: string; created_at?: string }>> = {},
  over: Partial<DocStorage> = {},
) {
  const calls = {
    upload: [] as string[],
    remove: [] as string[][],
    signed: [] as Array<[string, number]>,
  };
  const s: DocStorage = {
    upload: async (p) => (calls.upload.push(p), { error: null }),
    remove: async (p) => (calls.remove.push(p), { error: null }),
    createSignedUrl: async (p, n) => (
      calls.signed.push([p, n]),
      { data: { signedUrl: `https://signed.example/${p}` }, error: null }
    ),
    list: async (prefix) => ({
      data: (tree[prefix] ?? []).map((e) => ({ id: e.created_at ? "x" : null, ...e })),
      error: null,
    }),
    ...over,
  };
  return { s, calls };
}

describe("upload", () => {
  it("stores under the caller-supplied family's folder with a fresh id and the right type", async () => {
    const { s, calls } = fakeStorage();
    const path = await createDocumentService(s, () => DOC_ID).uploadPending(
      FAM_A,
      new Blob(["x"]),
      "png",
    );
    expect(path).toBe(`${FAM_A}/doc/${DOC_ID}/appointment-letter.png`);
    expect(docPathFamily(path)).toBe(FAM_A);
    expect(calls.upload).toEqual([path]);
  });
  it("a failed upload throws and leaves nothing to clean up", async () => {
    const { s, calls } = fakeStorage(
      {},
      { upload: async () => ({ error: { message: "denied" } }) },
    );
    await expect(
      createDocumentService(s, () => DOC_ID).uploadPending(FAM_A, new Blob(["x"]), "pdf"),
    ).rejects.toThrow(/Nothing was saved/);
    expect(calls.remove).toEqual([]);
  });
});

describe("remove and view", () => {
  it("refuses to remove or sign a malformed path (no storage call)", async () => {
    const { s, calls } = fakeStorage();
    const svc = createDocumentService(s);
    expect(await svc.remove("../x")).toBe(false);
    await expect(svc.signedUrl("loose.pdf")).rejects.toThrow();
    expect(calls.remove).toEqual([]);
    expect(calls.signed).toEqual([]);
  });
  it("signs for 5 minutes only", async () => {
    const { s, calls } = fakeStorage();
    await createDocumentService(s).signedUrl(PATH_A);
    expect(calls.signed).toEqual([[PATH_A, DOC_ID && DOC_SIGNED_URL_TTL_SECONDS]]);
    expect(DOC_SIGNED_URL_TTL_SECONDS).toBeLessThanOrEqual(600);
  });
  it("a storage denial surfaces as a plain error", async () => {
    const { s } = fakeStorage(
      {},
      { createSignedUrl: async () => ({ data: null, error: { message: "nope" } }) },
    );
    await expect(createDocumentService(s).signedUrl(PATH_A)).rejects.toThrow(
      "Couldn't open the document.",
    );
  });
});

describe("abandoned uploads are swept safely", () => {
  const D1 = "55555555-5555-4555-8555-555555555555";
  const D2 = "66666666-6666-4666-8666-666666666666";
  const D3 = "77777777-7777-4777-8777-777777777777";
  const tree = {
    [`${FAM_A}/doc`]: [{ name: D1 }, { name: D2 }, { name: D3 }],
    [`${FAM_A}/doc/${D1}`]: [{ name: "appointment-letter.pdf", created_at: ago(30) }], // stale, unreferenced
    [`${FAM_A}/doc/${D2}`]: [{ name: "appointment-letter.pdf", created_at: ago(30) }], // stale but referenced
    [`${FAM_A}/doc/${D3}`]: [{ name: "appointment-letter.pdf", created_at: ago(1) }], // recent (may be in use)
  };
  it("removes only stale, unreferenced files of this family", async () => {
    const { s, calls } = fakeStorage(tree);
    const referenced = new Set([`${FAM_A}/doc/${D2}/appointment-letter.pdf`]);
    const removed = await createDocumentService(s).sweepAbandoned(FAM_A, referenced, NOW);
    expect(removed).toEqual([`${FAM_A}/doc/${D1}/appointment-letter.pdf`]);
    expect(calls.remove).toEqual([removed]);
  });
  it("never lists or touches another family's folder", async () => {
    const listed: string[] = [];
    const { s } = fakeStorage(tree, {
      list: async (p) => (listed.push(p), { data: [], error: null }),
    });
    await createDocumentService(s).sweepAbandoned(FAM_A, new Set(), NOW);
    expect(listed.every((p) => p.startsWith(`${FAM_A}/`))).toBe(true);
    expect(listed.some((p) => p.includes(FAM_B))).toBe(false);
  });
  it("a listing error removes nothing", async () => {
    const remove = vi.fn(async () => ({ error: null }));
    const { s } = fakeStorage(
      {},
      { list: async () => ({ data: null, error: { message: "x" } }), remove },
    );
    expect(await createDocumentService(s).sweepAbandoned(FAM_A, new Set(), NOW)).toEqual([]);
    expect(remove).not.toHaveBeenCalled();
  });
  it("files with no timestamp are kept", async () => {
    const { s, calls } = fakeStorage({
      [`${FAM_A}/doc`]: [{ name: D1 }],
      [`${FAM_A}/doc/${D1}`]: [{ name: "appointment-letter.pdf" }],
    });
    expect(await createDocumentService(s).sweepAbandoned(FAM_A, new Set(), NOW)).toEqual([]);
    expect(calls.remove).toEqual([]);
  });
});
