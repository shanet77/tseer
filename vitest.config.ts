import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["apps/*/tests/**/*.spec.ts", "packages/*/tests/**/*.spec.ts"],
  },
});
