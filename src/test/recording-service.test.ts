// Service-layer tests with an in-memory backend. The fake enforces ONE safety invariant after every operation:
// no handoff row may reference an object that does not exist. Real family isolation is enforced in the database and
// proven by supabase/tests/storage.test.sql; these tests cover ordering, compensation and error handling.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRecordingService,
  RecordingSaveError,
  recordingPath,
  SIGNED_URL_MAX_TTL_SECONDS,
  SIGNED_URL_TTL_SECONDS,
  type HandoffBase,
  type RecordingToSave,
} from "@/services/recordings";

const FAM_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const FAM_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const HID = "11111111-1111-4111-8111-111111111111";

type Row = {
  id: string;
  audio_path?: string | null;
  audio_wav_path?: string | null;
  duration_seconds?: number | null;
  unusual?: string | null;
  [column: string]: unknown;
};

class FakeBackend {
  objects = new Map<string, { size: number; type: string }>();
  rows = new Map<string, Row>();
  log: string[] = [];
  failUpload: (path: string, nth: number) => boolean = () => false;
  failInsert: "no" | "plain" | "ambiguous-committed" | "ambiguous-lost" = "no";
  removeFailures = 0; // number of remove() calls that fail before succeeding; Infinity = always
  clearFails = false;
  uploads = 0;
  signedAs: string | null = null; // family id of the caller, to emulate storage RLS for the signed-URL test
  signed: Array<{ path: string; ttl: number; download?: string | undefined }> = [];

  private checkInvariant(where: string) {
    for (const r of this.rows.values()) {
      for (const k of ["audio_path", "audio_wav_path"]) {
        const p = r[k];
        if (typeof p === "string" && !this.objects.has(p))
          throw new Error(
            `INVARIANT BROKEN after ${where}: handoff ${r.id} references missing object ${p}`,
          );
      }
    }
  }

  storage = {
    upload: async (path: string, body: Blob, opts: { contentType: string; upsert: false }) => {
      this.log.push(`upload:${path}`);
      this.uploads++;
      if (this.failUpload(path, this.uploads)) return { error: { message: "upload failed" } };
      this.objects.set(path, { size: body.size, type: opts.contentType });
      this.checkInvariant("upload");
      return { error: null };
    },
    remove: async (paths: string[]) => {
      this.log.push(`remove:${paths.join(",")}`);
      if (this.removeFailures > 0) {
        this.removeFailures--;
        return { error: { message: "storage unavailable" } };
      }
      for (const p of paths) this.objects.delete(p); // removing a missing object is not an error
      this.checkInvariant("remove");
      return { error: null };
    },
    createSignedUrl: async (path: string, ttl: number, opts?: { download?: string }) => {
      if (this.signedAs && !path.startsWith(`${this.signedAs}/`))
        return { data: null, error: { message: "Object not found" } }; // what RLS looks like to a caller
      this.signed.push({ path, ttl, download: opts?.download });
      return { data: { signedUrl: `https://signed.example/${path}?token=t` }, error: null };
    },
  };
  db = {
    insertHandoff: async (row: Row) => {
      this.log.push("insert");
      if (this.failInsert === "plain" || this.failInsert === "ambiguous-lost")
        return { error: { message: "insert failed" } };
      this.rows.set(row.id, row);
      this.checkInvariant("insert");
      if (this.failInsert === "ambiguous-committed")
        return { error: { message: "network timeout" } };
      return { error: null };
    },
    handoffExists: async (id: string) => this.rows.has(id),
    clearRecording: async (id: string) => {
      this.log.push("clear");
      if (this.clearFails) return { error: { message: "db unavailable" } };
      const r = this.rows.get(id);
      if (r)
        for (const k of [
          "audio_path",
          "audio_mime",
          "audio_size_bytes",
          "audio_wav_path",
          "audio_wav_mime",
          "audio_wav_size_bytes",
          "duration_seconds",
        ])
          r[k] = null;
      this.checkInvariant("clear");
      return { error: null };
    },
  };
}

const base: HandoffBase = {
  family_id: FAM_A,
  author_member_id: "m1",
  ate: true,
  meds_taken: true,
  unusual: "Felt tired",
  watch_answers: {},
};
const rec: RecordingToSave = {
  original: new Blob(["orig-bytes-0123456789"], { type: "audio/webm;codecs=opus" }),
  originalMime: "audio/webm;codecs=opus",
  wav: new Blob(["wav-bytes"], { type: "audio/wav" }),
  durationSec: 8.2549,
};

let be: FakeBackend;
let svc: ReturnType<typeof createRecordingService>;
beforeEach(() => {
  be = new FakeBackend();
  svc = createRecordingService({
    storage: be.storage,
    db: be.db as never,
    sleep: async () => {},
    newId: () => HID,
  });
});

describe("save: upload -> DB write -> compensate", () => {
  it("uploads the original and the WAV under {family}/handoff/{id}/ and writes one row referencing exactly those", async () => {
    const out = await svc.saveHandoffWithRecording(base, rec);
    expect(be.log).toEqual([
      `upload:${FAM_A}/handoff/${HID}/original.webm`,
      `upload:${FAM_A}/handoff/${HID}/pcm.wav`,
      "insert",
    ]);
    expect(out).toEqual({
      id: HID,
      audioPath: `${FAM_A}/handoff/${HID}/original.webm`,
      wavPath: `${FAM_A}/handoff/${HID}/pcm.wav`,
    });
    expect([...be.objects.keys()].sort()).toEqual([out.audioPath, out.wavPath].sort());
    const row = be.rows.get(HID)!;
    expect(row).toMatchObject({
      id: HID,
      family_id: FAM_A,
      ate: true,
      unusual: "Felt tired",
      audio_path: out.audioPath,
      audio_mime: "audio/webm;codecs=opus",
      audio_size_bytes: rec.original.size,
      audio_wav_path: out.wavPath,
      audio_wav_mime: "audio/wav",
      audio_wav_size_bytes: rec.wav.size,
      duration_seconds: 8.25,
    });
  });

  it("sends content types without codec parameters (the bucket allow-list matches base types)", async () => {
    await svc.saveHandoffWithRecording(base, rec);
    expect(be.objects.get(`${FAM_A}/handoff/${HID}/original.webm`)?.type).toBe("audio/webm");
    expect(be.objects.get(`${FAM_A}/handoff/${HID}/pcm.wav`)?.type).toBe("audio/wav");
  });

  it("uses the mp4 extension for Safari-style recordings", async () => {
    const out = await svc.saveHandoffWithRecording(base, { ...rec, originalMime: "audio/mp4" });
    expect(out.audioPath.endsWith("/original.mp4")).toBe(true);
  });

  it("builds every path from the caller's own family id", async () => {
    const out = await svc.saveHandoffWithRecording({ ...base, family_id: FAM_B }, rec);
    expect(out.audioPath.startsWith(`${FAM_B}/handoff/`)).toBe(true);
    expect(out.wavPath.startsWith(`${FAM_B}/handoff/`)).toBe(true);
    expect(recordingPath(FAM_B, "handoff", HID, "x.wav")).toBe(`${FAM_B}/handoff/${HID}/x.wav`);
  });

  it("DB write fails -> BOTH objects are removed: no orphan, no row, and the save does not report success", async () => {
    be.failInsert = "plain";
    await expect(svc.saveHandoffWithRecording(base, rec)).rejects.toBeInstanceOf(
      RecordingSaveError,
    );
    expect(be.objects.size).toBe(0);
    expect(be.rows.size).toBe(0);
    expect(be.log.at(-1)).toMatch(/^remove:/);
  });

  it("first upload fails -> nothing stored, no DB write", async () => {
    be.failUpload = (p) => p.endsWith("original.webm");
    await expect(svc.saveHandoffWithRecording(base, rec)).rejects.toThrow(/upload failed/);
    expect(be.objects.size).toBe(0);
    expect(be.log).not.toContain("insert");
  });

  it("second upload fails -> the first is removed, no DB write", async () => {
    be.failUpload = (p) => p.endsWith("pcm.wav");
    await expect(svc.saveHandoffWithRecording(base, rec)).rejects.toThrow(/upload failed/);
    expect(be.objects.size).toBe(0);
    expect(be.rows.size).toBe(0);
    expect(be.log).not.toContain("insert");
  });

  it("cleanup that fails transiently is retried until the objects are gone", async () => {
    be.failInsert = "plain";
    be.removeFailures = 2;
    const err = await svc.saveHandoffWithRecording(base, rec).catch((e) => e);
    expect(err).toBeInstanceOf(RecordingSaveError);
    expect(err.cleanupComplete).toBe(true);
    expect(be.objects.size).toBe(0);
    expect(be.log.filter((l) => l.startsWith("remove:")).length).toBe(3);
  });

  it("cleanup that keeps failing is reported honestly (and the save still fails)", async () => {
    be.failInsert = "plain";
    be.removeFailures = Infinity;
    const err = (await svc
      .saveHandoffWithRecording(base, rec)
      .catch((e) => e)) as RecordingSaveError;
    expect(err).toBeInstanceOf(RecordingSaveError);
    expect(err.cleanupComplete).toBe(false);
    expect(err.leftoverPaths.length).toBe(2);
    expect(err.message).toMatch(/Nothing was saved/);
    expect(err.message).toMatch(/not attached to any handoff/);
    expect(be.rows.size).toBe(0);
  });

  it("an ambiguous DB error where the row actually committed keeps the objects (a handoff must not lose its files)", async () => {
    be.failInsert = "ambiguous-committed";
    const out = await svc.saveHandoffWithRecording(base, rec);
    expect(out.id).toBe(HID);
    expect(be.objects.size).toBe(2);
    expect(be.rows.has(HID)).toBe(true);
  });

  it("an ambiguous DB error where the row did NOT commit still cleans up", async () => {
    be.failInsert = "ambiguous-lost";
    await expect(svc.saveHandoffWithRecording(base, rec)).rejects.toBeInstanceOf(
      RecordingSaveError,
    );
    expect(be.objects.size).toBe(0);
  });

  it.each([
    ["first upload", (b: FakeBackend) => (b.failUpload = (p) => p.endsWith("original.webm"))],
    ["second upload", (b: FakeBackend) => (b.failUpload = (p) => p.endsWith("pcm.wav"))],
    ["DB insert", (b: FakeBackend) => (b.failInsert = "plain")],
  ])("never resolves when the %s fails, and never leaves objects behind", async (_name, inject) => {
    inject(be);
    const settled = await svc.saveHandoffWithRecording(base, rec).then(
      () => "resolved",
      () => "rejected",
    );
    expect(settled).toBe("rejected");
    expect(be.objects.size).toBe(0);
  });
});

describe("delete: clear the DB reference first, then remove objects", () => {
  async function saved() {
    const out = await svc.saveHandoffWithRecording(base, rec);
    be.log.length = 0;
    return { id: out.id, audio_path: out.audioPath, audio_wav_path: out.wavPath };
  }

  it("clears the reference, then removes both objects; the handoff itself stays", async () => {
    const h = await saved();
    const res = await svc.deleteHandoffRecording(h);
    expect(be.log).toEqual(["clear", `remove:${h.audio_path},${h.audio_wav_path}`]);
    expect(res).toEqual({ filesRemoved: true });
    expect(be.objects.size).toBe(0);
    const row = be.rows.get(h.id)!;
    expect(row.audio_path).toBeNull();
    expect(row.audio_wav_path).toBeNull();
    expect(row.duration_seconds).toBeNull();
    expect(row.unusual).toBe("Felt tired"); // the written note is untouched
  });

  it("tolerates objects that are already missing", async () => {
    const h = await saved();
    be.objects.clear(); // gone behind our back (the invariant check is only evaluated on operations)
    be.rows.get(h.id)!.audio_path = null;
    be.rows.get(h.id)!.audio_wav_path = null;
    const res = await svc.deleteHandoffRecording(h);
    expect(res.filesRemoved).toBe(true);
  });

  it("if clearing the DB reference fails nothing is removed and the reference stays valid", async () => {
    const h = await saved();
    be.clearFails = true;
    await expect(svc.deleteHandoffRecording(h)).rejects.toThrow(/Couldn't remove the recording/);
    expect(be.objects.size).toBe(2);
    expect(be.rows.get(h.id)!.audio_path).toBe(h.audio_path);
    expect(be.log).not.toContainEqual(expect.stringMatching(/^remove:/));
  });

  it("if object removal fails after the reference was cleared, the handoff still never points at a missing file", async () => {
    const h = await saved();
    be.removeFailures = Infinity;
    const res = await svc.deleteHandoffRecording(h);
    expect(res.filesRemoved).toBe(false); // orphan objects remain, unreferenced (a sweeper would collect them)
    expect(be.rows.get(h.id)!.audio_path).toBeNull();
    expect(be.objects.size).toBe(2);
  });

  it("is a no-op for a handoff without a recording", async () => {
    expect(
      await svc.deleteHandoffRecording({ id: "x", audio_path: null, audio_wav_path: null }),
    ).toEqual({ filesRemoved: true });
    expect(be.log).toEqual([]);
  });
});

describe("signed URLs", () => {
  const path = `${FAM_A}/handoff/${HID}/original.webm`;

  it("default to 5 minutes", async () => {
    await svc.getPlaybackUrl(path, { expectFamilyId: FAM_A });
    expect(be.signed[0]!.ttl).toBe(SIGNED_URL_TTL_SECONDS);
    expect(SIGNED_URL_TTL_SECONDS).toBe(300);
  });

  it("can never be asked for more than 10 minutes", async () => {
    await svc.getPlaybackUrl(path, { ttlSeconds: 86400 });
    expect(be.signed[0]!.ttl).toBe(SIGNED_URL_MAX_TTL_SECONDS);
    expect(SIGNED_URL_MAX_TTL_SECONDS).toBe(600);
  });

  it("downloads use the same call (same authorization, same lifetime) with a download name", async () => {
    await svc.getPlaybackUrl(path, { expectFamilyId: FAM_A, download: "handoff.webm" });
    expect(be.signed[0]).toEqual({ path, ttl: 300, download: "handoff.webm" });
  });

  it("refuses to even ask for another family's path", async () => {
    const spy = vi.spyOn(be.storage, "createSignedUrl");
    await expect(
      svc.getPlaybackUrl(`${FAM_B}/handoff/${HID}/original.webm`, { expectFamilyId: FAM_A }),
    ).rejects.toThrow(/different family/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("when storage denies it (as RLS does for another family) the error surfaces and no URL is returned", async () => {
    be.signedAs = FAM_B;
    await expect(svc.getPlaybackUrl(path)).rejects.toThrow(/not found/i);
  });

  it("the signed URL is returned to the caller, never persisted by the service", async () => {
    const url = await svc.getPlaybackUrl(path);
    expect(url).toContain("signed.example");
    expect(JSON.stringify([...be.rows.values()])).not.toContain("signed.example");
  });
});
