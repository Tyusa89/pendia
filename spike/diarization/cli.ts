// Offline-first command line for the diarization spike. Run with Node 22 (type stripping) or Bun:
//   node spike/diarization/cli.ts <command> ...
// Commands: plan | simulate | inspect | score | capture
//   plan                     print what a live run would send (key redacted). Connects to nothing.
//   simulate --scenario S    run the whole pipeline against the LOCAL simulator (loopback only)
//   inspect <capture.jsonl>  show every event type / key path the server actually sent
//   score <capture.jsonl>    score a capture against fixtures/spike/two-voice-script.md; exit 1 on FAIL
//   capture --wav f.wav      LIVE run against api.meta.ai. Refuses unless SPIKE_ALLOW_LIVE=I_HAVE_APPROVAL.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { safeOutputPath } from "./output.ts";
import { newSessionId, scrubSecret } from "./protocol.ts";
import { fromJsonl, runRealtimeCapture, toJsonl } from "./capture.ts";
import { extractSegments, inspectCapture, type AdapterConfig } from "./events.ts";
import { parseScript } from "./groundtruth.ts";
import { ENDPOINT, FRAME_BYTES, buildHandshake, redactHandshake } from "./protocol.ts";
import { formatReport, scoreSegments } from "./score.ts";
import { startSimulator, type Scenario, type Shape } from "./simulator.ts";
import { makeToneWav, parseWav } from "./wav.ts";

const SCRIPT = new URL("../../fixtures/spike/two-voice-script.md", import.meta.url);
const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const showText = args.includes("--show-text");

const writeSecret = (path: string, data: string) => writeFileSync(path, data, { mode: 0o600 });
const truth = () => parseScript(readFileSync(SCRIPT, "utf8"));

function scoreFile(path: string) {
  const cap = fromJsonl(readFileSync(path, "utf8"));
  const cfgPath = flag("adapter");
  const cfg: AdapterConfig = cfgPath ? JSON.parse(readFileSync(cfgPath, "utf8")) : {};
  const timingsPath = flag("timings");
  const timings = timingsPath
    ? (JSON.parse(readFileSync(timingsPath, "utf8")) as Record<string, [number, number]>)
    : undefined;
  const ex = extractSegments(cap, cfg);
  console.log(
    `Adapter: ${ex.strategy ?? "none"}${ex.notes.length ? ` (${ex.notes.join(" ")})` : ""}`,
  );
  const r = scoreSegments(ex.segments, truth(), timings);
  console.log(formatReport(r));
  return r.verdict.pass;
}

async function main() {
  if (cmd === "plan") {
    const h = redactHandshake(
      buildHandshake({
        apiKey: "placeholder",
        languageBias: ["English"],
        keywords: ["Lisinopril"],
      }),
    );
    console.log(
      `Endpoint: ${ENDPOINT}?sessionId=<uuid4>\nFirst text frame (within 10 s):\n${JSON.stringify(h, null, 2)}\nThen binary frames of ${FRAME_BYTES} bytes every 80 ms (real time), then {"type":"endStream"}, then read until the server closes.\nNothing was sent. No connection was made.`,
    );
  } else if (cmd === "simulate") {
    const scenario = (flag("scenario") ?? "perfect") as Scenario;
    const shape = (flag("shape") ?? "combined") as Shape;
    const sim = await startSimulator({ scenario, shape, script: truth() });
    try {
      const wavPath = flag("wav");
      const wav = wavPath ? parseWav(readFileSync(wavPath)).data : parseWav(makeToneWav(2)).data;
      const cap = await runRealtimeCapture({
        url: sim.url,
        apiKey: "simulator-key",
        pcm: wav,
        paceMultiplier: Number(flag("pace") ?? 20),
        keywords: ["Lisinopril"],
        languageBias: ["English"],
        closeWaitMs: 5000,
      });
      const out = flag("out");
      if (out) writeSecret(safeOutputPath(out, "simulate.jsonl"), toJsonl(cap));
      console.log(inspectCapture(cap, { showText }));
      const ex = extractSegments(cap);
      console.log("\n" + formatReport(scoreSegments(ex.segments, truth())));
    } finally {
      await sim.close();
    }
  } else if (cmd === "inspect") {
    console.log(inspectCapture(fromJsonl(readFileSync(args[1]!, "utf8")), { showText }));
  } else if (cmd === "score") {
    process.exit(scoreFile(args[1]!) ? 0 : 1);
  } else if (cmd === "capture") {
    const apiKey = process.env["META_API_KEY"];
    if (!apiKey) throw new Error("META_API_KEY is not set (it must only ever exist server-side).");
    // Decide where the output goes BEFORE connecting, so a bad path fails before anything is sent.
    const sessionId = newSessionId();
    const out = safeOutputPath(flag("out"), `capture-${sessionId}.jsonl`);
    const wav = parseWav(readFileSync(flag("wav") ?? ""));
    console.log(
      `Audio: ${wav.durationS.toFixed(1)} s. Starting capture to ${flag("url") ?? ENDPOINT} ...`,
    );
    const cap = await runRealtimeCapture({
      url: flag("url") ?? ENDPOINT,
      apiKey,
      pcm: wav.data,
      keywords: ["Lisinopril"],
      languageBias: ["English"],
      liveApproval: process.env["SPIKE_ALLOW_LIVE"],
      sessionId,
    });
    writeSecret(out, toJsonl(cap));
    console.log(
      `Saved ${out} (key scrubbed, owner-only, git-ignored). Close: ${cap.meta.close.code} ${cap.meta.close.meaning}`,
    );
    // Structure only: transcript text is not printed (it would land in terminal history or CI logs).
    console.log(inspectCapture(cap, { showText: false }));
  } else {
    console.log(
      "Usage: cli.ts plan | simulate [--scenario S] [--shape combined|nested|split] | inspect <file> | score <file> [--adapter a.json] [--timings t.json] | capture --wav f.wav [--out spike-output/f.jsonl]  (--show-text on inspect/simulate prints transcript text; local only)",
    );
    process.exit(cmd ? 2 : 0);
  }
}
main().catch((e) => {
  console.error(`Error: ${scrubSecret((e as Error).message, process.env["META_API_KEY"] ?? "")}`);
  process.exit(1);
});
