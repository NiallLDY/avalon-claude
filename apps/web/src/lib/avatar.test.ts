/**
 * 断言的是**真的画出来的 SVG**，不是选项对象。
 *
 * 只测 `avatarOptions` 返回了什么没有意义 —— dicebear 怎么解读那些字段
 * 才是结果。所以这里直接 render，从 SVG 里把肤色抠出来、用「关掉这一层
 * 之后 SVG 变没变」判断部件在不在。
 */

import { describe, expect, it } from "vitest";
import { createAvatar } from "@dicebear/core";
import { micah } from "@dicebear/collection";
import { avatarOptions, isMasculine } from "./avatar.js";

const render = (seed: string, extra: Record<string, unknown> = {}) =>
  createAvatar(micah, {
    seed,
    size: 128,
    radius: 50,
    backgroundColor: ["2a3145"],
    ...avatarOptions(seed),
    ...extra,
  }).toString();

/** 脖子那一笔就是肤色：translate 分组后的第一个 path */
const skinOf = (svg: string): string => {
  const m = /<g transform="translate\([^)]*\)">\s*<path[^>]*fill="#([0-9a-f]{6})"/.exec(svg);
  if (!m?.[1]) throw new Error("没在 SVG 里找到肤色那一笔，micah 的结构可能变了");
  return m[1];
};

/** 把某一层的概率归零再画一遍，画出来不一样说明原本有这一层 */
const has = (seed: string, layer: "earringsProbability" | "facialHairProbability"): boolean =>
  render(seed) !== render(seed, { [layer]: 0 });

/**
 * 覆盖面要够宽 —— 1/2 的性别和 45% 的耳环概率靠十来个 seed 碰不齐。
 * 用 LCG 造成生产里那样的 6 字节 hex：`seed-0`/`seed-1` 这种连号字符串
 * 在 FNV-1a 末位上是严格交替的，测不出真实分布。
 */
const SEEDS = (() => {
  let s = 0x2f6e2b1;
  return Array.from({ length: 400 }, () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s.toString(16).padStart(8, "0") + (s % 9973).toString(16).padStart(4, "0");
  });
})();

describe("头像取材", () => {
  it("肤色只出浅、中两档", () => {
    const seen = new Set(SEEDS.map((s) => skinOf(render(s))));
    expect([...seen].sort()).toEqual(["ac6651", "f9c9b6"]);
  });

  it("男生一个耳环都不戴", () => {
    const men = SEEDS.filter(isMasculine);
    expect(men.length).toBeGreaterThan(50); // 样本没退化
    expect(men.filter((s) => has(s, "earringsProbability"))).toEqual([]);
  });

  it("女生该有耳环，且不长胡子", () => {
    const women = SEEDS.filter((s) => !isMasculine(s));
    expect(women.length).toBeGreaterThan(50);
    expect(women.some((s) => has(s, "earringsProbability"))).toBe(true);
    expect(women.filter((s) => has(s, "facialHairProbability"))).toEqual([]);
  });

  it("同一个 seed 永远是同一个人", () => {
    // 性别是算出来的不是存下来的，散列一改所有人集体变脸。
    // 这几个是手写死的，不要用 -u 刷掉 —— 它挂了就说明老玩家的头像要换性别了
    expect(["a1b2c3", "deadbe", "000000", "ffffff", "梅林"].map(isMasculine)).toEqual([
      false, true, false, false, false,
    ]);
    expect(render("a1b2c3")).toBe(render("a1b2c3"));
  });
});
