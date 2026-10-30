// The Visits actions for the Judge Demo (read-only) versus real accounts, and the stale guest-marker repair.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const info = vi.fn();
const list = vi.fn(async () => []);
vi.mock("sonner", () => ({
  toast: { info: (m: string) => info(m), success: vi.fn(), error: vi.fn() },
}));
vi.mock("@tanstack/react-router", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  };
});
vi.mock("@/services", () => ({ visitService: { list: () => list() } }));
import { AppointmentList } from "@/components/AppointmentList";
import {
  JUDGE_DEMO_READ_ONLY_MESSAGE,
  JUDGE_DEMO_USER_ID,
  isJudgeDemo,
  reconcileJudgeDemo,
  setJudgeDemo,
} from "@/lib/judge-demo";
import { createDocumentService } from "@/services/documents";

const mount = (canWrite: boolean) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AppointmentList familyId="f" timeZone="America/Chicago" canWrite={canWrite} />
    </QueryClientProvider>,
  );
beforeEach(() => {
  info.mockReset();
  list.mockClear();
  sessionStorage.clear();
});
afterEach(cleanup);

describe("Visits actions", () => {
  it("a signed-in organizer sees both actions as real links", async () => {
    mount(true);
    expect(await screen.findByRole("link", { name: /New appointment/ })).toHaveAttribute(
      "href",
      "/visits/new",
    );
    expect(screen.getByRole("link", { name: /From a document/ })).toHaveAttribute(
      "href",
      "/visits/upload",
    );
  });
  it("a signed-in non-organizer without the Judge marker sees neither", async () => {
    mount(false);
    await screen.findByRole("tab", { name: /Upcoming/i });
    expect(screen.queryByText(/New appointment/)).toBeNull();
    expect(screen.queryByText(/From a document/)).toBeNull();
  });
  it("anonymous Judge Demo visitors see both actions, but they are not links and only explain that the demo is read-only", async () => {
    setJudgeDemo(true);
    mount(false);
    await screen.findByRole("button", { name: /New appointment/ });
    expect(screen.queryByRole("link", { name: /New appointment/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /From a document/ })).toBeNull();
    for (const name of [/New appointment/, /From a document/]) {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name }));
      });
    }
    expect(info).toHaveBeenCalledTimes(2);
    expect(info).toHaveBeenNthCalledWith(1, JUDGE_DEMO_READ_ONLY_MESSAGE);
  });
});

describe("a stale guest marker is repaired when a real account is signed in", () => {
  it("clears the marker for any user other than the judge identity (and for no session)", () => {
    setJudgeDemo(true);
    expect(reconcileJudgeDemo("00000000-0000-4000-8000-0000000000aa")).toBe(true);
    expect(isJudgeDemo()).toBe(false);
    setJudgeDemo(true);
    expect(reconcileJudgeDemo(null)).toBe(true);
    expect(isJudgeDemo()).toBe(false);
  });
  it("keeps the marker for the judge identity, and does nothing when there is no marker", () => {
    setJudgeDemo(true);
    expect(reconcileJudgeDemo(JUDGE_DEMO_USER_ID)).toBe(false);
    expect(isJudgeDemo()).toBe(true);
    setJudgeDemo(false);
    expect(reconcileJudgeDemo("00000000-0000-4000-8000-0000000000aa")).toBe(false);
  });
});

describe("the Judge Demo can never upload", () => {
  it("uploadPending refuses before touching storage", async () => {
    setJudgeDemo(true);
    const upload = vi.fn(async () => ({ error: null }));
    const svc = createDocumentService({
      upload,
      remove: vi.fn(),
      createSignedUrl: vi.fn(),
      list: vi.fn(),
    } as never);
    await expect(
      svc.uploadPending("11111111-1111-4111-8111-111111111111", new Blob(["x"]), "pdf"),
    ).rejects.toThrow(/read-only/);
    expect(upload).not.toHaveBeenCalled();
  });
});
