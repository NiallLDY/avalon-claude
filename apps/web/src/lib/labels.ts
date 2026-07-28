/**
 * 玩家称呼的统一写法。
 *
 * 线下阿瓦隆全靠**座位号**沟通 ——「3 号出的失败牌」「我不上 5 号的车」。
 * 昵称是辅助，号码才是主语。所以凡是提到某个玩家的地方，
 * 一律走这里，别直接拼昵称。
 */

import type { PublicPlayer } from "@avalon/shared";

/** 只要号码。座位号对人是 1 开始的，内部索引是 0 开始 */
export const seatNo = (seat: number): string => `${seat + 1}号`;

/** 号码 + 昵称，如「3号 老王」 */
export const playerLabel = (seat: number, nick?: string): string =>
  nick ? `${seatNo(seat)} ${nick}` : seatNo(seat);

/** 给一份座位名单，返回一个「座位号 → 称呼」的函数 */
export const labeler = (seated: readonly (PublicPlayer | null)[]) => ({
  /** 「3号 老王」，用于正文 */
  full: (seat: number): string => playerLabel(seat, seated[seat]?.nick),
  /** 「3号」，用于空间紧张的地方（比如 10 个人的投票明细） */
  short: seatNo,
  /**
   * 一串座位号排好序后拼成「3号 老王、5号 球球」。
   *
   * 按座位号排序是安全的：服务端打乱派西维尔看到的两人，是为了让**位置**不泄漏
   * 谁是梅林；按号码排只是把顺序变得可预测，并不会透露哪个是梅林，
   * 反而更容易和座位环对上。
   */
  list: (seats: readonly number[], mark?: (seat: number) => string): string =>
    [...seats]
      .sort((a, b) => a - b)
      .map((s) => playerLabel(s, seated[s]?.nick) + (mark?.(s) ?? ""))
      .join("、"),
});
