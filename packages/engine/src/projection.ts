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

import { TEAM_SIZE, type ClientGameView } from "@avalon/shared";
import { assassinSeat, canEarlyAssassinate, ladyTargets, missionCardRule } from "./machine.js";
import type { GameState } from "./types.js";

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
