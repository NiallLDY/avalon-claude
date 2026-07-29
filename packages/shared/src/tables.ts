/**
 * 规则常量表 —— 唯一允许出现规则魔法数字的地方（见 CLAUDE.md 约定）。
 * 数据来源：GAME.md §3 §4 §8 §9 §10。改这里之前先改 GAME.md。
 */

import type { RoleId } from "./roles.js";

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 10;
export type PlayerCount = 5 | 6 | 7 | 8 | 9 | 10;

/** 一局 5 轮任务 */
export const MISSION_COUNT = 5;
/** 任一阵营拿满 3 轮即达成任务线 */
export const MISSIONS_TO_WIN = 3;
/** 连续否决达到此数 → 红方胜（GAME.md §6.5，Q1 已定：轮内连续，通过即清零） */
export const REJECT_LIMIT = 5;

/** 每轮任务的上车人数。索引 = roundIndex（0~4）。GAME.md §4 */
export const TEAM_SIZE: Readonly<
  Record<PlayerCount, readonly [number, number, number, number, number]>
> = {
  5: [2, 3, 2, 3, 3],
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5],
  9: [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5],
} as const;

/**
 * 判定任务失败所需的失败牌数。
 * 保护轮 = 7 人及以上的第 4 轮（roundIndex === 3），需要 2 张。其余 1 张。
 */
export const failsRequired = (
  playerCount: PlayerCount,
  roundIndex: number,
): 1 | 2 => (playerCount >= 7 && roundIndex === 3 ? 2 : 1);

/** 该轮是否为保护轮（UI 上要标 🛡） */
export const isProtectedRound = (
  playerCount: PlayerCount,
  roundIndex: number,
): boolean => failsRequired(playerCount, roundIndex) === 2;

/** 标准模式角色配置。GAME.md §3.1 */
export const SETUP_STANDARD: Readonly<Record<PlayerCount, readonly RoleId[]>> = {
  5: ["MERLIN", "PERCIVAL", "LOYAL_SERVANT", "MORGANA", "ASSASSIN"],
  6: ["MERLIN", "PERCIVAL", "LOYAL_SERVANT", "LOYAL_SERVANT", "MORGANA", "ASSASSIN"],
  7: [
    "MERLIN", "PERCIVAL", "LOYAL_SERVANT", "LOYAL_SERVANT",
    "MORGANA", "ASSASSIN", "OBERON",
  ],
  8: [
    "MERLIN", "PERCIVAL", "LOYAL_SERVANT", "LOYAL_SERVANT", "LOYAL_SERVANT",
    "MORGANA", "ASSASSIN", "MINION",
  ],
  9: [
    "MERLIN", "PERCIVAL", "LOYAL_SERVANT", "LOYAL_SERVANT", "LOYAL_SERVANT", "LOYAL_SERVANT",
    "MORGANA", "ASSASSIN", "MORDRED",
  ],
  10: [
    "MERLIN", "PERCIVAL", "LOYAL_SERVANT", "LOYAL_SERVANT", "LOYAL_SERVANT", "LOYAL_SERVANT",
    "MORGANA", "ASSASSIN", "MORDRED", "OBERON",
  ],
} as const;

/**
 * 兰斯洛特模式角色配置，仅 7–10 人。GAME.md §3.2
 * 相对标准模式：蓝方减 1 忠臣加蓝兰，红方去掉刺客加红兰。
 * 本模式没有刺客，刺杀由莫甘娜执行（见 ASSASSIN_ROLE_BY_MODE）。
 */
export const SETUP_LANCELOT: Readonly<Partial<Record<PlayerCount, readonly RoleId[]>>> = {
  7: [
    "MERLIN", "PERCIVAL", "LOYAL_SERVANT", "LANCELOT_BLUE",
    "MORGANA", "LANCELOT_RED", "OBERON",
  ],
  8: [
    "MERLIN", "PERCIVAL", "LOYAL_SERVANT", "LOYAL_SERVANT", "LANCELOT_BLUE",
    "MORGANA", "LANCELOT_RED", "MINION",
  ],
  9: [
    "MERLIN", "PERCIVAL", "LOYAL_SERVANT", "LOYAL_SERVANT", "LOYAL_SERVANT", "LANCELOT_BLUE",
    "MORGANA", "LANCELOT_RED", "MORDRED",
  ],
  10: [
    "MERLIN", "PERCIVAL", "LOYAL_SERVANT", "LOYAL_SERVANT", "LOYAL_SERVANT", "LANCELOT_BLUE",
    "MORGANA", "LANCELOT_RED", "MORDRED", "OBERON",
  ],
} as const;

export const LANCELOT_MIN_PLAYERS = 7;

/** 执行刺杀的角色：标准模式是刺客，兰斯洛特模式是莫甘娜。GAME.md §8.5 */
export const ASSASSIN_ROLE_BY_MODE = {
  STANDARD: "ASSASSIN",
  LANCELOT: "MORGANA",
} as const satisfies Record<string, RoleId>;

/**
 * 湖中女神查验时机：第 2、3、4 轮任务结束后。GAME.md §9
 * 值为 roundIndex（0-based），即第 2 轮 = index 1。
 */
export const LADY_CHECK_AFTER_ROUNDS = [1, 2, 3] as const;

/**
 * 湖中女神的最低人数。**官方规则是 7 人及以上**，不是建议值。
 * 人少时女神的信息量过大，会直接压塌红方。
 */
export const LADY_MIN_PLAYERS = 7;

/**
 * 提前刺杀解锁条件（Q3 已定）：完成 2 次任务执行之后。
 * 注意是「已结算的任务数」，流局不计。GAME.md §10
 */
export const EARLY_ASSASSINATION_UNLOCK_MISSIONS = 2;

/**
 * 兰斯洛特忠诚牌。GAME.md §8.2 / §8.3
 *
 * **牌堆是固定构成的，不是每张独立掷骰。** 官方 Lancelot promo 明确写了
 * 牌堆张数与「阵营转换」张数（两个变体都是 2 张转换牌），所以一局最多换 2 次，
 * 而且已经翻掉的牌会影响后面的概率 —— 前两张都翻出转换牌，后面就必然是空白。
 * 用独立概率模拟会丢掉这层耦合，也可能一局连换 3 次以上。
 *
 * `blanks + swaps` 是牌堆总张数，`afterRounds`（+ beforeFirstMission）决定
 * 实际翻几张 —— 官方变体 #1 是 5 张里翻 3 张，剩下 2 张永远不揭。
 * afterRounds 的值是 roundIndex（0-based）。
 */
export const LOYALTY_FLIP_SCHEDULE = {
  /** 常规（官方变体 #1）：牌堆 3 空白 + 2 转换，第 2 次任务结束后开始翻，共翻 3 张 */
  NORMAL: {
    beforeFirstMission: false,
    afterRounds: [1, 2, 3],
    maxFlips: 3,
    blanks: 3,
    swaps: 2,
  },
  /** 开局（官方变体 #2）：牌堆 5 空白 + 2 转换，洗好发 5 张，第 1 次任务前就翻头一张 */
  OPENING: {
    beforeFirstMission: true,
    afterRounds: [0, 1, 2, 3],
    maxFlips: 5,
    blanks: 5,
    swaps: 2,
  },
} as const;

/** 一局最多换几次阵营 —— 两个变体的牌堆里都只有 2 张转换牌 */
export const MAX_LOYALTY_SWAPS = 2;

export const isValidPlayerCount = (n: number): n is PlayerCount =>
  Number.isInteger(n) && n >= MIN_PLAYERS && n <= MAX_PLAYERS;
