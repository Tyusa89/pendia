// @vitest-environment node
// Regression tests for the availability reliability fix: a failed lookup is never a confident "no", and the page states are derived
// from definite answers only. Offline; nothing here can reach Meta, and no audio is involved.
import { describe, expect, it, vi } from "vitest";
import { messageForCode } from "@/lib/meta-transcribe/client";
import { memberIsOrganizer } from "@/lib/meta-transcribe/transcribe.functions";
import {
  STATUS_RETRY_DELAYS_MS,
  deriveTranscriberState,
  type StatusSnapshot,
} from "@/lib/meta-transcribe/status";
import { transcriptionStatus } from "@/server/meta-transcribe.server";
import { CANARY_KEY, ENV_ON, FAMILY } from "./meta-transcribe-helpers";

describe("transcriptionStatus (server)", () => {
  const yes = vi.fn(async () => true);
  it("is disabled, and does not even look the user up, when the flag or the key is missing", async () => {
    for (const env of [
      {},
      { META_TRANSCRIBE_ENABLED: "true" },
      { META_API_KEY: CANARY_KEY },
      { META_TRANSCRIBE_ENABLED: "yes", META_API_KEY: CANARY_KEY },
    ]) {
      expect(await transcriptionStatus({ env, familyId: FAMILY, isOrganizer: yes })).toEqual({
        available: false,
        reason: "disabled",
      });
    }
    expect(yes).not.toHaveBeenCalled();
  });
  it("organizer -> available; a definite non-organizer -> not_organizer", async () => {
    expect(
      await transcriptionStatus({ env: ENV_ON, familyId: FAMILY, isOrganizer: async () => true }),
    ).toEqual({ available: true });
    expect(
      await transcriptionStatus({ env: ENV_ON, familyId: FAMILY, isOrganizer: async () => false }),
    ).toEqual({
      available: false,
      reason: "not_organizer",
    });
  });
  it("a FAILED lookup is check_failed: never not_organizer, never disabled, never available", async () => {
    const r = await transcriptionStatus({
      env: ENV_ON,
      familyId: FAMILY,
      isOrganizer: async () => {
        throw new Error("upstream 503");
      },
    });
    expect(r).toEqual({ available: false, reason: "check_failed" });
  });
  it("passes the requested family id to the lookup and puts no secret or error text in any answer", async () => {
    const seen = vi.fn(async () => true);
    const answers = [
      await transcriptionStatus({ env: ENV_ON, familyId: FAMILY, isOrganizer: seen }),
      await transcriptionStatus({
        env: ENV_ON,
        familyId: FAMILY,
        isOrganizer: async () => {
          throw new Error(`boom ${CANARY_KEY}`);
        },
      }),
    ];
    expect(seen).toHaveBeenCalledWith(FAMILY);
    expect(JSON.stringify(answers)).not.toContain(CANARY_KEY);
  });
});

describe("memberIsOrganizer (the lookup shared by both server functions)", () => {
  const client = (result: { data: { role: string } | null; error: unknown }) => {
    const calls: Array<[string, string]> = [];
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: (k: string, v: string) => (calls.push([k, v]), b),
      maybeSingle: async () => result,
    });
    return { c: { from: () => b } as never, calls };
  };
  it("true for an organizer, looked up by BOTH family id and the caller's own user id", async () => {
    const { c, calls } = client({ data: { role: "organizer" }, error: null });
    expect(await memberIsOrganizer(c, "user-1", FAMILY)).toBe(true);
    expect(calls).toEqual([
      ["family_id", FAMILY],
      ["user_id", "user-1"],
    ]);
  });
  it("false for a plain member and for no row at all (definite answers)", async () => {
    expect(
      await memberIsOrganizer(client({ data: { role: "member" }, error: null }).c, "u", FAMILY),
    ).toBe(false);
    expect(await memberIsOrganizer(client({ data: null, error: null }).c, "u", FAMILY)).toBe(false);
  });
  it("THROWS when the database reports an error, even though data is null (the old code answered false here)", async () => {
    const { c } = client({ data: null, error: { message: "timeout / 401 / 5xx" } });
    await expect(memberIsOrganizer(c, "u", FAMILY)).rejects.toThrow("member_lookup_failed");
  });
});

describe("page state derivation", () => {
  const s = (over: Partial<StatusSnapshot>): StatusSnapshot => ({
    data: undefined,
    isFetching: false,
    isError: false,
    ...over,
  });
  it.each([
    ["nothing yet", s({}), "loading"],
    ["first request in flight", s({ isFetching: true }), "loading"],
    ["a definite yes", s({ data: { available: true } }), "available"],
    ["a definite 'disabled'", s({ data: { available: false, reason: "disabled" } }), "disabled"],
    ["the old shape {available:false}", s({ data: { available: false } }), "disabled"],
    [
      "a definite 'not organizer'",
      s({ data: { available: false, reason: "not_organizer" } }),
      "not_organizer",
    ],
    ["no answer and the check failed", s({ isError: true }), "error"],
    [
      "a re-check of a negative answer",
      s({ data: { available: false, reason: "disabled" }, isFetching: true }),
      "loading",
    ],
    ["retrying after errors", s({ isError: true, isFetching: true }), "loading"],
  ] as const)("%s -> %s", (_n, snap, expected) => {
    expect(deriveTranscriberState(snap)).toBe(expected);
  });
  it("a confirmed yes survives a re-check in flight and a temporary error", () => {
    expect(deriveTranscriberState(s({ data: { available: true }, isFetching: true }))).toBe(
      "available",
    );
    expect(deriveTranscriberState(s({ data: { available: true }, isError: true }))).toBe(
      "available",
    );
  });
  it("retries are bounded and short", () => {
    expect(STATUS_RETRY_DELAYS_MS.length).toBe(2);
    expect(STATUS_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(2000);
  });
});

describe("a transcription attempt that cannot confirm access", () => {
  it("shows a retryable message, not 'Only the family organizer'", () => {
    expect(messageForCode("check_failed")).toMatch(/try again/i);
    expect(messageForCode("check_failed")).not.toMatch(/Only the family organizer/i);
    expect(messageForCode("forbidden")).toMatch(/Only the family organizer/i);
  });
});
