import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_my_families",
  title: "List my families",
  description: "List the signed-in user's family memberships; use returned family IDs to choose a family explicitly.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_args, ctx) => {
    const uid = ctx.getUserId();
    if (!ctx.isAuthenticated() || !uid) throw new ToolError("Sign in is required.");
    const db = await supabaseForUser(ctx);
    const { data, error } = await db.from("member").select("family_id, role, family(id, name)").eq("user_id", uid).order("created_at").limit(50);
    if (error) throw new ToolError("Your families could not be loaded.");
    const families = (data ?? []).flatMap(row => {
      const family = Array.isArray(row.family) ? row.family[0] : row.family;
      return family ? [{ id: family.id, name: family.name, role: row.role }] : [];
    });
    return { content: [{ type: "text", text: JSON.stringify(families) }], structuredContent: { families } };
  },
});