// Stand-in for src/integrations/supabase/client.ts inside the harness only. Nothing in the harness may reach a backend; any use of
// this object is a bug and fails loudly.
export const supabase = new Proxy(
  {},
  {
    get() {
      throw new Error("Document Upload harness: the Supabase client must not be used");
    },
  },
);
