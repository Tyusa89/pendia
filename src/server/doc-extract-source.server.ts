// SERVER ONLY. Reads for document extraction, through the CALLER'S session (row-level security and storage RLS apply). No
// service-role client. Explicit column lists; every query is scoped to the one family. Any unexpected error throws, so the caller
// reports `lookup_failed` rather than a denial.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { DOC_BUCKET } from "@/lib/doc-upload/contract";
import type { DocSource } from "@/server/doc-extract.server";

export function createSupabaseDocSource(
  supabase: SupabaseClient<Database>,
  userId: string,
): DocSource {
  return {
    async getMember(familyId) {
      const { data, error } = await supabase
        .from("member")
        .select("role")
        .eq("family_id", familyId)
        .eq("user_id", userId)
        .limit(1);
      if (error) throw new Error("doc_read_failed");
      return data?.[0] ? { role: data[0].role } : null;
    },
    async getFamily(familyId) {
      const { data, error } = await supabase
        .from("family")
        .select("is_demo, timezone")
        .eq("id", familyId)
        .limit(1);
      if (error) throw new Error("doc_read_failed");
      return data?.[0] ?? null;
    },
    async canReadDocument(path) {
      const { data, error } = await supabase.storage.from(DOC_BUCKET).createSignedUrl(path, 30);
      if (data?.signedUrl) return true;
      const msg = `${error?.message ?? ""}`;
      if (/not.?found|404|does not exist/i.test(msg)) return false;
      throw new Error("doc_read_failed");
    },
  };
}
