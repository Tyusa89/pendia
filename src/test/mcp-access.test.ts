import { describe, expect, it, vi } from "vitest";
import { ToolContext } from "@lovable.dev/mcp-js";
import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";
import server from "@/lib/mcp";
import tool from "@/lib/mcp/tools/list-families";

const factory = vi.hoisted(() => vi.fn());
vi.mock("@/lib/mcp/supabase", () => ({ supabaseForUser: factory }));

describe("MCP access boundary", () => {
  it("rejects unsigned requests before tool execution", async () => {
    const response = await createTanStackMcpHandler(server)({ request: new Request("https://app.invalid/mcp", {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }) });
    expect(response.status).toBe(401);
  });
  it("refuses a direct unauthenticated handler call without reading data", async () => {
    factory.mockClear();
    await expect(tool.handler({}, new ToolContext(undefined))).rejects.toThrow("Sign in is required");
    expect(factory).not.toHaveBeenCalled();
  });
  it("filters memberships by the verified caller, not an input identity", async () => {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ data: [{ family_id: "family-1", role: "member", family: { id: "family-1", name: "Example family" } }], error: null }) };
    factory.mockResolvedValue({ from: vi.fn(() => query) });
    const ctx = new ToolContext(undefined);
    vi.spyOn(ctx, "isAuthenticated").mockReturnValue(true);
    vi.spyOn(ctx, "getUserId").mockReturnValue("verified-user");
    const result = await tool.handler({}, ctx);
    expect(query.eq).toHaveBeenCalledWith("user_id", "verified-user");
    expect(result.structuredContent).toEqual({ families: [{ id: "family-1", name: "Example family", role: "member" }] });
  });
});