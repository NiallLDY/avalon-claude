/**
 * 引擎独有的类型 —— 只有服务端持有的机密状态。
 * 客户端也要用的类型（Phase / GameSettings / Vision / Outcome / ClientGameView …）
 * 住在 `@avalon/shared`，见那边的 game.ts 与 view.ts。
 *
 * 约定：
 *   - 所有字段 readonly，reduce 永远返回新对象，不原地改
 *   - 座位号 seatIndex ∈ [0, playerCount)，环形顺时针
 *   - `GameState` **包含全部机密**（角色、视野、每张任务牌是谁出的），
 *     裁剪成各人可见视图是 projection.ts 的事
 */

import type {
  ChatMessage,
  ErrorCode,
  GameEvent,
  GameSettings,
  Outcome,
  Phase,
  PlayerCount,
  RoleId,
  Side,
  SpeakDirection,
  Vision,
} from "@avalon/shared";

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
   * 每张牌是谁出的。**永不下发到客户端**（CLAUDE.md 铁律 3），终局也不行。
   * 留在服务端内存里只为一件事：单测能验「出牌约束确实生效」。
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
  /**
   * 两个频道的聊天记录，按时间混在一起存。
   * **裁剪在 `projectFor`**：`EVIL` 那些只发给 `evilChatSeats` 里的人。
   */
  readonly chat: readonly ChatMessage[];

  readonly roundIndex: number;
  readonly leaderSeat: number;
  /** 本轮已提名次数 */
  readonly attempt: number;
  /** 连续否决数。Q1：通过即清零 */
  readonly rejectStreak: number;

  /** 当前提名的队伍，组队阶段为 null */
  readonly team: readonly number[] | null;
  readonly speakDirection: SpeakDirection | null;
  /** seatIndex -> 赞成/反对/未投 */
  readonly votes: readonly (boolean | null)[];
  /** seatIndex -> 任务牌，非队员为 null */
  readonly cards: readonly (boolean | null)[];

  readonly proposals: readonly ProposalRecord[];
  readonly missions: readonly MissionRecord[];

  readonly loyalty: LoyaltyState | null;
  readonly lady: LadyState | null;
  readonly earlyAssassinationUsed: boolean;

  /** 任务结算后的待办，见 GAME.md §6.7 的固定顺序 */
  readonly pendingLoyaltyFlip: boolean;
  readonly pendingLadyCheck: boolean;

  readonly outcome: Outcome | null;
}

/**
 * 引擎动作。
 *
 * 注意 `seat` 字段：**客户端发来的消息里没有这个字段**，
 * 由服务端根据连接身份填入（apps/server/src/socket.ts）。
 * 让客户端自报座位等于把所有权限校验都送出去。
 */
export type Action =
  | { readonly type: "ACK_ROLE"; readonly seat: number }
  | {
      readonly type: "PROPOSE_TEAM";
      readonly seat: number;
      readonly team: readonly number[];
      readonly speakDirection: SpeakDirection | null;
    }
  | { readonly type: "VOTE"; readonly seat: number; readonly approve: boolean }
  | { readonly type: "PLAY_CARD"; readonly seat: number; readonly success: boolean }
  | { readonly type: "LADY_CHECK"; readonly seat: number; readonly targetSeat: number }
  | { readonly type: "EARLY_ASSASSINATE"; readonly seat: number }
  | { readonly type: "ASSASSINATE"; readonly seat: number; readonly targetSeat: number }
  /** 推进过渡阶段。房主用 byHost 强制跳过没看完牌的人 */
  | { readonly type: "ADVANCE"; readonly byHost?: boolean };

export type ReduceResult =
  | { readonly ok: true; readonly state: GameState; readonly events: readonly GameEvent[] }
  | { readonly ok: false; readonly error: ErrorCode };
