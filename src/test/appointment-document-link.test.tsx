// Opening the stored letter: a user-initiated, two-step flow that works inside a sandboxed preview frame (no scripted new tab), never
// shows the signed link or its token, and offers Open in new tab, Download and an in-page Preview.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signedUrl = vi.fn();
const renderPages = vi.fn();
vi.mock("@/services/documents", () => ({
  DOC_SIGNED_URL_TTL_SECONDS: 300,
  documentService: { signedUrl: (p: string) => signedUrl(p) },
}));
vi.mock("@/lib/doc-upload/render-pages", () => ({
  renderPages: (...a: unknown[]) => renderPages(...a),
}));
vi.mock("@tanstack/react-router", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  };
});
import { AppointmentDocumentLink } from "@/components/AppointmentDocumentLink";
import { AppointmentSummary } from "@/components/AppointmentSummary";
import { makeRow } from "./fake-visits";

const FAM = "11111111-1111-4111-8111-111111111111";
const PATH = `${FAM}/doc/44444444-4444-4444-8444-444444444444/Dr_Reyes_letter.pdf`;
const TOKEN = "SECRET-ACCESS-TOKEN-abc123";
const URL_ = `https://project.supabase.co/storage/v1/object/sign/appointment-docs/${PATH}?token=${TOKEN}`;

beforeEach(() => {
  signedUrl.mockReset();
  renderPages.mockReset();
  signedUrl.mockResolvedValue(URL_);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const view = async () =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /View/ }));
  });
const noSecretOnPage = () => {
  expect(document.body.textContent ?? "").not.toContain(TOKEN);
  expect(document.body.textContent ?? "").not.toContain("supabase.co");
};

describe("AppointmentDocumentLink", () => {
  it("fetches nothing and opens nothing until clicked", () => {
    const open = vi.spyOn(window, "open");
    render(<AppointmentDocumentLink path={PATH} />);
    expect(signedUrl).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
  it("on click it fetches a link for exactly that path and offers real actions, without scripting a new window", async () => {
    const open = vi.spyOn(window, "open");
    render(<AppointmentDocumentLink path={PATH} />);
    await view();
    expect(signedUrl).toHaveBeenCalledExactlyOnceWith(PATH);
    expect(open).not.toHaveBeenCalled();
    const link = await screen.findByRole("link", { name: /Open in new tab/ });
    expect(link).toHaveAttribute("href", URL_);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
    expect(screen.getByRole("button", { name: /Download/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Preview here/ })).toBeInTheDocument();
    expect(screen.getByTestId("document-actions")).toHaveTextContent("Dr_Reyes_letter.pdf");
    noSecretOnPage(); // the link is in an href only, never rendered as text
  });
  it("a failed link request shows a fixed message and never the underlying error (which can carry the link or token)", async () => {
    signedUrl.mockRejectedValue(new Error(`boom ${URL_}`));
    render(<AppointmentDocumentLink path={PATH} />);
    await view();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't open the document. Please try again.",
    );
    noSecretOnPage();
    expect(screen.queryByRole("link", { name: /Open in new tab/ })).toBeNull();
  });
  it("Download fetches the file and saves it under its own name, without opening a tab", async () => {
    const fetchMock = vi.fn(async () => new Response(new Blob(["%PDF-1.4"]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const createUrl = vi.fn(() => "blob:local");
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() });
    const clicked: Array<{ download: string; href: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ download: this.download, href: this.href });
    });
    const open = vi.spyOn(window, "open");
    render(<AppointmentDocumentLink path={PATH} />);
    await view();
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /Download/ }));
    });
    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledWith(
      URL_,
      expect.objectContaining({ credentials: "omit", referrerPolicy: "no-referrer" }),
    );
    expect(clicked[0]).toEqual({ download: "Dr_Reyes_letter.pdf", href: "blob:local" });
    expect(open).not.toHaveBeenCalled();
    noSecretOnPage();
    vi.unstubAllGlobals();
  });
  it("a failed download shows a fixed message with no link or token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError(`Failed to fetch ${URL_}`);
      }),
    );
    render(<AppointmentDocumentLink path={PATH} />);
    await view();
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /Download/ }));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Couldn't download the document here/,
    );
    noSecretOnPage();
    vi.unstubAllGlobals();
  });
  it("Preview here shows the document inside the page (works in a sandboxed frame), and a failure is a fixed message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob(["%PDF-1.4"]), { status: 200 })),
    );
    renderPages.mockResolvedValue([
      { mime: "image/jpeg", base64: "QUJD" },
      { mime: "image/jpeg", base64: "REVG" },
    ]);
    render(<AppointmentDocumentLink path={PATH} />);
    await view();
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /Preview here/ }));
    });
    const imgs = await screen.findAllByRole("img");
    expect(imgs).toHaveLength(2);
    expect(imgs[0]).toHaveAttribute("src", "data:image/jpeg;base64,QUJD");
    expect(renderPages.mock.calls[0]![1]).toBe("pdf");
    cleanup();
    renderPages.mockRejectedValue(new Error(`render ${URL_}`));
    render(<AppointmentDocumentLink path={PATH} />);
    await view();
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /Preview here/ }));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't show a preview here/);
    noSecretOnPage();
    vi.unstubAllGlobals();
  });
  it("hides the actions shortly before the 5-minute link expires, so a dead link is never offered", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<AppointmentDocumentLink path={PATH} />);
    await view();
    expect(await screen.findByRole("link", { name: /Open in new tab/ })).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(271_000);
    });
    expect(screen.queryByRole("link", { name: /Open in new tab/ })).toBeNull();
    expect(screen.getByRole("button", { name: /View/ })).toBeInTheDocument(); // can ask for a fresh link
  });
  it("uses the label it is given", () => {
    render(<AppointmentDocumentLink path={PATH} label="View PDF document" />);
    expect(screen.getByRole("button", { name: /View PDF document/ })).toBeInTheDocument();
  });
});

describe("a document attached to a saved appointment opens the same way", () => {
  it("the appointment page shows the file name and the same view / open actions", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppointmentSummary
          visit={makeRow({ document_path: PATH, family_id: FAM })}
          timeZone="America/New_York"
          canWrite
          overlapCount={0}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("document-name")).toHaveTextContent("Dr_Reyes_letter.pdf");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /View PDF document/ }));
    });
    expect(await screen.findByRole("link", { name: /Open in new tab/ })).toHaveAttribute(
      "href",
      URL_,
    );
    expect(signedUrl).toHaveBeenCalledWith(PATH);
    noSecretOnPage();
  });
});
