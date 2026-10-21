// Persistent handoff recordings: private bucket, family-scoped paths, upload -> DB write -> compensate ordering,
// delete = clear DB reference first then remove objects, and short-lived signed URLs for playback and download.
// The storage RLS that actually enforces who may read/write lives in the database (see
// supabase/migrations/*_recordings_storage.sql); this layer never trusts the UI for the family id in a path.
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";

export const RECORDINGS_BUCKET = "recordings";
/** Playback and download links live 5 minutes; never more than 10. They are never stored. */
export const SIGNED_URL_TTL_SECONDS = 300;
export const SIGNED_URL_MAX_TTL_SECONDS = 600;
const CLEANUP_ATTEMPTS = 3;

type StoreError = { message: string; statusCode?: string | number | undefined } | null;

export interface RecordingStorage {
  upload(
    path: string,
    body: Blob,
    opts: { contentType: string; upsert: false },
  ): Promise<{ error: StoreError }>;
  remove(paths: string[]): Promise<{ error: StoreError }>;
  createSignedUrl(
    path: string,
    expiresIn: number,
    opts?: { download?: string },
  ): Promise<{ data: { signedUrl: string } | null; error: StoreError }>;
}

export interface HandoffRecordingDb {
  insertHandoff(row: TablesInsert<"handoff">): Promise<{ error: StoreError }>;
  handoffExists(id: string): Promise<boolean>;
  /** Sets every recording column to null in ONE statement (the DB check requires all-or-none). */
  clearRecording(id: string): Promise<{ error: StoreError }>;
}

export interface RecordingToSave {
  original: Blob;
  /** Full MIME as recorded, e.g. "audio/webm;codecs=opus". */
  originalMime: string;
  /** 16 kHz mono 16-bit PCM WAV: the transcription-ready copy. */
  wav: Blob;
  durationSec: number;
}

export type HandoffBase = Omit<
  TablesInsert<"handoff">,
  | "id"
  | "audio_path"
  | "audio_mime"
  | "audio_size_bytes"
  | "audio_wav_path"
  | "audio_wav_mime"
  | "audio_wav_size_bytes"
  | "duration_seconds"
> & { family_id: string };

export class RecordingSaveError extends Error {
  constructor(
    reason: string,
    /** False if a temporary upload could not be removed (it is not attached to any handoff). */
    readonly cleanupComplete: boolean,
    readonly leftoverPaths: string[],
  ) {
    super(
      `Couldn't save the handoff with its recording: ${reason}. Nothing was saved.` +
        (cleanupComplete
          ? ""
          : " A temporary upload could not be removed; it is not attached to any handoff."),
    );
    this.name = "RecordingSaveError";
  }
}

export const recordingPath = (
  familyId: string,
  entity: "handoff" | "visit",
  entityId: string,
  file: string,
) => `${familyId}/${entity}/${entityId}/${file}`;

const baseType = (mime: string) => (mime.split(";")[0] ?? "").trim();
const extensionFor = (mime: string) =>
  mime.startsWith("audio/mp4") ? "mp4" : mime.startsWith("audio/ogg") ? "ogg" : "webm";
const msg = (e: unknown) =>
  e instanceof Error ? e.message : typeof e === "string" ? e : "unknown error";
const isNotFound = (e: NonNullable<StoreError>) =>
  /not.?found|does not exist|no such/i.test(e.message) || String(e.statusCode) === "404";

export function createRecordingService(deps: {
  storage: RecordingStorage;
  db: HandoffRecordingDb;
  sleep?: (ms: number) => Promise<void>;
  newId?: () => string;
}) {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const newId = deps.newId ?? (() => crypto.randomUUID());

  /** Removes objects, retrying with backoff; a missing object counts as removed. Returns whether all are gone. */
  async function removeAll(paths: string[]): Promise<boolean> {
    if (paths.length === 0) return true;
    for (let attempt = 0; attempt < CLEANUP_ATTEMPTS; attempt++) {
      let error: StoreError;
      try {
        ({ error } = await deps.storage.remove(paths));
      } catch (e) {
        error = { message: msg(e) };
      }
      if (!error || isNotFound(error)) return true;
      if (attempt < CLEANUP_ATTEMPTS - 1) await sleep(200 * 3 ** attempt);
    }
    return false;
  }

  async function upload(path: string, body: Blob, contentType: string) {
    const { error } = await deps.storage.upload(path, body, { contentType, upsert: false });
    if (error) throw new Error(error.message);
  }

  return {
    /**
     * Save = upload original, upload WAV, write the DB row (which carries the references), and if anything fails
     * remove what was uploaded. A handoff row is only ever written after its objects exist.
     * Throws on any failure, so a failed save can never be reported as success.
     */
    async saveHandoffWithRecording(base: HandoffBase, rec: RecordingToSave) {
      const id = newId();
      const family = base.family_id;
      const audioPath = recordingPath(
        family,
        "handoff",
        id,
        `original.${extensionFor(rec.originalMime)}`,
      );
      const wavPath = recordingPath(family, "handoff", id, "pcm.wav");
      const attempted: string[] = [];
      try {
        attempted.push(audioPath); // recorded before the call: an upload that errors may still have stored bytes
        await upload(audioPath, rec.original, baseType(rec.originalMime));
        attempted.push(wavPath);
        await upload(wavPath, rec.wav, "audio/wav");

        const row: TablesInsert<"handoff"> = {
          ...base,
          id,
          audio_path: audioPath,
          audio_mime: rec.originalMime,
          audio_size_bytes: rec.original.size,
          audio_wav_path: wavPath,
          audio_wav_mime: "audio/wav",
          audio_wav_size_bytes: rec.wav.size,
          duration_seconds: Math.round(rec.durationSec * 100) / 100,
        };
        const { error } = await deps.db.insertHandoff(row);
        if (error) {
          // An ambiguous failure (e.g. a timeout) may have committed the row. If it exists, the objects must stay.
          if (!(await deps.db.handoffExists(id).catch(() => false))) throw new Error(error.message);
        }
        return { id, audioPath, wavPath };
      } catch (e) {
        const cleaned = await removeAll(attempted);
        throw new RecordingSaveError(msg(e), cleaned, cleaned ? [] : attempted);
      }
    },

    /**
     * Delete the recording from a handoff: clear the DB reference FIRST (so the handoff never points at a missing
     * file), then remove the objects, tolerating ones that are already gone. If removal fails after retries the
     * reference is already cleared; the leftover objects are unreferenced orphans (`filesRemoved: false`).
     */
    async deleteHandoffRecording(h: {
      id: string;
      audio_path: string | null;
      audio_wav_path: string | null;
    }) {
      const paths = [h.audio_path, h.audio_wav_path].filter((p): p is string => !!p);
      if (paths.length === 0) return { filesRemoved: true };
      const { error } = await deps.db.clearRecording(h.id);
      if (error) throw new Error(`Couldn't remove the recording: ${error.message}`);
      return { filesRemoved: await removeAll(paths) };
    },

    /**
     * Short-lived signed URL for playback or download. Created under the signed-in user's own session, so the
     * database's storage RLS decides (the same rule for playing and downloading). `expectFamilyId` is a client-side
     * guard against ever asking for another family's path.
     */
    async getPlaybackUrl(
      path: string,
      opts: { expectFamilyId?: string; download?: string; ttlSeconds?: number } = {},
    ) {
      if (opts.expectFamilyId && !path.startsWith(`${opts.expectFamilyId}/`))
        throw new Error("That recording belongs to a different family.");
      const ttl = Math.min(opts.ttlSeconds ?? SIGNED_URL_TTL_SECONDS, SIGNED_URL_MAX_TTL_SECONDS);
      const { data, error } = await deps.storage.createSignedUrl(
        path,
        ttl,
        opts.download ? { download: opts.download } : undefined,
      );
      if (error || !data?.signedUrl)
        throw new Error(error?.message ?? "Couldn't open the recording.");
      return data.signedUrl;
    },
  };
}

// ---- Supabase wiring ----
const bucket = () => supabase.storage.from(RECORDINGS_BUCKET);

export const recordingService = createRecordingService({
  storage: {
    upload: async (path, body, opts) => ({
      error: (await bucket().upload(path, body, opts)).error,
    }),
    remove: async (paths) => ({ error: (await bucket().remove(paths)).error }),
    createSignedUrl: async (path, expiresIn, opts) => {
      const { data, error } = await bucket().createSignedUrl(path, expiresIn, opts);
      return { data: data ? { signedUrl: data.signedUrl } : null, error };
    },
  },
  db: {
    insertHandoff: async (row) => ({ error: (await supabase.from("handoff").insert(row)).error }),
    handoffExists: async (id) =>
      !!(await supabase.from("handoff").select("id").eq("id", id).maybeSingle()).data,
    clearRecording: async (id) => ({
      error: (
        await supabase
          .from("handoff")
          .update({
            audio_path: null,
            audio_mime: null,
            audio_size_bytes: null,
            audio_wav_path: null,
            audio_wav_mime: null,
            audio_wav_size_bytes: null,
            duration_seconds: null,
          })
          .eq("id", id)
      ).error,
    }),
  },
});
