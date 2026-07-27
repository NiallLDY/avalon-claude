/**
 * 客户端视图类型 —— 服务端 `projectFor()` 的产物，也是唯一会经过网线的对局数据。
 *
 * 这里出现的每一个字段都要能回答：**这个字段能被所有人看到吗？**
 * 只属于本人的东西一律放进 `me`，别处不许有。
 */

import type { MissionCardRule, RoleId, Side } from "./roles.js";
import type { Outcome, Phase, SpeakDirection, Vision } from "./game.js";

/** 任务结果。刻意没有「谁出了哪张牌」—— CLAUDE.md 铁律 3 */
export interface PublicMissionSummary {
  readonly roundIndex: number;
  readonly leaderSeat: number;
  readonly team: readonly number[];
  readonly failCount: number;
  readonly failsRequired: 1 | 2;
  readonly success: boolean;
}

export interface PublicProposal {
  readonly roundIndex: number;
  readonly attempt: number;
  readonly leaderSeat: number;
  readonly team: readonly number[];
  readonly speakDirection: SpeakDirection | null;
  readonly votes: readonly boolean[];
  readonly approved: boolean;
}

export interface LadyPublicView {
  readonly holderSeat: number;
  /** 谁当过女神是公开的（决定了谁还能被查），查到什么不是 */
  readonly formerHolders: readonly number[];
  readonly validTargets: readonly number[];
  readonly checks: readonly {
    readonly afterRoundIndex: number;
    readonly holderSeat: number;
    readonly targetSeat: number;
  }[];
}

export interface LoyaltyPublicView {
  readonly deckSize: number;
  readonly drawn: number;
  /** 房主选择隐藏结果时 swapped 为 null，全体只知道「翻了一张」 */
  readonly flips: readonly {
    readonly afterRoundIndex: number | null;
    readonly swapped: boolean | null;
  }[];
}

/** 只发给本人的部分 */
export interface SelfView {
  readonly seat: number;
  readonly roleId: RoleId;
  /** 当前阵营。兰斯洛特翻牌后会变，本人始终可见 */
  readonly side: Side;
  readonly vision: Vision;
  readonly missionCardRule: MissionCardRule;
  readonly isLeader: boolean;
  readonly isOnTeam: boolean;
  readonly myVote: boolean | null;
  readonly myCard: boolean | null;
  readonly canAssassinate: boolean;
  readonly canEarlyAssassinate: boolean;
  /** 我作为女神查验过的结果。别人查到什么永远看不到 */
  readonly myLadyChecks: readonly { readonly targetSeat: number; readonly side: Side }[];
}

export interface ClientGameView {
  readonly phase: Phase;
  readonly playerCount: number;
  readonly roundIndex: number;
  readonly leaderSeat: number;
  readonly attempt: number;
  readonly rejectStreak: number;
  /** 本轮需要的上车人数 */
  readonly teamSize: number;

  readonly team: readonly number[] | null;
  readonly speakDirection: SpeakDirection | null;

  /** 谁已经投过票了（不含投的内容） */
  readonly votedSeats: readonly number[];
  /** 只在揭票阶段有值 */
  readonly revealedVotes: readonly boolean[] | null;
  /** 谁已经出过任务牌了（不含牌面） */
  readonly playedSeats: readonly number[];
  readonly ackedSeats: readonly number[];

  readonly proposals: readonly PublicProposal[];
  readonly missions: readonly PublicMissionSummary[];

  readonly lady: LadyPublicView | null;
  readonly loyalty: LoyaltyPublicView | null;

  readonly outcome: Outcome | null;
  /** 终局才揭晓的全员身份。非终局恒为 null */
  readonly reveal: readonly RoleId[] | null;

  /** 观战者为 null */
  readonly me: SelfView | null;
}
