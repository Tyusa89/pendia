import { describe, expect, it } from "vitest";
import { oauthReturnPath } from "@/lib/oauth-return-path";

describe("OAuth sign-in return boundary", () => {
  it("preserves consent authorization and fragment", () => {
    expect(oauthReturnPath("/.lovable/oauth/consent?authorization_id=abc#review")).toBe("/.lovable/oauth/consent?authorization_id=abc#review");
  });
  it.each(["https://outside.invalid", "//outside.invalid", "/\\outside.invalid", "/\n/evil", null])("rejects external or unsafe target %s", value => {
    expect(oauthReturnPath(value)).toBe("/");
  });
  it("canonicalizes without a second decoding", () => {
    expect(oauthReturnPath("/a/../auth?next=%2Ffamily")).toBe("/auth?next=%2Ffamily");
  });
});