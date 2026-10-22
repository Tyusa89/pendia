// Coverage service rules, with the data layer replaced by an in-memory client that enforces the same row-level rules as
// the database (organizer-only writes, family isolation). The real policies are proven in supabase/tests/shift-writes.test.sql.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake, supabase } from "./fake-supabase";

vi.mock("@/integrations/supabase/client", () => ({ supabase }));

import { ShiftValidationError } from "@/lib/shifts";
import { shiftService } from "@/services";

const A = "fam-a";
const B = "fam-b";
const t = (hhmm: string, day = "27") => `2026-10-${day}T${hhmm}:00Z`;
const seed = (over: Record<string, unknown>) => {
  const row = {
    id: `seed-${fake.tables.shift.length + 1}`,
    family_id: A,
    start: t("12:00"),
    end: t("18:00"),
    assigned_member_id: null,
    status: "open",
    created_at: "2026-10-01T00:00:00Z",
    ...over,
  };
  fake.tables.shift.push(row);
  return row;
};

beforeEach(() => fake.reset());

describe("organizer: create, edit, reassign, cancel", () => {
  it("creates an assigned shift (status claimed) and an open shift (status open)", async () => {
    const a = await shiftService.createShift(A, {
      start: t("12:00"),
      end: t("18:00"),
      assigned_member_id: "m-ana",
    });
    expect(a.shift).toMatchObject({ family_id: A, assigned_member_id: "m-ana", status: "claimed" });
    const o = await shiftService.createShift(A, {
      start: t("18:00"),
      end: t("23:00"),
      assigned_member_id: null,
    });
    expect(o.shift).toMatchObject({ assigned_member_id: null, status: "open" });
    expect(fake.tables.shift).toHaveLength(2);
  });

  it("accepts an overnight shift that ends the next day", async () => {
    const r = await shiftService.createShift(A, {
      start: t("00:00", "28"),
      end: t("12:00", "28"),
      assigned_member_id: "m-ana",
    });
    expect(Date.parse(r.shift.end)).toBeGreaterThan(Date.parse(r.shift.start));
  });

  it("edits the times and reassigns; unassigning makes it open again", async () => {
    const s = seed({ assigned_member_id: "m-ana", status: "claimed" });
    const edited = await shiftService.updateShift(s.id, {
      start: t("13:00"),
      end: t("19:00"),
      assigned_member_id: "m-ben",
    });
    expect(edited.shift).toMatchObject({
      start: "2026-10-27T13:00:00.000Z",
      end: "2026-10-27T19:00:00.000Z",
      assigned_member_id: "m-ben",
      status: "claimed",
    });
    const open = await shiftService.updateShift(s.id, {
      start: t("13:00"),
      end: t("19:00"),
      assigned_member_id: null,
    });
    expect(open.shift).toMatchObject({ assigned_member_id: null, status: "open" });
  });

  it("cancels by deleting only that shift (the schema has no 'canceled' status)", async () => {
    const a = seed({});
    const b = seed({ start: t("18:00"), end: t("23:00") });
    await shiftService.cancelShift(a.id);
    expect(fake.tables.shift.map((x) => x.id)).toEqual([b.id]);
  });
});

describe("overlap is flagged, never blocked", () => {
  it("saves an overlapping shift for the same member and reports the overlap", async () => {
    const first = seed({ assigned_member_id: "m-ana", status: "claimed" });
    const r = await shiftService.createShift(A, {
      start: t("15:00"),
      end: t("20:00"),
      assigned_member_id: "m-ana",
    });
    expect(r.overlaps.map((x) => x.id)).toEqual([first.id]);
    expect(fake.tables.shift).toHaveLength(2); // saved anyway
  });

  it("does not flag back-to-back shifts, other members, open shifts, or the shift being edited", async () => {
    seed({ assigned_member_id: "m-ana", status: "claimed" });
    const adjacent = await shiftService.createShift(A, {
      start: t("18:00"),
      end: t("22:00"),
      assigned_member_id: "m-ana",
    });
    expect(adjacent.overlaps).toEqual([]);
    const other = await shiftService.createShift(A, {
      start: t("12:00"),
      end: t("18:00"),
      assigned_member_id: "m-ben",
    });
    expect(other.overlaps).toEqual([]);
    const open = await shiftService.createShift(A, {
      start: t("12:00"),
      end: t("18:00"),
      assigned_member_id: null,
    });
    expect(open.overlaps).toEqual([]);
    const self = await shiftService.updateShift(adjacent.shift.id, {
      start: t("18:00"),
      end: t("22:00"),
      assigned_member_id: "m-ana",
    });
    expect(self.overlaps).toEqual([]);
  });

  it("flags an overnight shift overlapped the next morning", async () => {
    const night = seed({
      start: t("00:00", "28"),
      end: t("12:00", "28"),
      assigned_member_id: "m-ana",
      status: "claimed",
    });
    const r = await shiftService.createShift(A, {
      start: t("10:00", "28"),
      end: t("14:00", "28"),
      assigned_member_id: "m-ana",
    });
    expect(r.overlaps.map((x) => x.id)).toEqual([night.id]);
  });
});

describe("invalid input fails in the service, before any write", () => {
  it.each([
    ["end equals start", t("12:00"), t("12:00"), /end must be after/],
    ["end before start", t("12:00"), t("09:00"), /end must be after/],
    ["unparseable start", "not a date", t("12:00"), /valid start/],
    ["empty end", t("12:00"), "", /valid end/],
  ])("create rejects: %s", async (_n, start, end, msg) => {
    await expect(
      shiftService.createShift(A, { start, end, assigned_member_id: null }),
    ).rejects.toThrow(ShiftValidationError);
    await expect(
      shiftService.createShift(A, { start, end, assigned_member_id: null }),
    ).rejects.toThrow(msg);
    expect(fake.writes).toEqual([]);
  });

  it("update rejects a bad range and leaves the shift untouched", async () => {
    const s = seed({});
    await expect(
      shiftService.updateShift(s.id, {
        start: t("18:00"),
        end: t("12:00"),
        assigned_member_id: null,
      }),
    ).rejects.toThrow(/end must be after/);
    expect(fake.tables.shift[0]).toMatchObject({ start: s.start, end: s.end });
    expect(fake.writes).toEqual([]);
  });

  it("rejects an assignee from another family, on create and on edit", async () => {
    await expect(
      shiftService.createShift(A, {
        start: t("12:00"),
        end: t("18:00"),
        assigned_member_id: "m-zed",
      }),
    ).rejects.toThrow(/isn't a member of this family/);
    const s = seed({});
    await expect(
      shiftService.updateShift(s.id, {
        start: t("12:00"),
        end: t("18:00"),
        assigned_member_id: "m-zed",
      }),
    ).rejects.toThrow(/isn't a member of this family/);
    expect(fake.writes).toEqual([]);
    expect(fake.tables.shift[0]!.assigned_member_id).toBeNull();
  });
});

describe("authorization is enforced below the UI", () => {
  beforeEach(() => {
    fake.me.role = "member";
  });

  it("a family member (non-organizer) cannot create, edit or cancel", async () => {
    const s = seed({ assigned_member_id: "m-ana", status: "claimed" });
    await expect(
      shiftService.createShift(A, { start: t("12:00"), end: t("18:00"), assigned_member_id: null }),
    ).rejects.toThrow(/row-level security|permission/);
    await expect(
      shiftService.updateShift(s.id, {
        start: t("13:00"),
        end: t("19:00"),
        assigned_member_id: "m-ben",
      }),
    ).rejects.toThrow(/permission/);
    await expect(shiftService.cancelShift(s.id)).rejects.toThrow(/permission/);
    expect(fake.tables.shift).toHaveLength(1);
    expect(fake.tables.shift[0]).toMatchObject({ start: s.start, assigned_member_id: "m-ana" });
  });

  it("another family's organizer cannot touch this family's shifts", async () => {
    const s = seed({ assigned_member_id: "m-ana", status: "claimed" });
    fake.me = { familyId: B, role: "organizer" };
    await expect(
      shiftService.createShift(A, { start: t("12:00"), end: t("18:00"), assigned_member_id: null }),
    ).rejects.toThrow(/row-level security|permission/);
    await expect(
      shiftService.updateShift(s.id, {
        start: t("13:00"),
        end: t("19:00"),
        assigned_member_id: null,
      }),
    ).rejects.toThrow(/wasn't found|access/);
    await expect(shiftService.cancelShift(s.id)).rejects.toThrow(/permission/);
    expect(fake.tables.shift).toHaveLength(1);
    expect(fake.tables.shift[0]!.assigned_member_id).toBe("m-ana");
  });
});

describe("existing claim flow is unchanged", () => {
  it("claim assigns the member and marks the shift claimed", async () => {
    const s = seed({});
    await shiftService.claim(s.id, "m-ana");
    expect(fake.tables.shift[0]).toMatchObject({ assigned_member_id: "m-ana", status: "claimed" });
  });
  it("two people claiming the same open shift: the first wins, the second is told, nothing is overwritten", async () => {
    const s = seed({});
    await shiftService.claim(s.id, "m-ana");
    await expect(shiftService.claim(s.id, "m-ben")).rejects.toThrow(/already took/);
    expect(fake.tables.shift[0]).toMatchObject({ assigned_member_id: "m-ana", status: "claimed" });
  });
  it("a claim only takes an OPEN shift: an assigned shift is never reassigned by claiming", async () => {
    const s = seed({ assigned_member_id: "m-ben", status: "claimed" });
    await expect(shiftService.claim(s.id, "m-ana")).rejects.toThrow(/already took/);
    expect(fake.tables.shift[0]!.assigned_member_id).toBe("m-ben");
  });
  it("a non-organizer's claim is refused by the database rules (member claiming is a separate, later change)", async () => {
    fake.me.role = "member";
    const s = seed({});
    await expect(shiftService.claim(s.id, "m-ana")).rejects.toThrow(/can't change the schedule/);
    expect(fake.tables.shift[0]!.assigned_member_id).toBeNull();
  });
  it("listRange still returns a week's shifts in time order", async () => {
    seed({ start: t("18:00"), end: t("23:00") });
    seed({ start: t("12:00"), end: t("18:00") });
    const rows = await shiftService.listRange(A, t("00:00", "26"), t("00:00", "30"));
    expect(rows.map((r) => r.start)).toEqual([t("12:00"), t("18:00")]);
  });
});
