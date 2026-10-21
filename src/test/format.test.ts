import { describe, expect, it } from "vitest";
import { formatTimestamp, normalizePhone } from "@/lib/format";

describe("formatTimestamp", () => {
  it("formats seconds as m:ss", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(65.9)).toBe("1:05");
    expect(formatTimestamp(3725)).toBe("1:02:05");
  });
  it("returns a dash for missing or invalid input", () => {
    expect(formatTimestamp(null)).toBe("—");
    expect(formatTimestamp(-1)).toBe("—");
    expect(formatTimestamp(NaN)).toBe("—");
  });
});

describe("normalizePhone", () => {
  it("normalises US numbers to E.164", () => {
    expect(normalizePhone("(212) 555-0102")).toBe("+12125550102");
    expect(normalizePhone("1 212 555 0102")).toBe("+12125550102");
    expect(normalizePhone("+34 600 000 000")).toBe("+34600000000");
  });
  it("rejects numbers that cannot be valid", () => {
    expect(normalizePhone("555-0102")).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
  });
  it("treats blank as no phone", () => {
    expect(normalizePhone("  ")).toBeNull();
  });
});
