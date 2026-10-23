// Raw response preservation. The reply is read and written to disk BEFORE anything checks the status, parses JSON or
// scores it, so a surprising reply from the one paid request can always be examined afterwards.
//
// What is kept: the HTTP status, an allowlist of harmless response headers, and the body exactly as received (bytes, not
// decoded text). What is never kept: any request header, the Authorization value, cookies, or any other response header.
// If the body happens to contain the API key it is replaced by `***` and that is recorded (both hashes are kept), because
// the credential must not reach disk even by echo. Nothing is truncated silently: if a reply exceeds the hard ceiling the
// saved body is cut AND `truncated` is recorded in the metadata and the scorecard.
// This module makes no network request; run.ts makes the only one.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { ALLOWED_HOST } from "./config.ts";

/** The only response headers written to disk. Anything else (set-cookie, request ids, tokens...) is dropped. */
export const HEADER_ALLOWLIST = [
  "content-type",
  "content-length",
  "content-encoding",
  "date",
] as const;

export interface RawInfo {
  saved: boolean;
  /** a fixed code when something went wrong while saving; never a message that could echo content */
  error: string | null;
  bodyFile: string | null;
  metaFile: string | null;
  status: number | null;
  bytesReceived: number;
  bytesSaved: number;
  truncated: boolean;
  keyRedactions: number;
  sha256Original: string | null;
  sha256Saved: string | null;
}

export const NOT_SAVED: RawInfo = Object.freeze({
  saved: false,
  error: null,
  bodyFile: null,
  metaFile: null,
  status: null,
  bytesReceived: 0,
  bytesSaved: 0,
  truncated: false,
  keyRedactions: 0,
  sha256Original: null,
  sha256Saved: null,
});

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** Reads the body as bytes up to `limit`; a longer body is cut and reported, never silently. Stream errors keep what arrived. */
export async function readBounded(
  res: Response,
  limit: number,
): Promise<{ bytes: Uint8Array; truncated: boolean; readError: boolean }> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  let readError = false;
  if (res.body) {
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (total + value.length > limit) {
          const room = limit - total;
          if (room > 0) chunks.push(value.subarray(0, room));
          total += Math.max(room, 0);
          truncated = true;
          await reader.cancel().catch(() => undefined);
          break;
        }
        chunks.push(value);
        total += value.length;
      }
    } catch {
      readError = true;
    }
  }
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    bytes.set(c, off);
    off += c.length;
  }
  return { bytes, truncated, readError };
}

/** Replaces every occurrence of the key's bytes with `***`. Returns the new bytes and how many were replaced. */
export function redactKey(bytes: Uint8Array, key: string): { bytes: Uint8Array; count: number } {
  const needle = Buffer.from(key, "utf8");
  if (needle.length === 0) return { bytes, count: 0 };
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Buffer[] = [];
  let from = 0;
  let count = 0;
  for (;;) {
    const at = buf.indexOf(needle, from);
    if (at < 0) break;
    parts.push(buf.subarray(from, at), Buffer.from("***"));
    from = at + needle.length;
    count++;
  }
  if (count === 0) return { bytes, count: 0 };
  parts.push(buf.subarray(from));
  return { bytes: new Uint8Array(Buffer.concat(parts)), count };
}

function allowlisted(headers: Headers | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const name of HEADER_ALLOWLIST) {
    const v = headers.get(name);
    // header values are short and harmless, but a value that contains the key is dropped like any other echo
    if (v !== null) out[name] = v.slice(0, 200);
  }
  return out;
}

/**
 * Writes `<body>` and `<meta>` (exclusive create, owner-only, never overwriting earlier evidence). `bytes === null` means no
 * reply arrived (timeout, network error): only the metadata is written, with the fixed `outcome` code.
 * Never throws: a failure is reported as `saved: false` with a fixed code, so it can never hide the result of the call.
 */
export function saveRaw(input: {
  bodyPath: string;
  metaPath: string;
  key: string;
  status: number | null;
  ok: boolean | null;
  headers?: Headers;
  bytes: Uint8Array | null;
  truncated: boolean;
  readError: boolean;
  elapsedMs: number | null;
  outcome: string;
  now?: () => Date;
}): RawInfo {
  const received = input.bytes ? input.bytes.length : 0;
  const original = input.bytes ? sha256(input.bytes) : null;
  const red = input.bytes
    ? redactKey(input.bytes, input.key)
    : { bytes: new Uint8Array(0), count: 0 };
  const saved = input.bytes ? red.bytes : null;
  const info: RawInfo = {
    saved: false,
    error: null,
    bodyFile: input.bytes ? basename(input.bodyPath) : null,
    metaFile: basename(input.metaPath),
    status: input.status,
    bytesReceived: received,
    bytesSaved: saved ? saved.length : 0,
    truncated: input.truncated,
    keyRedactions: red.count,
    sha256Original: original,
    sha256Saved: saved ? sha256(saved) : null,
  };
  const meta = {
    schema: 1,
    kind: "meta-rest-raw-response-meta",
    capturedAt: (input.now ?? (() => new Date()))().toISOString(),
    host: ALLOWED_HOST,
    outcome: input.outcome,
    status: input.status,
    ok: input.ok,
    headers: allowlisted(input.headers),
    body: input.bytes
      ? {
          file: info.bodyFile,
          bytesReceived: received,
          bytesSaved: info.bytesSaved,
          truncated: input.truncated,
          readError: input.readError,
          keyRedactions: red.count,
          sha256Original: original,
          sha256Saved: info.sha256Saved,
        }
      : null,
    elapsedMs: input.elapsedMs,
    note: "Body bytes are exactly as received unless keyRedactions > 0 or truncated is true. No request header is stored.",
  };
  try {
    mkdirSync(dirname(input.metaPath), { recursive: true, mode: 0o700 });
  } catch {
    info.error = "raw_write_failed";
    return info;
  }
  try {
    // body first, then metadata: metadata present means the body write has been attempted
    if (saved) writeFileSync(input.bodyPath, saved, { flag: "wx", mode: 0o600 });
    writeFileSync(input.metaPath, JSON.stringify(meta, null, 2), { flag: "wx", mode: 0o600 });
    info.saved = true;
  } catch (e) {
    // EEXIST here can only come from the exclusive create: earlier evidence is kept, never overwritten
    info.error =
      (e as { code?: string } | null)?.code === "EEXIST" ? "raw_exists" : "raw_write_failed";
  }
  return info;
}
