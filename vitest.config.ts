import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const kernelSrc = fileURLToPath(new URL("./packages/kernel/src/index.ts", import.meta.url));
const serverSrc = fileURLToPath(new URL("./packages/server/src/index.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@tseer/kernel": kernelSrc,
      "@tseer/server": serverSrc,
    },
  },
  test: {
    environment: "node",
    include: ["apps/*/tests/**/*.spec.ts", "packages/*/tests/**/*.spec.ts"],
  },
});
