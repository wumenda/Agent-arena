import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"], env: { ARENA_DB: ":memory:" } },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
