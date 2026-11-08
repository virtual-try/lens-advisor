import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    projects: [
      {
        plugins: [tsconfigPaths()],
        test: {
          name: "app",
          include: ["app/**/*.test.{ts,tsx}"],
          environment: "happy-dom",
        },
      },
      {
        test: {
          name: "rx-core",
          include: ["packages/rx-core/**/*.test.{ts,tsx}"],
          environment: "node",
        },
      },
      {
        test: {
          name: "configurator",
          include: ["packages/configurator/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          setupFiles: ["packages/configurator/src/test/setup.ts"],
        },
      },
      {
        test: {
          name: "db",
          include: ["test/**/*.test.ts"],
          environment: "node",
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
