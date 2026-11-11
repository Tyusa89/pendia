// Vite config for the Document Upload browser harness ONLY (scripts/visual/doc-upload). It is not used by the app, the build or
// production. It renders the real Document Upload components with a few modules replaced by harness fakes, so no backend, storage
// or network is involved.
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import { HARNESS_PORT } from "./scripts/visual/support/env";

const root = path.resolve(__dirname, "scripts/visual/doc-upload");
const src = path.resolve(__dirname, "src");

/** Serves a tiny synthetic PDF so "Open", "Download" and "Preview here" have a same-origin file to fetch. */
const fixtures: Plugin = {
  name: "harness-fixtures",
  configureServer(server) {
    server.middlewares.use("/fixtures/letter.pdf", (_req, res) => {
      res.setHeader("content-type", "application/pdf");
      res.end("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
    });
  },
};

export default defineConfig({
  root,
  // Separate optimizer cache: the app dev server and this harness run side by side and must not share node_modules/.vite.
  cacheDir: path.resolve(__dirname, "test-results/.vite-harness-cache"),
  plugins: [react(), tailwindcss(), fixtures],
  resolve: {
    alias: [
      { find: /^@\/services\/documents$/, replacement: path.join(root, "fakes/documents.ts") },
      {
        find: /^@\/lib\/doc-upload\/render-pages$/,
        replacement: path.join(root, "fakes/render-pages.ts"),
      },
      {
        find: /^@\/integrations\/supabase\/client$/,
        replacement: path.join(root, "fakes/supabase-client.ts"),
      },
      { find: /^@\//, replacement: `${src}/` },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: HARNESS_PORT,
    strictPort: true,
    fs: { allow: [path.resolve(__dirname)] },
  },
  clearScreen: false,
});
