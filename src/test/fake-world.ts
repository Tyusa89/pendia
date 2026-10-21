// A persistent in-memory "backend" (storage objects + handoff rows) shared by page-level tests. It survives
// unmount/remount, which is how tests model a page refresh or a sign-out/sign-in. After EVERY operation it checks
// the safety invariant: no handoff row references an object that does not exist.
import { vi } from "vitest";

export const FAM = "aaaaaaaa-0000-4000-8000-00000000000a";
type Row = { id: string; [column: string]: unknown };
const REC_COLUMNS = [
  "audio_path",
  "audio_mime",
  "audio_size_bytes",
  "audio_wav_path",
  "audio_wav_mime",
  "audio_wav_size_bytes",
  "duration_seconds",
];

export class World {
  objects = new Map<string, { size: number; type: string }>();
  rows: Row[] = [];
  log: string[] = [];
  failInsert = false;
  signedRequests: Array<{ path: string; ttl: number; download?: string | undefined }> = [];

  reset() {
    this.objects.clear();
    this.rows = [];
    this.log = [];
    this.failInsert = false;
    this.signedRequests = [];
  }

  private invariant(where: string) {
    for (const r of this.rows)
      for (const k of ["audio_path", "audio_wav_path"]) {
        const p = r[k];
        if (typeof p === "string" && !this.objects.has(p))
          throw new Error(`INVARIANT BROKEN after ${where}: ${r.id} -> missing ${p}`);
      }
  }

  /** Rows as the page's list query would return them (all columns present). */
  listRows() {
    return this.rows.map((r) => ({
      author_member_id: "mem-1",
      created_at: "2026-10-21T10:00:00Z",
      ate: true,
      meds_taken: true,
      unusual: null,
      note: null,
      shift_id: null,
      watch_answers: {},
      family_id: FAM,
      ...Object.fromEntries(REC_COLUMNS.map((c) => [c, null])),
      ...r,
    }));
  }

  /** Seed a handoff that already has a saved recording (objects + row), e.g. "saved yesterday". */
  seedSaved(id: string, opts: { duration?: number; unusual?: string } = {}) {
    const audio = `${FAM}/handoff/${id}/original.webm`;
    const wav = `${FAM}/handoff/${id}/pcm.wav`;
    this.objects.set(audio, { size: 4000, type: "audio/webm" });
    this.objects.set(wav, { size: 8000, type: "audio/wav" });
    this.rows.push({
      id,
      family_id: FAM,
      unusual: opts.unusual ?? "Napped after lunch",
      audio_path: audio,
      audio_mime: "audio/webm;codecs=opus",
      audio_size_bytes: 4000,
      audio_wav_path: wav,
      audio_wav_mime: "audio/wav",
      audio_wav_size_bytes: 8000,
      duration_seconds: opts.duration ?? 8.25,
    });
    return { audio, wav };
  }

  storage = {
    upload: async (path: string, body: Blob, opts: { contentType: string }) => {
      this.log.push(`upload:${path.split("/").slice(3).join("/")}`);
      this.objects.set(path, { size: body.size, type: opts.contentType });
      this.invariant("upload");
      return { error: null };
    },
    remove: async (paths: string[]) => {
      this.log.push(`remove:${paths.length}`);
      for (const p of paths) this.objects.delete(p);
      this.invariant("remove");
      return { error: null };
    },
    createSignedUrl: async (path: string, ttl: number, opts?: { download?: string }) => {
      this.signedRequests.push({ path, ttl, download: opts?.download });
      if (!this.objects.has(path)) return { data: null, error: { message: "Object not found" } };
      return {
        data: { signedUrl: `https://signed.example/${path}?t=${this.signedRequests.length}` },
        error: null,
      };
    },
  };

  db = {
    insertHandoff: async (row: Row) => {
      this.log.push("insert");
      if (this.failInsert) return { error: { message: "insert failed" } };
      this.rows.push(row);
      this.invariant("insert");
      return { error: null };
    },
    handoffExists: async (id: string) => this.rows.some((r) => r.id === id),
    clearRecording: async (id: string) => {
      this.log.push("clear");
      const r = this.rows.find((x) => x.id === id);
      if (r) for (const c of REC_COLUMNS) r[c] = null;
      this.invariant("clear");
      return { error: null };
    },
  };
}

export const world = new World();
export const toastSpy = { success: vi.fn(), error: vi.fn() };
