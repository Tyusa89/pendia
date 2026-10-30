// The stored letter is visible and openable: in the review step right after upload, and from the saved appointment.
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signedUrl = vi.fn();
vi.mock("@/services/documents", () => ({
  documentService: { signedUrl: (p: string) => signedUrl(p) },
}));
import { AppointmentDocumentLink } from "@/components/AppointmentDocumentLink";

const PATH =
  "11111111-1111-4111-8111-111111111111/doc/44444444-4444-4444-8444-444444444444/appointment-letter.pdf";
const URL_ = "https://signed.example/appointment-letter.pdf?token=short-lived";
let tab: { opener: unknown; location: { href: string }; close: ReturnType<typeof vi.fn> };
beforeEach(() => {
  signedUrl.mockReset();
  tab = { opener: "set", location: { href: "" }, close: vi.fn() };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const click = async () =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /View|Opening/ }));
  });

describe("AppointmentDocumentLink", () => {
  it("opens a tab synchronously on the click, then points it at a fresh signed link for exactly that path", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(tab as never);
    signedUrl.mockResolvedValue(URL_);
    render(<AppointmentDocumentLink path={PATH} />);
    await click();
    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(signedUrl).toHaveBeenCalledWith(PATH);
    await waitFor(() => expect(tab.location.href).toBe(URL_));
    expect(tab.opener).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("does not fetch a link until it is clicked", () => {
    render(<AppointmentDocumentLink path={PATH} />);
    expect(signedUrl).not.toHaveBeenCalled();
  });
  it("shows a plain link when the browser blocks the new tab", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    signedUrl.mockResolvedValue(URL_);
    render(<AppointmentDocumentLink path={PATH} />);
    await click();
    const a = await screen.findByRole("link", { name: /Open the document here/ });
    expect(a).toHaveAttribute("href", URL_);
    expect(a).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });
  it("a denied or failed link closes the blank tab and shows a plain error, no URL", async () => {
    vi.spyOn(window, "open").mockReturnValue(tab as never);
    signedUrl.mockRejectedValue(new Error("Couldn't open the document."));
    render(<AppointmentDocumentLink path={PATH} />);
    await click();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't open the document.");
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.href).toBe("");
  });
  it("uses the label it is given", () => {
    render(<AppointmentDocumentLink path={PATH} label="View PDF document" />);
    expect(screen.getByRole("button", { name: /View PDF document/ })).toBeInTheDocument();
  });
});
