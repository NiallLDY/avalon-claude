import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/rebuild-stats.ts"],
  format: ["esm"],
  target: "node24",
  platform: "node",
  clean: true,
  splitting: false,
  sourcemap: true,
  // workspace 包内联进产物，这样运行镜像里不需要 packages/ 目录，
  // 只装 apps/server 的生产依赖即可
  noExternal: [/^@avalon\//],
});
