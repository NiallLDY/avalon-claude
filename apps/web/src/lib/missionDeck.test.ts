/**
 * 任务牌排列。这层是展示用的，但它承载「谁出的失败牌」这个永久悬案 ——
 * 排列一旦有规律，桌上就能反推出人。
 */

import { describe, expect, it } from "vitest";
import { missionDeck } from "./missionDeck.js";

describe("missionDeck", () => {
  it("牌数和失败牌数都对", () => {
    for (const [size, fails] of [[2, 0], [3, 1], [5, 2], [4, 4]] as const) {
      const deck = missionDeck(size, fails);
      expect(deck).toHaveLength(size);
      expect(deck.filter(Boolean)).toHaveLength(fails);
    }
  });

  it("失败牌不会总落在同一个位置", () => {
    // 3 张牌 1 张失败，跑很多次，三个位置都该出现过
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) {
      seen.add(missionDeck(3, 1).indexOf(true));
    }
    expect(seen, "失败牌的位置是固定的，等于把出牌人排序泄漏出去").toEqual(
      new Set([0, 1, 2]),
    );
  });

  it("分布大致均匀，不是偏向某一格", () => {
    const counts = [0, 0, 0, 0];
    const runs = 4000;
    for (let i = 0; i < runs; i++) counts[missionDeck(4, 1).indexOf(true)]! += 1;
    // 期望各 1000，给足够宽的容差，只挡住「明显偏心」
    for (const c of counts) {
      expect(c).toBeGreaterThan(runs / 4 - 150);
      expect(c).toBeLessThan(runs / 4 + 150);
    }
  });

  it("注入随机源时行为可预测 —— 便于在测试里构造确定排列", () => {
    // rng 恒为 0：每次都和下标 0 交换
    expect(missionDeck(3, 1, () => 0)).toEqual([false, false, true]);
  });

  it("全成功和全失败都不会崩", () => {
    expect(missionDeck(3, 0)).toEqual([false, false, false]);
    expect(missionDeck(3, 3)).toEqual([true, true, true]);
  });
});
