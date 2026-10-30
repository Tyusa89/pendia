// Appointment-letter documents: a private bucket with family-scoped paths. Upload, short-lived signed links, removal and a sweep of
// abandoned uploads. Who may read or write is enforced by storage RLS in the database (supabase/migrations/*_appointment_documents.sql);
// this layer never trusts the UI for the family id in a path. A document is "pending" until a visit references it.
import { supabase } from "@/integrations/supabase/client";
import { assertDemoWritable } from "@/lib/judge-demo";
import {
  ABANDONED_AFTER_MS,
  DOC_BUCKET,
  DOC_MIME,
  docPath,
  docPathFamily,
  type DocKind,
} from "@/lib/doc-upload/contract";

/** Viewing links live 5 minutes (never more than 10) and are never stored. */
export const DOC_SIGNED_URL_TTL_SECONDS = 300;

type StoreError = { message: string } | null;
interface ListedEntry {
  name: string;
  id: string | null;
  created_at?: string | null;
}
export interface DocStorage {
  upload(
    path: string,
    body: Blob,
    opts: { contentType: string; upsert: false },
  ): Promise<{ error: StoreError }>;
  remove(paths: string[]): Promise<{ error: StoreError }>;
  createSignedUrl(
    path: string,
    expiresIn: number,
  ): Promise<{ data: { signedUrl: string } | null; error: StoreError }>;
  list(prefix: string): Promise<{ data: ListedEntry[] | null; error: StoreError }>;
}

const realStorage = (): DocStorage => {
  const b = supabase.storage.from(DOC_BUCKET);
  return {
    upload: (p, body, o) => b.upload(p, body, o),
    remove: (p) => b.remove(p),
    createSignedUrl: (p, s) => b.createSignedUrl(p, s),
    list: (prefix) => b.list(prefix, { limit: 100 }),
  };
};

export class DocumentUploadError extends Error {
  constructor(reason: string) {
    super(`Couldn't store the document: ${reason}. Nothing was saved.`);
    this.name = "DocumentUploadError";
  }
}

export function createDocumentService(
  storage: DocStorage = realStorage(),
  newId = () => crypto.randomUUID(),
) {
  return {
    /** Uploads one validated file under a fresh id in the family's folder. Returns the stored path. */
    async uploadPending(familyId: string, file: Blob, kind: DocKind): Promise<string> {
      assertDemoWritable(); // the read-only Judge Demo can never upload (storage rules also deny a zero-membership guest)
      const path = docPath(familyId, newId(), kind, (file as { name?: string }).name);
      const { error } = await storage.upload(path, file, {
        contentType: DOC_MIME[kind],
        upsert: false,
      });
      if (error) throw new DocumentUploadError("the upload failed");
      return path;
    },
    /** Best effort; returns false if the object could not be removed (it stays unattached and is swept later). */
    async remove(path: string): Promise<boolean> {
      if (!docPathFamily(path)) return false;
      const { error } = await storage.remove([path]);
      return !error;
    },
    async signedUrl(path: string): Promise<string> {
      if (!docPathFamily(path)) throw new Error("That document link isn't valid.");
      const { data, error } = await storage.createSignedUrl(path, DOC_SIGNED_URL_TTL_SECONDS);
      if (error || !data) throw new Error("Couldn't open the document.");
      return data.signedUrl;
    },
    /**
     * Removes this family's uploads older than 24 hours that no appointment references (cancelled tabs, crashes). Never touches a
     * referenced document, a recent upload (it may be in use) or another family's folder. Returns the paths it removed.
     */
    async sweepAbandoned(
      familyId: string,
      referenced: ReadonlySet<string>,
      now: number = Date.now(),
    ): Promise<string[]> {
      const root = `${familyId}/doc`;
      const dirs = await storage.list(root);
      if (dirs.error || !dirs.data) return [];
      const stale: string[] = [];
      for (const d of dirs.data) {
        const files = await storage.list(`${root}/${d.name}`);
        if (files.error || !files.data) continue;
        for (const f of files.data) {
          const path = `${root}/${d.name}/${f.name}`;
          const created = f.created_at ? Date.parse(f.created_at) : NaN;
          if (!docPathFamily(path) || docPathFamily(path) !== familyId.toLowerCase()) continue;
          if (referenced.has(path)) continue;
          if (!Number.isFinite(created) || now - created < ABANDONED_AFTER_MS) continue;
          stale.push(path);
        }
      }
      if (stale.length > 0) await storage.remove(stale);
      return stale;
    },
  };
}

export const documentService = createDocumentService();
