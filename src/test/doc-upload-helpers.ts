// Fixtures for Document Upload tests. Fictional data only; page "images" are just valid-looking headers.
import { docPath } from "@/lib/doc-upload/contract";
import type { DocExtractEnv, DocSource } from "@/server/doc-extract.server";

export const FAM_A = "11111111-1111-4111-8111-111111111111";
export const FAM_B = "22222222-2222-4222-8222-222222222222";
export const USER = "33333333-3333-4333-8333-333333333333";
export const DOC_ID = "44444444-4444-4444-8444-444444444444";
export const PATH_A = docPath(FAM_A, DOC_ID, "pdf");
export const PATH_B = docPath(FAM_B, DOC_ID, "pdf");
export const CANARY_KEY = "CANARY-DOC-KEY-do-not-leak-987654321";

export const ENV_LIVE: DocExtractEnv = {
  DOC_EXTRACT_ENABLED: "true",
  DOC_EXTRACT_USER_IDS: USER,
  META_API_KEY: CANARY_KEY,
};
export const ENV_SIM: DocExtractEnv = { DOC_EXTRACT_SIMULATED: "true" };

const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes, ...new Array(24).fill(0)));
export const JPEG_PAGE = { mime: "image/jpeg" as const, base64: b64([0xff, 0xd8, 0xff, 0xe0]) };
export const PNG_PAGE = {
  mime: "image/png" as const,
  base64: b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
};

export function source(
  over: Partial<DocSource> & { role?: string; isDemo?: boolean | null; readable?: boolean } = {},
): DocSource {
  return {
    getMember: over.getMember ?? (async () => ({ role: over.role ?? "organizer" })),
    getFamily:
      over.getFamily ??
      (async () => ({ is_demo: over.isDemo ?? true, timezone: "America/Chicago" })),
    canReadDocument: over.canReadDocument ?? (async () => over.readable ?? true),
  };
}

export const goodExtraction = {
  appointment_letter: true,
  date: { value: "2026-11-12", confidence: "clear", source_text: "November 12, 2026" },
  time: { value: "10:30", confidence: "clear", source_text: "10:30 AM" },
  provider: { value: "Dr. Alma Reyes", confidence: "clear", source_text: "Dr. Alma Reyes" },
  location: null,
  instructions: {
    value: "Bring your medication list.",
    confidence: "unclear",
    source_text: "bring list",
  },
};

export const providerReply = (content: unknown, status = 200) =>
  new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            role: "assistant",
            content: typeof content === "string" ? content : JSON.stringify(content),
          },
          finish_reason: "stop",
        },
      ],
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
export const mockFetch = (impl: () => Promise<Response> | Response) => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return impl();
  };
  return { fn, calls };
};
