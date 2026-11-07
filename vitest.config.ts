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
    ],
  },
});
