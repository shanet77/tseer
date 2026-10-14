import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const cacheSrc = fileURLToPath(new URL("./packages/cache/src/index.ts", import.meta.url));
const httpClientSrc = fileURLToPath(
  new URL("./packages/http-client/src/index.ts", import.meta.url),
);
const kernelSrc = fileURLToPath(new URL("./packages/kernel/src/index.ts", import.meta.url));
const mediaSrc = fileURLToPath(new URL("./packages/media/src/index.ts", import.meta.url));
const profileWebSrc = fileURLToPath(
  new URL("./packages/profile-web/src/index.ts", import.meta.url),
);
const serverSrc = fileURLToPath(new URL("./packages/server/src/index.ts", import.meta.url));
const sessionsSrc = fileURLToPath(
  new URL("./packages/twitter-sessions/src/index.ts", import.meta.url),
);
const twitterParserSrc = fileURLToPath(
  new URL("./packages/twitter-parser/src/index.ts", import.meta.url),
);
const typesSrc = fileURLToPath(new URL("./packages/types/src/index.ts", import.meta.url));
const twitterApiSrc = fileURLToPath(
  new URL("./packages/twitter-api/src/index.ts", import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: {
      "@tseer/cache": cacheSrc,
      "@tseer/http-client": httpClientSrc,
      "@tseer/kernel": kernelSrc,
      "@tseer/media": mediaSrc,
      "@tseer/profile-web": profileWebSrc,
      "@tseer/server": serverSrc,
      "@tseer/twitter-sessions": sessionsSrc,
      "@tseer/twitter-api": twitterApiSrc,
      "@tseer/twitter-parser": twitterParserSrc,
      "@tseer/types": typesSrc,
    },
  },
  test: {
    environment: "node",
    setupFiles: existsSync(fileURLToPath(new URL("./tests/setup-hermetic.ts", import.meta.url)))
      ? ["./tests/setup-hermetic.ts"]
      : [],
    include: ["tests/*.spec.ts", "apps/*/tests/**/*.spec.ts", "packages/*/tests/**/*.spec.ts"],
  },
});
