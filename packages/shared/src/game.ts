/**
 * 前后端共用的对局类型。
 *
 * 划分原则：**客户端看得到的东西住这里**，服务端独有的机密状态
 * （`GameState`、每张任务牌是谁出的、每个人的角色）住 `@avalon/engine`。
 * 这样 `apps/web` 只依赖 shared，不依赖规则引擎 —— 引擎代码永远不会被打进前端包。
 */

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
