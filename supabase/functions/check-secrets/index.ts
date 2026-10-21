// Throwaway: confirms the edge runtime can read secrets. Returns booleans only; never the value, a prefix, or a length.
// Makes no outbound calls, so it cannot spend anything. Delete after the Phase 2 spike.
const NAMES = ["META_API_KEY"];

Deno.serve(() => {
  const present = Object.fromEntries(NAMES.map((n) => [n, (Deno.env.get(n) ?? "").trim().length > 0]));
  return new Response(JSON.stringify({ present }), { headers: { "content-type": "application/json" } });
});
