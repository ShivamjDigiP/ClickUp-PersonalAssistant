import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Lets tests import route files that use the "@/…" shortcut, exactly as the app does (see tsconfig.json "paths").
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
});
