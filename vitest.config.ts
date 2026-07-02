import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: "forks",
    // Vitest 4 flattened `poolOptions.forks.singleFork` to a top-level option.
    singleFork: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/cli.ts"],
    },
  },
});
