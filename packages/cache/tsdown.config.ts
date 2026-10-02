import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  platform: "node",
  target: "es2024",
  clean: true,
  dts: true,
  fixedExtension: false,
  deps: {
    neverBundle: ["ioredis"],
  },
});
