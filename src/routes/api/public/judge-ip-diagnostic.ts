import { createFileRoute } from "@tanstack/react-router";

// Temporary read-only probe. No auth, family, Redis or provider access.
// A failed spoof probe proves distrust; a passed probe alone cannot establish
// the platform's overwrite guarantee or protection against direct-origin access.
export const Route = createFileRoute("/api/public/judge-ip-diagnostic")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const ip = request.headers.get("cf-connecting-ip");
        return Response.json(
          {
            present: Boolean(ip?.trim()),
            trusted: ip === "192.0.2.123" ? false : null,
            usable: false,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});