/**
 * 随机源。引擎自己**绝不**调用 Math.random / Date.now（见 CLAUDE.md 铁律 7）——
 * 随机性一律由调用方注入，这样：
 *   - 单测可以用确定性序列穷举各种发牌
 *   - 服务端用 crypto.randomInt，且能记录 seed 供复盘
 */

export interface Rng {
  /** 返回 [0, maxExclusive) 内的整数 */
  int(maxExclusive: number): number;
}

/** Fisher–Yates。返回新数组，不改入参。 */
export const shuffle = <T>(items: readonly T[], rng: Rng): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    // 非空断言安全：i、j 都在 [0, out.length) 内
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
};

/**
 * 测试专用：把一串预设值当成随机源。
 * 序列耗尽后从头循环，这样测试不必精确算出需要多少个随机数。
 */
export const seededRng = (sequence: readonly number[]): Rng => {
  if (sequence.length === 0) throw new Error("seededRng 需要至少一个值");
  let cursor = 0;
  return {
    int(maxExclusive: number): number {
      const raw = sequence[cursor % sequence.length]!;
      cursor++;
      return maxExclusive <= 0 ? 0 : ((raw % maxExclusive) + maxExclusive) % maxExclusive;
    },
  };
};
