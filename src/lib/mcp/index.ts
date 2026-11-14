import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listFamilies from "./tools/list-families";

const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";
export default defineMcp({
  name: "pixel-perfect-matchmaker",
  title: "Pixel Perfect Matchmaker",
  version: "0.1.0",
  instructions: "Pendia family caregiving tools. List only your own family memberships. Family selection in a browser is local and is not available remotely. No clinical advice, AI calls, documents or write actions are exposed.",
  auth: auth.oauth.issuer({ issuer: `https://${projectRef}.supabase.co/auth/v1`, acceptedAudiences: "authenticated", requireOAuthClientClaim: true }),
  tools: [listFamilies],
});