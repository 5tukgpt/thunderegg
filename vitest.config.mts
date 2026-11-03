import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

export default defineConfig({
  resolve: {
    // main.js (the built bundle Obsidian ships) sits next to main.ts. Vite tries .js before .ts
    // by default, so `import "../main"` would test the stale bundle — prefer the source.
    extensions: [".ts", ".mts", ".mjs", ".js", ".json"],
    // The `obsidian` npm package is type definitions only — there is no code to load outside
    // the app. Every test gets the fake in tests/helpers/obsidian-mock.ts instead.
    alias: {
      obsidian: fileURLToPath(new URL("./tests/helpers/obsidian-mock.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
