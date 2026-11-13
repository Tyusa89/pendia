// Server-side invitation sending and the pure invitation helpers. No network: Supabase and the magic-link sender are fakes.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createErrorCode,
  inviteRedirect,
  sendFamilyInvite,
  type MagicLinkSender,
} from "@/server/family-invite.server";
import {
  acceptErrorMessage,
  inviteStatus,
  latestInviteByMember,
  looksLikeEmail,
} from "@/lib/invitations";

const MEMBER = "22222222-2222-4222-8222-222222222222";
const INVITE = "33333333-3333-4333-8333-333333333333";

function fakeSupabase(
  over: {
    create?: { data: string | null; error: { code?: string; message?: string } | null };
  } = {},
) {
  const calls: Array<[string, unknown]> = [];
  const supabase = {
    rpc: async (name: string, args: unknown) => {
      calls.push([name, args]);
      if (name === "create_family_invite") return over.create ?? { data: INVITE, error: null };
      return { data: null, error: null };
    },
  };
  return { supabase: supabase as never, calls };
}
const okSender: MagicLinkSender = vi.fn(async () => ({ ok: true }));
const spies = () => [
  vi.spyOn(console, "log"),
  vi.spyOn(console, "error"),
  vi.spyOn(console, "warn"),
  vi.spyOn(console, "info"),
];
afterEach(() => vi.restoreAllMocks());

describe("sendFamilyInvite", () => {
  it("creates the invitation as the organizer, emails a magic link to the lower-cased address, then records 'sent'", async () => {
    const f = fakeSupabase();
    const sender = vi.fn(async () => ({ ok: true }));
    const r = await sendFamilyInvite({
      supabase: f.supabase,
      memberId: MEMBER,
      email: "  Person@Example.COM ",
      origin: "https://pendia.test",
      sendMagicLink: sender,
    });
    expect(r).toEqual({ code: "sent", inviteId: INVITE });
    expect(f.calls[0]).toEqual([
      "create_family_invite",
      { _member_id: MEMBER, _email: "person@example.com" },
    ]);
    expect(sender).toHaveBeenCalledWith("person@example.com", "https://pendia.test/invite");
    expect(f.calls[1]).toEqual([
      "set_family_invite_delivery",
      { _invite_id: INVITE, _status: "sent" },
    ]);
  });
  it("an email failure is recorded as 'failed' and reported as a fixed code; the invitation still exists for Resend", async () => {
    const f = fakeSupabase();
    const r = await sendFamilyInvite({
      supabase: f.supabase,
      memberId: MEMBER,
      email: "p@example.com",
      origin: "https://pendia.test",
      sendMagicLink: async () => ({ ok: false, status: 429 }),
    });
    expect(r).toEqual({ code: "email_failed", inviteId: INVITE });
    expect(f.calls[1]).toEqual([
      "set_family_invite_delivery",
      { _invite_id: INVITE, _status: "failed" },
    ]);
  });
  it("a sender that throws is treated as a delivery failure, not an unhandled error", async () => {
    const f = fakeSupabase();
    const r = await sendFamilyInvite({
      supabase: f.supabase,
      memberId: MEMBER,
      email: "p@example.com",
      origin: "https://pendia.test",
      sendMagicLink: async () => {
        throw new Error("boom p@example.com");
      },
    });
    expect(r.code).toBe("email_failed");
  });
  it.each([
    [{ code: "42501", message: "Only an organizer can invite people." }, "not_organizer"],
    [{ code: "23514", message: "Enter a valid email address." }, "invalid_email"],
    [
      { code: "23514", message: "That email already belongs to someone in this family." },
      "already_member",
    ],
    [{ code: "P0001", message: "invite_too_soon" }, "too_soon"],
    [{ code: "XX000", message: "internal detail with p@example.com" }, "failed"],
  ] as const)(
    "a refused creation (%j) never sends an email and returns %s",
    async (error, code) => {
      const f = fakeSupabase({ create: { data: null, error } });
      const sender = vi.fn(async () => ({ ok: true }));
      const r = await sendFamilyInvite({
        supabase: f.supabase,
        memberId: MEMBER,
        email: "p@example.com",
        origin: "https://pendia.test",
        sendMagicLink: sender,
      });
      expect(r).toEqual({ code });
      expect(sender).not.toHaveBeenCalled();
      expect(f.calls).toHaveLength(1);
    },
  );
  it("rejects a malformed address and an unsafe origin before touching the database", async () => {
    const f = fakeSupabase();
    expect(
      (
        await sendFamilyInvite({
          supabase: f.supabase,
          memberId: MEMBER,
          email: "nope",
          origin: "https://pendia.test",
          sendMagicLink: okSender,
        })
      ).code,
    ).toBe("invalid_email");
    expect(
      (
        await sendFamilyInvite({
          supabase: f.supabase,
          memberId: MEMBER,
          email: "p@example.com",
          origin: "http://evil.test",
          sendMagicLink: okSender,
        })
      ).code,
    ).toBe("failed");
    expect(f.calls).toHaveLength(0);
    expect(inviteRedirect("http://localhost:5173")).toBe("http://localhost:5173/invite");
    expect(inviteRedirect("not a url")).toBeNull();
  });
  it("writes nothing to the console, whatever happens (addresses and links never reach logs)", async () => {
    const logs = spies();
    for (const sender of [
      okSender,
      async () => ({ ok: false }),
      async () => {
        throw new Error("p@example.com https://x/#access_token=abc");
      },
    ] as MagicLinkSender[])
      await sendFamilyInvite({
        supabase: fakeSupabase().supabase,
        memberId: MEMBER,
        email: "p@example.com",
        origin: "https://pendia.test",
        sendMagicLink: sender,
      });
    await sendFamilyInvite({
      supabase: fakeSupabase({
        create: { data: null, error: { code: "XX000", message: "p@example.com" } },
      }).supabase,
      memberId: MEMBER,
      email: "p@example.com",
      origin: "https://pendia.test",
      sendMagicLink: okSender,
    });
    for (const l of logs) expect(l).not.toHaveBeenCalled();
  });
  it("maps null and unknown errors to 'failed'", () => {
    expect(createErrorCode(null)).toBe("failed");
    expect(createErrorCode({})).toBe("failed");
  });
});

describe("the invitation code paths carry no tokens and no logging", () => {
  const read = (p: string) => readFileSync(p, "utf8").replace(/\/\/.*$/gm, "");
  it.each([
    "src/server/family-invite.server.ts",
    "src/lib/family-invite.functions.ts",
    "src/lib/invitations.ts",
  ])("%s", (file) => {
    const src = read(file);
    expect(src).not.toMatch(/console\./);
    expect(src).not.toMatch(
      /service[_-]?role|SERVICE_ROLE|generateLink|admin\.auth|token_hash|inviteToken/i,
    );
  });
  it("the sender uses the publishable key with no stored session, and never returns the provider's message", () => {
    const src = read("src/server/family-invite.server.ts");
    expect(src).toMatch(/persistSession: false/);
    expect(src).not.toMatch(/error\.message|error\?\.message/);
  });
});

describe("invitation helpers", () => {
  const base = {
    id: "i",
    family_id: "f",
    member_id: "m",
    invited_email: "a@b.co",
    created_at: "2026-11-01T00:00:00Z",
    expires_at: "2026-11-08T00:00:00Z",
    accepted_at: null,
    revoked_at: null,
    delivery_status: "sent",
    last_sent_at: null,
  };
  it("status: pending, expired, revoked, accepted", () => {
    const now = new Date("2026-11-05T00:00:00Z");
    expect(inviteStatus(base, now)).toBe("pending");
    expect(inviteStatus(base, new Date("2026-11-09T00:00:00Z"))).toBe("expired");
    expect(inviteStatus({ ...base, revoked_at: "2026-11-02T00:00:00Z" }, now)).toBe("revoked");
    expect(
      inviteStatus(
        { ...base, accepted_at: "2026-11-02T00:00:00Z" },
        new Date("2027-01-01T00:00:00Z"),
      ),
    ).toBe("accepted");
  });
  it("keeps the newest invitation per member", () => {
    const map = latestInviteByMember([
      base,
      { ...base, id: "new", created_at: "2026-11-03T00:00:00Z" },
      { ...base, id: "other", member_id: "m2" },
    ]);
    expect(map.get("m")?.id).toBe("new");
    expect(map.get("m2")?.id).toBe("other");
  });
  it("email check and accept messages", () => {
    expect(looksLikeEmail("a@b.co")).toBe(true);
    expect(looksLikeEmail("a b@c.co")).toBe(false);
    expect(acceptErrorMessage(new Error("invite_invalid"))).toMatch(/no longer valid/);
    expect(acceptErrorMessage(new Error("invite_email_unverified"))).toMatch(/Confirm your email/);
    expect(acceptErrorMessage(new Error("already_member"))).toMatch(/already a member/);
    expect(acceptErrorMessage(new Error("weird"))).toMatch(/couldn't accept/);
  });
});
