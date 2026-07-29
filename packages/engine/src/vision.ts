/**
 * 开局视野计算。GAME.md §5.3 —— 这是全项目信息安全最敏感的一段。
 *
 * 三条不可违反的性质（均有单测断言）：
 *   1. 梅林的视野里**没有莫德雷德**
 *   2. 奥伯伦**看不到任何人**，也**不出现在任何红方队友的视野里**
 *   3. 红兰斯洛特**没有视野**；他出现在梅林视野里时**不带兰斯洛特标记**，
 *      出现在红方队友视野里时**带标记**
 *      —— 唯一例外是开了官方变体 #3「兰斯洛特互认」，此时两位兰斯洛特
 *      各自多知道对方一个座位（`counterpartSeat`），别的还是什么都不知道
 *
 * 视野在发牌时**一次性算好并冻结**，兰斯洛特换阵营不会更新任何人的视野。
 */

import { ROLES, type GameSettings, type RoleId, type Vision } from "@avalon/shared";
import { shuffle, type Rng } from "./rng.js";

const EMPTY_VISION: Vision = {
  evilSeats: [],
  merlinCandidates: [],
  lancelotSeats: [],
  counterpartSeat: null,
};

/** 座位 -> 是否红方（按开局角色，不看当前阵营） */
const evilSeatsOf = (roles: readonly RoleId[]): number[] =>
  roles.flatMap((r, seat) => (ROLES[r].side === "RED" ? [seat] : []));

/**
 * 计算全体玩家的开局视野。
 * @param rng 只用于打乱派西维尔看到的两人顺序 —— 顺序本身会泄漏信息
 * @param settings 只读 `lancelotsKnowEachOther`（官方变体 #3）
 */
export const computeVision = (
  roles: readonly RoleId[],
  rng: Rng,
  settings?: Pick<GameSettings, "lancelotsKnowEachOther">,
): readonly Vision[] => {
  const allEvil = evilSeatsOf(roles);

  /*
   * 变体 #3：两位兰斯洛特开局对眼。
   *
   * 只在**恰好两位**时成立 —— 名单里少一个（配置出错、以后加了别的兰斯洛特角色）
   * 就整个关掉，宁可没有也不要给出半份错情报。
   */
  const lancelots = roles.flatMap((r, seat) => (ROLES[r].isLancelot ? [seat] : []));
  const counterpartOf = (seat: number): number | null => {
    if (!settings?.lancelotsKnowEachOther || lancelots.length !== 2) return null;
    const [a, b] = lancelots as [number, number];
    return seat === a ? b : seat === b ? a : null;
  };

  // 梅林看得见的红方：过滤掉 visibleToMerlin=false 的（即莫德雷德）
  const seenByMerlin = allEvil.filter((seat) => ROLES[roles[seat]!].visibleToMerlin);
  // 红方互认名单：过滤掉 visibleToEvil=false 的（即奥伯伦）
  const seenByEvil = allEvil.filter((seat) => ROLES[roles[seat]!].visibleToEvil);

  const merlinSeat = roles.indexOf("MERLIN");
  const morganaSeat = roles.indexOf("MORGANA");
  const percivalTargets =
    merlinSeat >= 0 && morganaSeat >= 0
      ? shuffle([merlinSeat, morganaSeat], rng)
      : [];

  return roles.map((roleId, seat): Vision => {
    const meta = ROLES[roleId];

    if (roleId === "MERLIN") {
      return { ...EMPTY_VISION, evilSeats: seenByMerlin };
    }

    if (roleId === "PERCIVAL") {
      return { ...EMPTY_VISION, merlinCandidates: percivalTargets };
    }

    if (meta.side === "RED" && meta.seesEvil) {
      const teammates = seenByEvil.filter((s) => s !== seat);
      return {
        evilSeats: teammates,
        merlinCandidates: [],
        // 队友视角能认出谁是兰斯洛特（梅林视角不行）
        lancelotSeats: teammates.filter((s) => ROLES[roles[s]!].isLancelot),
        counterpartSeat: null,
      };
    }

    // 忠臣、蓝兰斯洛特、奥伯伦、红兰斯洛特
    // 两位兰斯洛特在变体 #3 下多知道彼此，别的什么都不多知道
    return { ...EMPTY_VISION, counterpartSeat: counterpartOf(seat) };
  });
};
