/**
 * 视图裁剪 —— 全项目最关键的安全边界。CLAUDE.md 铁律 2、3。
 *
 * `GameState` 里有全部机密：每个人的角色、视野、每张任务牌是谁出的。
 * 客户端**只能**拿到 `projectFor(state, viewerSeat)` 的产物。
 *
 * 放在 engine 而不是 server，是因为它是纯函数 —— 这样单测能对
 * 「任意状态 × 任意观察者」穷举断言「序列化结果里不得出现他人机密」。
 * 前端"不显示"不等于安全，抓包就能看到。
 */

import { TEAM_SIZE, type RoleId, type Side } from "@avalon/shared";
import { assassinSeat, canEarlyAssassinate, ladyTargets, missionCardRule } from "./machine.js";
import type { GameState, Outcome, Phase, SpeakDirection } from "./types.js";
import type { Vision } from "./vision.js";
import type { MissionCardRule } from "@avalon/shared";

/** 揭票之前，只让人知道「谁投过了」，不知道投的什么 */
export interface PublicMissionSummary {
  readonly roundIndex: number;
  readonly leaderSeat: number;
  readonly team: readonly number[];
  readonly failCount: number;
  readonly failsRequired: 1 | 2;
  readonly success: boolean;
  // 刻意没有 cardsBySeat —— 铁律 3，这个映射永不下发
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

/** 只发给本人的部分 */
export interface SelfView {
  readonly seat: number;
  readonly roleId: RoleId;
  /** 当前阵营。兰斯洛特翻牌后会变，本人始终可见 */
  readonly side: Side;
  readonly vision: Vision;
  /** 本轮我能出的牌 */
  readonly missionCardRule: MissionCardRule;
  readonly isLeader: boolean;
  readonly isOnTeam: boolean;
  readonly myVote: boolean | null;
  readonly myCard: boolean | null;
  readonly canAssassinate: boolean;
  readonly canEarlyAssassinate: boolean;
  /** 我作为女神查验过的结果。别人的查验结果永远看不到 */
  readonly myLadyChecks: readonly { targetSeat: number; side: Side }[];
}

export interface LadyPublicView {
  readonly holderSeat: number;
  /** 谁当过女神是公开信息（决定了谁还能被查） */
  readonly formerHolders: readonly number[];
  readonly validTargets: readonly number[];
  /** 查了几次是公开的，查到什么不是 */
  readonly checks: readonly { afterRoundIndex: number; holderSeat: number; targetSeat: number }[];
}

export interface LoyaltyPublicView {
  readonly deckSize: number;
  readonly drawn: number;
  /** 房主选择隐藏结果时 swapped 为 null，全体只知道「翻了一张」 */
  readonly flips: readonly { afterRoundIndex: number | null; swapped: boolean | null }[];
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
  /** 只在揭票后有值 */
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

const seatsWhere = (flags: readonly unknown[], pred: (v: unknown) => boolean): number[] =>
  flags.flatMap((v, i) => (pred(v) ? [i] : []));

/**
 * 把对局状态裁剪成某个观察者能看到的视图。
 * @param viewerSeat 观战者传 null
 */
export const projectFor = (state: GameState, viewerSeat: number | null): ClientGameView => {
  const isOver = state.phase === "GAME_OVER";
  // 揭票只发生在 VOTE_RESULT；进下一阶段就收回，历史留在 proposals 里
  const votesRevealed = state.phase === "VOTE_RESULT";

  const view: ClientGameView = {
    phase: state.phase,
    playerCount: state.playerCount,
    roundIndex: state.roundIndex,
    leaderSeat: state.leaderSeat,
    attempt: state.attempt,
    rejectStreak: state.rejectStreak,
    teamSize: TEAM_SIZE[state.playerCount][state.roundIndex] ?? 0,

    team: state.team ? [...state.team] : null,
    speakDirection: state.speakDirection,

    votedSeats: seatsWhere(state.votes, (v) => v !== null),
    revealedVotes: votesRevealed ? (state.votes.map((v) => v === true) as boolean[]) : null,
    playedSeats: seatsWhere(state.cards, (v) => v !== null),
    ackedSeats: seatsWhere(state.roleAcked, (v) => v === true),

    proposals: state.proposals.map((p) => ({
      roundIndex: p.roundIndex,
      attempt: p.attempt,
      leaderSeat: p.leaderSeat,
      team: [...p.team],
      speakDirection: p.speakDirection,
      votes: [...p.votes],
      approved: p.approved,
    })),

    // 逐字段挑出去，而不是 {...m, cardsBySeat: undefined} ——
    // 后者一旦 MissionRecord 加了新机密字段就会自动泄漏
    missions: state.missions.map((m) => ({
      roundIndex: m.roundIndex,
      leaderSeat: m.leaderSeat,
      team: [...m.team],
      failCount: m.failCount,
      failsRequired: m.failsRequired,
      success: m.success,
    })),

    lady: state.lady
      ? {
          holderSeat: state.lady.holderSeat,
          formerHolders: [...state.lady.formerHolders],
          validTargets: ladyTargets(state),
          checks: state.lady.checks.map((c) => ({
            afterRoundIndex: c.afterRoundIndex,
            holderSeat: c.holderSeat,
            targetSeat: c.targetSeat,
            // revealedSide 只给查验人本人，见下面 me.myLadyChecks
          })),
        }
      : null,

    loyalty: state.loyalty
      ? {
          deckSize: state.loyalty.deck.length,
          drawn: state.loyalty.drawn,
          flips: state.loyalty.flips.map((f) => ({
            afterRoundIndex: f.afterRoundIndex,
            swapped: state.settings.hideLoyaltyFlipResult ? null : f.swapped,
          })),
        }
      : null,

    outcome: state.outcome,
    reveal: isOver ? [...state.roles] : null,

    me: null,
  };

  if (viewerSeat === null) return view;

  const roleId = state.roles[viewerSeat];
  const side = state.sides[viewerSeat];
  const vision = state.vision[viewerSeat];
  if (roleId === undefined || side === undefined || vision === undefined) return view;

  return {
    ...view,
    me: {
      seat: viewerSeat,
      roleId,
      side,
      vision,
      missionCardRule: missionCardRule(state, viewerSeat),
      isLeader: state.leaderSeat === viewerSeat,
      isOnTeam: state.team?.includes(viewerSeat) ?? false,
      myVote: state.votes[viewerSeat] ?? null,
      myCard: state.cards[viewerSeat] ?? null,
      canAssassinate: state.phase === "ASSASSINATION" && assassinSeat(state) === viewerSeat,
      canEarlyAssassinate:
        canEarlyAssassinate(state) && assassinSeat(state) === viewerSeat,
      myLadyChecks:
        state.lady?.checks
          .filter((c) => c.holderSeat === viewerSeat)
          .map((c) => ({ targetSeat: c.targetSeat, side: c.revealedSide })) ?? [],
    },
  };
};
