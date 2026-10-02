import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const httpClientSrc = fileURLToPath(
  new URL("./packages/http-client/src/index.ts", import.meta.url),
);
const kernelSrc = fileURLToPath(new URL("./packages/kernel/src/index.ts", import.meta.url));
const serverSrc = fileURLToPath(new URL("./packages/server/src/index.ts", import.meta.url));
const sessionsSrc = fileURLToPath(
  new URL("./packages/twitter-sessions/src/index.ts", import.meta.url),
);
const typesSrc = fileURLToPath(new URL("./packages/types/src/index.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@tseer/http-client": httpClientSrc,
      "@tseer/kernel": kernelSrc,
      "@tseer/server": serverSrc,
      "@tseer/twitter-sessions": sessionsSrc,
      "@tseer/types": typesSrc,
    },
  },
  test: {
    environment: "node",
    include: ["apps/*/tests/**/*.spec.ts", "packages/*/tests/**/*.spec.ts"],
  },
});
