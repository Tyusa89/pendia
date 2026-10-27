// The ONLY input the transcription server functions accept: a family id and the recording's WAV bytes (base64). Isomorphic: zod only.
import { z } from "zod";
import { MAX_AUDIO_BYTES } from "./contract";

export const MAX_BASE64_CHARS = Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 8;

export const transcribeInputSchema = z
  .object({
    familyId: z.string().uuid(),
    audioBase64: z.string().min(1).max(MAX_BASE64_CHARS),
  })
  .strict();

export const statusInputSchema = z.object({ familyId: z.string().uuid() }).strict();
