/**
 * 对局状态与动作的类型定义。GAME.md §6
 *
 * 约定：
 *   - 所有字段 readonly，reduce 永远返回新对象，不原地改
 *   - 座位号 seatIndex ∈ [0, playerCount)，环形顺时针
 *   - 状态里**包含全部机密信息**（角色、视野、每张任务牌是谁出的）。
 *     裁剪成各人可见视图是服务端 projection 层的事，引擎不管。
 */

import type { PlayerCount, RoleId, Side } from "@avalon/shared";
import type { Vision } from "./vision.js";
import type { GameMode } from "./setup.js";

export type Phase =
  /** 发牌，等待各人点「我已看牌」 */
  | "ROLE_REVEAL"
  /** 翻忠诚牌（兰斯洛特模式） */
  | "LOYALTY_FLIP"
  /** 队长选人 */
  | "TEAM_BUILD"
  /** 全员投票 */
  | "VOTE"
  /** 同时揭票，等待推进 */
  | "VOTE_RESULT"
  /** 队员出任务牌 */
  | "MISSION"
  /** 公开失败牌数，等待推进 */
  | "MISSION_RESULT"
  /** 湖中女神查验 */
  | "LADY_OF_LAKE"
  /** 刺杀 */
  | "ASSASSINATION"
  | "GAME_OVER";

export type SpeakDirection = "CW" | "CCW";

export interface GameSettings {
  readonly mode: GameMode;
  readonly ladyOfTheLake: boolean;
  readonly earlyAssassination: boolean;
  /** 顺位传递 or 每次重新随机 */
  readonly leaderRotation: "CLOCKWISE" | "RANDOM";
  /** 轮内连续（官方，Q1 已定）or 全局累计 */
  readonly rejectCounting: "PER_ROUND" | "GLOBAL";
  readonly loyaltyFlipTiming: "NORMAL" | "OPENING";
  readonly loyaltySwapChance: number;
  /** 隐藏翻牌结果时，全体只知道「翻了一张」；兰斯洛特本人始终能看到自己当前阵营 */
  readonly hideLoyaltyFlipResult: boolean;
}

/** 一次组队提名的完整记录（复盘用） */
export interface ProposalRecord {
  readonly roundIndex: number;
  /** 本轮第几次提名，从 0 开始 */
  readonly attempt: number;
  readonly leaderSeat: number;
  readonly team: readonly number[];
  readonly speakDirection: SpeakDirection | null;
  /** seatIndex -> 赞成 */
  readonly votes: readonly boolean[];
  readonly approved: boolean;
}

export interface MissionRecord {
  readonly roundIndex: number;
  readonly leaderSeat: number;
  readonly team: readonly number[];
  readonly failCount: number;
  readonly failsRequired: 1 | 2;
  readonly success: boolean;
  /**
   * 每张牌是谁出的。**永不下发到客户端**（CLAUDE.md 铁律 3）。
   * 留在引擎里是为了单测能验「服务端强制的出牌约束」确实生效。
   */
  readonly cardsBySeat: Readonly<Record<number, boolean>>;
}

export interface LoyaltyFlipRecord {
  /** 开局翻牌时为 null */
  readonly afterRoundIndex: number | null;
  /** true = 阵营转换 */
  readonly swapped: boolean;
}

export interface LoyaltyState {
  /** 预生成的牌堆，true = 阵营转换。发牌时一次性定好，翻牌只是揭开 */
  readonly deck: readonly boolean[];
  readonly drawn: number;
  readonly flips: readonly LoyaltyFlipRecord[];
}

export interface LadyCheckRecord {
  readonly afterRoundIndex: number;
  readonly holderSeat: number;
  readonly targetSeat: number;
  /** 查验当刻的真实阵营。只有当代女神可见 */
  readonly revealedSide: Side;
}

export interface LadyState {
  readonly holderSeat: number;
  /** 当过女神的人不能再被查验（含自己） */
  readonly formerHolders: readonly number[];
  readonly checks: readonly LadyCheckRecord[];
}

export type WinReason =
  /** 3 次任务成功且刺杀未中 */
  | "MISSIONS_SUCCEEDED"
  /** 3 次任务失败 */
  | "MISSIONS_FAILED"
  /** 连续 5 次流局 */
  | "REJECT_LIMIT"
  /** 刺杀命中梅林 */
  | "ASSASSINATION_HIT"
  /** 刺杀落空（提前刺杀失败时红方立即判负） */
  | "ASSASSINATION_MISS";

export interface Outcome {
  readonly winner: Side;
  readonly reason: WinReason;
  /** 刺杀发生过才有 */
  readonly assassinatedSeat: number | null;
}

export interface GameState {
  readonly playerCount: PlayerCount;
  readonly settings: GameSettings;
  readonly phase: Phase;

  /** 发牌结果，全局冻结 */
  readonly roles: readonly RoleId[];
  /** 当前阵营。只有兰斯洛特会变 */
  readonly sides: readonly Side[];
  /** 开局冻结的视野，不随阵营转换更新 */
  readonly vision: readonly Vision[];
  readonly roleAcked: readonly boolean[];

  readonly roundIndex: number;
  readonly leaderSeat: number;
  /** 本轮已提名次数，用于 ProposalRecord.attempt */
  readonly attempt: number;
  /** 连续否决数。Q1：通过即清零 */
  readonly rejectStreak: number;

  /** 当前提名的队伍，TEAM_BUILD 阶段为 null */
  readonly team: readonly number[] | null;
  readonly speakDirection: SpeakDirection | null;
  /** seatIndex -> 赞成/反对/未投。投票阶段外全为 null */
  readonly votes: readonly (boolean | null)[];
  /** seatIndex -> 任务牌，非队员为 null */
  readonly cards: readonly (boolean | null)[];

  readonly proposals: readonly ProposalRecord[];
  readonly missions: readonly MissionRecord[];

  readonly loyalty: LoyaltyState | null;
  readonly lady: LadyState | null;
  readonly earlyAssassinationUsed: boolean;

  /** 任务结算后待办事项，见 GAME.md §6.7 的固定顺序 */
  readonly pendingLoyaltyFlip: boolean;
  readonly pendingLadyCheck: boolean;

  readonly outcome: Outcome | null;
}

export type Action =
  | { readonly type: "ACK_ROLE"; readonly seat: number }
  | { readonly type: "PROPOSE_TEAM"; readonly seat: number; readonly team: readonly number[]; readonly speakDirection: SpeakDirection | null }
  | { readonly type: "VOTE"; readonly seat: number; readonly approve: boolean }
  | { readonly type: "PLAY_CARD"; readonly seat: number; readonly success: boolean }
  | { readonly type: "LADY_CHECK"; readonly seat: number; readonly targetSeat: number }
  | { readonly type: "EARLY_ASSASSINATE"; readonly seat: number }
  | { readonly type: "ASSASSINATE"; readonly seat: number; readonly targetSeat: number }
  /** 推进过渡阶段（揭票 / 任务结果 / 翻牌动画）。房主也用它强制跳过 ROLE_REVEAL */
  | { readonly type: "ADVANCE"; readonly byHost?: boolean };

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

/** 一次性提示，用于前端播动画/音效。不含任何机密信息。 */
export type GameEvent =
  | { readonly type: "ROLES_DEALT" }
  | { readonly type: "TEAM_PROPOSED"; readonly team: readonly number[] }
  | { readonly type: "VOTE_REVEALED"; readonly approved: boolean; readonly rejectStreak: number }
  | { readonly type: "MISSION_RESOLVED"; readonly success: boolean; readonly failCount: number }
  | { readonly type: "LOYALTY_FLIPPED"; readonly swapped: boolean; readonly hidden: boolean }
  | { readonly type: "LADY_PASSED"; readonly toSeat: number }
  | { readonly type: "ASSASSINATION_STARTED" }
  | { readonly type: "GAME_ENDED"; readonly outcome: Outcome };

export type ReduceResult =
  | { readonly ok: true; readonly state: GameState; readonly events: readonly GameEvent[] }
  | { readonly ok: false; readonly error: ErrorCode };

export type { PlayerCount, RoleId, Side, Vision, GameMode };
