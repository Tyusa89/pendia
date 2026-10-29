import { beforeEach, describe, expect, it, vi } from "vitest";
import { setJudgeDemo } from "@/lib/judge-demo";
import { judgeDemoData } from "@/lib/judge-demo-data";
import { withJudgeDemo } from "@/services/judge-demo-service";

describe("hackathon guest boundaries", () => {
  beforeEach(() => sessionStorage.clear());
  it("does not send demo writes to live services", async () => {
    const remove = vi.fn();
    const service = withJudgeDemo({ remove }, {});
    setJudgeDemo(true);
    await expect(service.remove()).rejects.toThrow("read-only");
    expect(remove).not.toHaveBeenCalled();
  });
  it("returns fictional demo reads without invoking live reads", async () => {
    const list = vi.fn();
    const service = withJudgeDemo({ list }, { list: () => judgeDemoData().medications });
    setJudgeDemo(true);
    expect(await service.list()).toEqual([expect.objectContaining({ name: "Lisinopril", dose: "10 mg" })]);
    expect(list).not.toHaveBeenCalled();
  });
  it("keeps ordinary signed-in services unchanged", async () => {
    const list = vi.fn().mockResolvedValue(["normal"]);
    expect(await withJudgeDemo({ list }, { list: () => [] }).list()).toEqual(["normal"]);
    expect(list).toHaveBeenCalledOnce();
  });
  it("uses the fictional family, not Morales, with a non-organizer guest", () => {
    const d = judgeDemoData();
    expect(d.family.name).toBe("Pendia Hackathon — Fictional Demo Family");
    expect(d.family.is_demo).toBe(true);
    expect(d.me.role).toBe("member");
    expect(d.me.can_see_meds).toBe(true);
    expect(d.me.can_see_visits).toBe(true);
    expect(d.me.can_see_schedule).toBe(true);
  });
  it("does not invent dose schedules or administration reports", () => {
    const d = judgeDemoData();
    expect(d.medications).toHaveLength(1);
    expect(d.medications[0]?.schedule).toBeNull();
  });
});