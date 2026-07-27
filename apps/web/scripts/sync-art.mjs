/**
 * 把 assets/roles/<style>/web/*.webp 同步到 apps/web/public/art/roles/<style>/。
 *
 * 为什么要同步而不是直接把 assets 当成静态目录：
 * Vite 只发 public/，而 assets/ 是「美术产物的家」（master 档也在那儿）。
 * 复制一份进 public 比在 Vite 里配额外的静态根简单，而且产物目录始终干净。
 *
 * public/art 是 gitignore 的 —— 仓库里只留 assets/ 一份权威副本。
 */

import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const source = resolve(repoRoot, "assets/roles");
const target = resolve(here, "../public/art/roles");

if (!existsSync(source)) {
  console.warn(`[sync-art] 没有 ${source}，跳过`);
  process.exit(0);
}

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });

const styles = await readdir(source, { withFileTypes: true });
let count = 0;
for (const style of styles) {
  if (!style.isDirectory()) continue;
  // web/ 子目录是压过的交付档（1024² q85），master 不进前端
  const from = resolve(source, style.name, "web");
  if (!existsSync(from)) continue;
  await cp(from, resolve(target, style.name), { recursive: true });
  count += (await readdir(from)).length;
  console.log(`[sync-art] ${style.name}`);
}
console.log(`[sync-art] 同步了 ${count} 张`);
