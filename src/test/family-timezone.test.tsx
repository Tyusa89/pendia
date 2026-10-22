// Phase 1: the family time zone is organizer-configurable, validated, and never taken from the browser.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<{ patch: unknown; id: unknown }> = [];
let refuse = false;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => ({
        eq: (_c: string, id: unknown) => ({
          select: async () => {
            if (table !== "family") throw new Error("wrong table");
            calls.push({ patch, id });
            return refuse ? { data: [], error: null } : { data: [{ id, ...patch }], error: null };
          },
        }),
      }),
    }),
  },
}));

import { FamilyTimeZone } from "@/components/FamilyTimeZone";
import { timeZoneLabel, validateFamilyTimeZone } from "@/lib/timezones";
import { familyService } from "@/services";
import { dateInZone, fromZonedInputValue } from "@/lib/zoned-time";
import { mondayInZone } from "@/lib/shifts";

beforeEach(() => {
  calls.length = 0;
  refuse = false;
});

describe("validateFamilyTimeZone", () => {
  it.each([
    "America/Chicago",
    "America/New_York",
    "Europe/London",
    "America/Argentina/Buenos_Aires",
  ])("accepts %s", (z) => expect(validateFamilyTimeZone(z)).toEqual({ ok: true, timeZone: z }));
  it.each([
    "",
    "  ",
    "CST",
    "EST",
    "Mars/Phobos",
    "America/",
    "../etc/passwd",
    "America/Chicago; drop table",
    null,
    5,
    undefined,
  ])("refuses %j", (z) => expect(validateFamilyTimeZone(z).ok).toBe(false));
  it("labels known zones and falls back to a readable name", () => {
    expect(timeZoneLabel("America/Chicago")).toMatch(/Central/);
    expect(timeZoneLabel("America/Argentina/Buenos_Aires")).toBe("America/Argentina/Buenos Aires");
  });
});

describe("familyService.setTimezone", () => {
  it("writes only the timezone column of the given family", async () => {
    await familyService.setTimezone("fam-1", "America/Chicago");
    expect(calls).toEqual([{ id: "fam-1", patch: { timezone: "America/Chicago" } }]);
  });
  it("refuses an invalid zone before anything reaches the database", async () => {
    await expect(familyService.setTimezone("fam-1", "CST")).rejects.toThrow(/recognizes/);
    expect(calls).toHaveLength(0);
  });
  it("reports a clear error when the database refuses (a non-organizer's update matches no rows)", async () => {
    refuse = true;
    await expect(familyService.setTimezone("fam-1", "America/Chicago")).rejects.toThrow(
      /Only an organizer/,
    );
  });
});

describe("the zone, not the device, decides the day", () => {
  // 2026-10-22 03:30 UTC is still Oct 21 in both US zones, but 11:30 PM vs 10:30 PM.
  const t = new Date("2026-10-22T03:30:00Z");
  it("gives the same calendar day for any viewer, and different days across zones", () => {
    expect(dateInZone(t, "America/Chicago")).toBe("2026-10-21");
    expect(dateInZone(new Date("2026-10-22T04:30:00Z"), "America/New_York")).toBe("2026-10-22");
    expect(dateInZone(new Date("2026-10-22T04:30:00Z"), "America/Chicago")).toBe("2026-10-21");
  });
  it("12 PM Chicago on Oct 22 is 17:00 UTC (CDT); after the November change it is 18:00 UTC (CST)", () => {
    expect(fromZonedInputValue("2026-10-22T12:00", "America/Chicago")).toBe(
      "2026-10-22T17:00:00.000Z",
    );
    expect(fromZonedInputValue("2026-11-02T12:00", "America/Chicago")).toBe(
      "2026-11-02T18:00:00.000Z",
    );
  });
  it("the week starts on the zone's Monday", () => {
    expect(mondayInZone(new Date("2026-10-26T04:30:00Z"), "America/Chicago")).toBe("2026-10-19");
    expect(mondayInZone(new Date("2026-10-26T04:30:00Z"), "America/New_York")).toBe("2026-10-26");
  });
});

const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {ui}
  </QueryClientProvider>
);

describe("<FamilyTimeZone />", () => {
  it("lets an organizer pick another zone and save; Save is disabled until it changes", async () => {
    render(wrap(<FamilyTimeZone familyId="fam-1" timeZone="America/New_York" editable />));
    const save = screen.getByRole("button", { name: "Save time zone" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Care team time zone"), {
      target: { value: "America/Chicago" },
    });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() =>
      expect(calls).toEqual([{ id: "fam-1", patch: { timezone: "America/Chicago" } }]),
    );
  });
  it("shows the current zone even when it is not in the common list", () => {
    render(wrap(<FamilyTimeZone familyId="fam-1" timeZone="Africa/Nairobi" editable />));
    expect(screen.getByRole("option", { name: "Africa/Nairobi" })).toBeInTheDocument();
  });
  it("is read-only for members: no select, no button, and nothing is written", () => {
    render(wrap(<FamilyTimeZone familyId="fam-1" timeZone="America/Chicago" editable={false} />));
    expect(screen.getByText(/Central Time/)).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(calls).toHaveLength(0);
  });
  it("never reads the browser's zone", () => {
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions");
    render(wrap(<FamilyTimeZone familyId="fam-1" timeZone="America/New_York" editable />));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
