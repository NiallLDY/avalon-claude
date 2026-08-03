/**
 * 前后端共用的对局类型。
 *
 * 划分原则：**客户端看得到的东西住这里**，服务端独有的机密状态
 * （`GameState`、每张任务牌是谁出的、每个人的角色）住 `@avalon/engine`。
 * 这样 `apps/web` 只依赖 shared，不依赖规则引擎 —— 引擎代码永远不会被打进前端包。
 */

import type { RoleId } from "./roles.js";

export type GameMode = "STANDARD" | "LANCELOT";

export type Phase =
  | "ROLE_REVEAL"
  | "LOYALTY_FLIP"
  | "TEAM_BUILD"
  | "VOTE"
  | "VOTE_RESULT"
  | "MISSION"
  | "MISSION_RESULT"
  | "LADY_OF_LAKE"
  | "ASSASSINATION"
  | "GAME_OVER";

export type SpeakDirection = "CW" | "CCW";

export interface GameSettings {
  readonly mode: GameMode;
  readonly ladyOfTheLake: boolean;
  readonly earlyAssassination: boolean;
  readonly leaderRotation: "CLOCKWISE" | "RANDOM";
  /** 轮内连续（官方，GAME.md Q1）or 全局累计 */
  readonly rejectCounting: "PER_ROUND" | "GLOBAL";
  readonly loyaltyFlipTiming: "NORMAL" | "OPENING";
  readonly hideLoyaltyFlipResult: boolean;
  /**
   * 两个兰斯洛特开局互相知道对方是谁 —— 官方 Lancelot promo 变体 #3，
   * 原文注明「Recommended for larger groups only」，所以默认关。
   */
  readonly lancelotsKnowEachOther: boolean;
  /**
   * 观战者全知视角：看得到所有人的角色、当前阵营和各自的视野。
   *
   * 默认关，且**开局后改不了**（`setSettings` 在对局中直接拒）——
   * 中途打开等于突然给场边发底牌。
   *
   * 这条只对**没坐下的人**生效；在座玩家的视图一个字都不变。
   * 注意它挡不住「自己开个小号观战」——线下同桌游戏本来就靠人盯人，
   * 房主自己掂量要不要开。
   */
  readonly spectatorsSeeRoles: boolean;
  /**
   * 互认的坏人连队友的**具体角色**一起知道，而不只是「他是红方」。
   *
   * 只作用于本来就互相认得的那几个人 —— 判据是角色表上的 `visibleToEvil`。
   * 奥伯伦两边都不沾：队友名单里本来就没有他（`visibleToEvil: false`），
   * 他自己也拿不到任何视野（`seesEvil: false`），开了这个开关也一样。
   *
   * **默认开。** 红方开局就知道刺客是谁、莫德雷德是谁，配合默契高不少；
   * 关掉的话红方内部还多一层信息差，想玩硬一点的再关。
   */
  readonly evilKnowRoles: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  mode: "STANDARD",
  ladyOfTheLake: false,
  earlyAssassination: false,
  leaderRotation: "CLOCKWISE",
  rejectCounting: "PER_ROUND",
  loyaltyFlipTiming: "NORMAL",
  hideLoyaltyFlipResult: false,
  lancelotsKnowEachOther: false,
  spectatorsSeeRoles: false,
  evilKnowRoles: true,
};

/**
 * 某人开局看到的信息。发牌时冻结，兰斯洛特换阵营也不更新。
 * 规则见 GAME.md §5.3。
 */
export interface Vision {
  /** 我能看到的「红方」座位。只表示是红方，不含具体角色 */
  readonly evilSeats: readonly number[];
  /** 派西维尔看到的两个座位（梅林与莫甘娜），已打乱，不标注谁是谁 */
  readonly merlinCandidates: readonly number[];
  /** evilSeats 中需要标注「兰斯洛特」的座位。只有红方队友视角才有值 */
  readonly lancelotSeats: readonly number[];
  /**
   * 对家兰斯洛特的座位。只在开了「兰斯洛特互认」时，发给两位兰斯洛特本人。
   *
   * **不能塞进 evilSeats** —— 蓝兰看到的那个人此刻是红方没错，但换过阵营后
   * 就不是了，而视野是冻结的。这里的语义是「和我永远相反的那一位」，
   * 不是「他是红方」。
   */
  readonly counterpartSeat: number | null;
  /**
   * 队友的具体角色。只在房主开了「坏人互认身份」时才有值。
   *
   * 座位一定是 `evilSeats` 的子集 —— 也就是说奥伯伦不可能出现在这里，
   * 他压根就不在队友名单上。梅林、派西维尔的视野里这项恒为空：
   * 他们看到的红方只是「红方」，给出角色就等于把整局送掉。
   */
  readonly evilRoles: readonly { readonly seat: number; readonly roleId: RoleId }[];
}

/**
 * 聊天频道。
 *
 * `ALL` 对局里所有人（含观战）都看得到；
 * `EVIL` **只发给互相认得的坏人** —— 判据见 `engine/vision.ts` 的 `evilChatSeats`。
 * 奥伯伦和红兰斯洛特都不在里面：前者跟谁都不互认，后者认不出队友，
 * 让他读到这个频道等于把红方名单直接送给他。
 */
export type ChatChannel = "ALL" | "EVIL";

/** 一条聊天。作者只记座位号，昵称头像由客户端拿 room.seats 现查 */
export interface ChatMessage {
  readonly id: number;
  readonly channel: ChatChannel;
  readonly seat: number;
  readonly text: string;
  readonly at: number;
}

export type WinReason =
  | "MISSIONS_SUCCEEDED"
  | "MISSIONS_FAILED"
  | "REJECT_LIMIT"
  | "ASSASSINATION_HIT"
  | "ASSASSINATION_MISS";

export interface Outcome {
  readonly winner: "BLUE" | "RED";
  readonly reason: WinReason;
  readonly assassinatedSeat: number | null;
}

/** 引擎拒绝一个动作时的原因，会原样回给客户端 */
export type ErrorCode =
  | "WRONG_PHASE"
  | "NOT_YOUR_TURN"
  | "INVALID_SEAT"
  | "INVALID_TEAM_SIZE"
  | "DUPLICATE_TEAM_MEMBER"
  | "NOT_ON_TEAM"
  | "ALREADY_ACTED"
  | "ILLEGAL_CARD"
  | "INVALID_LADY_TARGET"
  | "EARLY_ASSASSINATION_UNAVAILABLE"
  | "GAME_OVER";

/** 一次性提示，用于前端播动画和音效。不含任何机密信息。 */
export type GameEvent =
  | { readonly type: "TEAM_PROPOSED"; readonly team: readonly number[] }
  | { readonly type: "VOTE_REVEALED"; readonly approved: boolean; readonly rejectStreak: number }
  | { readonly type: "MISSION_RESOLVED"; readonly success: boolean; readonly failCount: number }
  | { readonly type: "LOYALTY_FLIPPED"; readonly swapped: boolean; readonly hidden: boolean }
  | { readonly type: "LADY_PASSED"; readonly toSeat: number }
  | { readonly type: "ASSASSINATION_STARTED" }
  | { readonly type: "GAME_ENDED"; readonly outcome: Outcome };
