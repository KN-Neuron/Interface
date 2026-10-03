import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",

    setupFiles: ["./src/test/setup.ts"],

    globals: false,

    clearMocks: true,

    restoreMocks: true,

    coverage: {
      provider: "v8",

      reporter: ["text", "html"],

      reportsDirectory: "coverage",

      include: ["src/**/*.{ts,tsx}"],

      exclude: ["src/main.tsx", "src/test/**", "**/*.d.ts", "**/*.test.ts", "**/*.test.tsx"],
    },
  },
});
