import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `.idea/` holds a vendored read-only copy of tastytrade-api-js kept for
    // reference. It ships its own suite, which vitest would otherwise collect
    // and run as if it were ours — 13 failing files that say nothing about
    // this server.
    exclude: ["**/node_modules/**", "**/dist/**", ".idea/**"],
  },
});
