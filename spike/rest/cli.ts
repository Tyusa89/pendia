// One-shot REST transcription test for Meta Voice Transcribe. Run with Node 22.18+ (type stripping) or Bun:
//   node spike/rest/cli.ts generate [--out spike-output/rest-synthetic.wav]   build the synthetic WAV + timings (offline, ffmpeg)
//   node spike/rest/cli.ts check    --wav f.wav                              validate the audio (offline)
//   node spike/rest/cli.ts plan     --wav f.wav                              print the redacted request (offline, sends nothing)
//   node spike/rest/cli.ts run      --wav f.wav [--timings t.json] --live --confirm-one-call
//                                                                              THE ONE LIVE CALL. Refuses unless
//                                                                              SPIKE_ALLOW_LIVE=I_HAVE_APPROVAL is set.
// Nothing in package.json's test, build or lint scripts runs this file. It is DISABLED BY DEFAULT.
import { readFileSync, writeFileSync } from "node:fs";
import { safeOutputPath } from "../diarization/output.ts";
import { parseScript } from "../diarization/groundtruth.ts";
import {
  APPROVAL_TOKEN,
  LOCK_NAME,
  RAW_BODY_NAME,
  RAW_META_NAME,
  RestSpikeError,
  SCORECARD_NAME,
} from "./config.ts";
import type { RawInfo } from "./raw.ts";
import { describeRequest } from "./request.ts";
import { observedShape, parseTranscribeResponse } from "./response.ts";
import { sanitize, transcribeOnce } from "./run.ts";
import { buildScorecard } from "./scorecard.ts";
import { generateConversation } from "./synth.ts";
import { validateWavForUpload } from "./wav-check.ts";

const SCRIPT = new URL("../../fixtures/spike/two-voice-script.md", import.meta.url);
const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const truth = () => parseScript(readFileSync(SCRIPT, "utf8"));
const readWav = () => {
  const p = flag("wav");
  if (!p) throw new RestSpikeError("usage", "--wav <file> is required.");
  return new Uint8Array(readFileSync(p));
};

async function main(): Promise<number> {
  if (cmd === "generate") {
    const out = safeOutputPath(flag("out"), "rest-synthetic.wav");
    const g = await generateConversation(truth());
    const info = validateWavForUpload(g.wav);
    writeFileSync(out, g.wav, { mode: 0o600 });
    writeFileSync(out.replace(/\.wav$/, ".timings.json"), JSON.stringify(g.timings), {
      mode: 0o600,
    });
    console.log(
      `Wrote ${out} (${info.seconds.toFixed(1)} s, ${info.bytes} bytes, ${info.sampleRate} Hz) and its timings file. Synthetic voices only.`,
    );
    return 0;
  }
  if (cmd === "check") {
    const i = validateWavForUpload(readWav());
    console.log(
      `OK: mono 16-bit PCM, ${i.sampleRate} Hz, ${i.seconds.toFixed(1)} s, ${i.bytes} bytes.`,
    );
    return 0;
  }
  if (cmd === "plan") {
    const wav = readWav();
    validateWavForUpload(wav);
    console.log(JSON.stringify(describeRequest(wav.byteLength), null, 2));
    console.log("Plan only: nothing was sent. The credential is never printed.");
    return 0;
  }
  if (cmd === "run") {
    if (!args.includes("--live")) {
      console.log(
        `Disabled: live runs need --live --confirm-one-call and SPIKE_ALLOW_LIVE=${APPROVAL_TOKEN}. Nothing was sent.`,
      );
      return 2;
    }
    const wav = readWav();
    const timingsPath = flag("timings");
    const timings = timingsPath
      ? (JSON.parse(readFileSync(timingsPath, "utf8")) as Record<string, [number, number]>)
      : undefined;
    const lockPath = safeOutputPath(undefined, LOCK_NAME);
    const scorePath = safeOutputPath(undefined, SCORECARD_NAME);
    const rawPaths = {
      body: safeOutputPath(undefined, RAW_BODY_NAME),
      meta: safeOutputPath(undefined, RAW_META_NAME),
    };
    let rawInfo: RawInfo | null = null;
    const key = process.env["META_API_KEY"] ?? "";
    let card;
    try {
      const r = await transcribeOnce({
        wav,
        env: process.env,
        confirmOneCall: args.includes("--confirm-one-call"),
        fetchImpl: (url, init) => fetch(url, init),
        lockPath,
        rawPaths,
        onRaw: (i) => {
          rawInfo = i;
        },
      });
      const observed = observedShape(r.json);
      let segments = null;
      let reportedAudioSeconds: number | null = null;
      let parseErrorCode: string | null = null;
      try {
        const parsed = parseTranscribeResponse(r.json);
        segments = parsed.segments;
        reportedAudioSeconds = parsed.reportedAudioSeconds;
      } catch (e) {
        parseErrorCode = e instanceof RestSpikeError ? e.code : "malformed_response";
      }
      card = buildScorecard({
        live: true,
        audio: r.audio,
        http: { status: r.status, elapsedMs: r.elapsedMs },
        segments,
        parseErrorCode,
        reportedAudioSeconds,
        raw: rawInfo,
        observed,
        truth: truth(),
        ...(timings ? { timings } : {}),
      });
    } catch (e) {
      const err = e instanceof RestSpikeError ? e : new RestSpikeError("failed", "The run failed.");
      console.error(`Error [${err.code}]: ${sanitize(err.message, key)}`);
      card = buildScorecard({
        live: true,
        audio: null,
        http: { status: err.status, elapsedMs: null },
        segments: null,
        parseErrorCode: err.code,
        raw: rawInfo,
        observed: { top: [], turn: [] },
        truth: truth(),
        notes: ["The request did not produce a scorable reply."],
      });
    }
    const r = rawInfo as RawInfo | null;
    console.error(
      r
        ? r.saved
          ? `Raw reply saved (status ${r.status ?? "none"}, ${r.bytesSaved} bytes) to ${r.bodyFile ?? "(no body)"} and ${r.metaFile}. Not printed.`
          : `Raw reply could NOT be saved (${r.error ?? "unknown"}).`
        : "No reply arrived, so there is no raw reply to save.",
    );
    writeFileSync(scorePath, JSON.stringify(card, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(card, null, 2));
    return card.score.pass ? 0 : 1;
  }
  console.error(
    "Usage: cli.ts generate | check --wav f | plan --wav f | run --wav f [--timings t.json] --live --confirm-one-call",
  );
  return 2;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    const key = process.env["META_API_KEY"] ?? "";
    console.error(`Error: ${sanitize(e instanceof Error ? e.message : String(e), key)}`);
    process.exit(2);
  },
);
