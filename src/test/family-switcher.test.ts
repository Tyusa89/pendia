import { describe, it, expect, vi, beforeEach } from "vitest";

const rows = [
  { family_id: "morales", family: { id: "morales", name: "Morales Family" } },
  { family_id: "demo", family: { id: "demo", name: "Pendia Hackathon — Fictional Demo Family" } },
];
vi.mock("@/integrations/supabase/client", () => {
  const q: any = { select: () => q, eq: () => q, order: () => Promise.resolve({ data: rows, error: null }) };
  return { supabase: { from: () => q, auth: { getUser: async () => ({ data: { user: { id: "u1" } } }), getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) } } };
});

import { familyService } from "@/services";

describe("family switcher", () => {
  beforeEach(() => localStorage.clear());
  it("defaults to the first membership (Morales)", async () => {
    expect((await familyService.getMyFamily())?.family.id).toBe("morales");
  });
  it("uses the selected family after switching", async () => {
    await familyService.setActiveFamily("demo");
    expect((await familyService.getMyFamily())?.family.id).toBe("demo");
  });
  it("ignores a stored family the user no longer belongs to", async () => {
    localStorage.setItem("pendia.activeFamily.u1", "other");
    expect((await familyService.getMyFamily())?.family.id).toBe("morales");
  });
  it("lists only membership families", async () => {
    expect((await familyService.listMyFamilies()).map((f) => f.id)).toEqual(["morales", "demo"]);
  });
});
