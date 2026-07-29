/**
 * 任务牌的展示排列。
 *
 * **这是匿名性的最后一环，但不是唯一一环。**
 * 真正的保证在服务端：`MissionRecord.cardsBySeat` 从不下发，
 * 客户端拿到的只有「几张失败牌」这个数字和上车名单 ——
 * 它**根本不知道**哪张牌是谁出的，想泄漏也无从泄漏。
 *
 * 这里再洗一次，是为了让「牌的位置」也不携带任何可推断的规律：
 * 即使以后有人改成按某种顺序生成，位置也不该和上车顺序对得上。
 *
 * （事后翻对局记录能看到是谁放的，那份数据走的是 `records.ts` 的永久档案，
 * 跟这条实时链路无关 —— 归档发生在终局之后。）
 */

/** 注入随机源，测试里才能断言分布 */
export type Rng = () => number;

/**
 * 生成 `teamSize` 张牌，其中 `failCount` 张是失败牌，位置打乱。
 * 返回的数组里 `true` = 失败牌。
 */
export const missionDeck = (
  teamSize: number,
  failCount: number,
  rng: Rng = Math.random,
): boolean[] => {
  const deck = Array.from({ length: teamSize }, (_, i) => i < failCount);
  // Fisher–Yates
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return deck;
};
