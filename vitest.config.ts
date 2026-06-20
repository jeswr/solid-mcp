import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/cli.ts"],
    },
  },
});
