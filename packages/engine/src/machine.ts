/**
 * 对局状态机。GAME.md §6 §7 §8 §9 §10
 *
 * 唯一入口是 `reduce(state, action, rng)`：纯函数，非法动作返回 error 而不抛异常
 * （服务端要把 error code 回给客户端，抛异常不好用）。
 *
 * 铁律（CLAUDE.md 7）：这里不许出现 Date.now() / Math.random() / 任何 I/O。
 */

import {
  ASSASSIN_ROLE_BY_MODE,
  LADY_CHECK_AFTER_ROUNDS,
  LOYALTY_FLIP_SCHEDULE,
  MISSIONS_TO_WIN,
  REJECT_LIMIT,
  ROLES,
  TEAM_SIZE,
  failsRequired,
  type ErrorCode,
  CHAT_TEXT_MAX,
  CHAT_HISTORY_MAX,
  sanitizeText,
  type ChatChannel,
  type ChatMessage,
  type GameEvent,
  type GameSettings,
  type MissionCardRule,
  type Outcome,
  type PlayerCount,
  type RoleId,
  type Side,
} from "@avalon/shared";
import { shuffle, type Rng } from "./rng.js";
import { dealRoles, initialSides } from "./setup.js";
import { computeVision, evilChatSeats } from "./vision.js";
import type { Action, GameState, ReduceResult } from "./types.js";

// ──────────────────────────── 小工具 ────────────────────────────

const fail = (error: ErrorCode): ReduceResult => ({ ok: false, error });
const done = (state: GameState, events: readonly GameEvent[] = []): ReduceResult => ({
  ok: true,
  state,
  events,
});

const inRange = (seat: number, playerCount: number): boolean =>
  Number.isInteger(seat) && seat >= 0 && seat < playerCount;

const successCount = (s: GameState): number => s.missions.filter((m) => m.success).length;
const failCount = (s: GameState): number => s.missions.length - successCount(s);

/** 达成任务线即视为「胜负已分」，后续的女神查验要跳过（Q2） */
const missionsDecided = (s: GameState): boolean =>
  successCount(s) >= MISSIONS_TO_WIN || failCount(s) >= MISSIONS_TO_WIN;

/** 执行刺杀的座位：标准模式是刺客，兰斯洛特模式是莫甘娜 */
export const assassinSeat = (s: GameState): number =>
  s.roles.indexOf(ASSASSIN_ROLE_BY_MODE[s.settings.mode]);

/**
 * 某座位当前允许出的任务牌。
 * 注意兰斯洛特看的是**当前阵营**而非角色牌 —— 翻牌换阵营后出牌约束跟着变（GAME.md §8.4）。
 */
export const missionCardRule = (s: GameState, seat: number): MissionCardRule => {
  const roleId = s.roles[seat]!;
  if (ROLES[roleId].isLancelot) {
    return s.sides[seat] === "BLUE" ? "SUCCESS_ONLY" : "FAIL_ONLY";
  }
  return ROLES[roleId].missionCard;
};

const nextLeader = (s: GameState, rng: Rng): number => {
  if (s.settings.leaderRotation === "RANDOM") {
    // 不重复上一任：在剩下的 n-1 个座位里选，再映射回真实座位号
    const pick = rng.int(s.playerCount - 1);
    return pick >= s.leaderSeat ? pick + 1 : pick;
  }
  return (s.leaderSeat + 1) % s.playerCount;
};

/** 湖中女神的合法查验目标：没当过女神的人（GAME.md §9） */
export const ladyTargets = (s: GameState): readonly number[] => {
  if (!s.lady) return [];
  const held = new Set(s.lady.formerHolders);
  return Array.from({ length: s.playerCount }, (_, i) => i).filter((i) => !held.has(i));
};

/** 提前刺杀是否已解锁（Q3：完成 2 次任务执行后，流局不计） */
export const canEarlyAssassinate = (s: GameState): boolean =>
  s.settings.earlyAssassination &&
  !s.earlyAssassinationUsed &&
  s.missions.length >= 2 &&
  s.phase !== "ROLE_REVEAL" &&
  s.phase !== "ASSASSINATION" &&
  s.phase !== "GAME_OVER";

// ──────────────────────────── 开局 ────────────────────────────

export interface CreateGameOptions {
  readonly playerCount: PlayerCount;
  readonly settings: GameSettings;
  /** 不给就随机 */
  readonly firstLeaderSeat?: number;
}

/**
 * 预生成忠诚牌堆 —— 官方那副**固定构成**的牌，洗好之后取会翻到的那几张。
 *
 * 常规是 5 张里翻 3 张（剩下 2 张永远不揭），开局是 7 张里发 5 张。
 * 所以：一局最多换 2 次，且已翻的牌会改变后面的概率。
 *
 * 随机源只在开局注入一次，翻牌本身是纯揭开，复盘可完整重放。
 */
const buildLoyaltyDeck = (
  timing: GameSettings["loyaltyFlipTiming"],
  rng: Rng,
): boolean[] => {
  const { blanks, swaps, maxFlips } = LOYALTY_FLIP_SCHEDULE[timing];
  const deck = [
    ...Array.from({ length: swaps }, () => true),
    ...Array.from({ length: blanks }, () => false),
  ];
  return shuffle(deck, rng).slice(0, maxFlips);
};

export const createGame = (opts: CreateGameOptions, rng: Rng): GameState => {
  const { playerCount, settings } = opts;
  const roles = dealRoles(playerCount, settings.mode, rng);
  const leaderSeat = opts.firstLeaderSeat ?? rng.int(playerCount);

  const schedule = LOYALTY_FLIP_SCHEDULE[settings.loyaltyFlipTiming];
  const isLancelot = settings.mode === "LANCELOT";

  return {
    playerCount,
    settings,
    phase: "ROLE_REVEAL",
    roles,
    sides: initialSides(roles),
    vision: computeVision(roles, rng, settings),
    roleAcked: roles.map(() => false),
    chat: [],
    roundIndex: 0,
    leaderSeat,
    attempt: 0,
    rejectStreak: 0,
    team: null,
    speakDirection: null,
    votes: roles.map(() => null),
    cards: roles.map(() => null),
    proposals: [],
    missions: [],
    loyalty: isLancelot
      ? {
          deck: buildLoyaltyDeck(settings.loyaltyFlipTiming, rng),
          drawn: 0,
          flips: [],
        }
      : null,
    lady: settings.ladyOfTheLake
      ? {
          // 第一代女神 = 首任队长的上一位（座位逆时针相邻）
          holderSeat: (leaderSeat - 1 + playerCount) % playerCount,
          formerHolders: [(leaderSeat - 1 + playerCount) % playerCount],
          checks: [],
        }
      : null,
    earlyAssassinationUsed: false,
    pendingLoyaltyFlip: isLancelot && schedule.beforeFirstMission,
    pendingLadyCheck: false,
    outcome: null,
  };
};

// ──────────────────────────── 阶段推进 ────────────────────────────

const endGame = (s: GameState, outcome: Outcome): ReduceResult =>
  done({ ...s, phase: "GAME_OVER", outcome }, [{ type: "GAME_ENDED", outcome }]);

/** 翻一张忠诚牌并立即结算阵营转换。进入 LOYALTY_FLIP 阶段时调用。 */
const enterLoyaltyFlip = (s: GameState, afterRoundIndex: number | null): ReduceResult => {
  const loyalty = s.loyalty;
  if (!loyalty || loyalty.drawn >= loyalty.deck.length) {
    // 牌堆空了就当没这回事，直接走下一步
    return advancePostMission({ ...s, pendingLoyaltyFlip: false });
  }

  const swapped = loyalty.deck[loyalty.drawn]!;
  const sides = swapped
    ? s.sides.map((side, seat) =>
        ROLES[s.roles[seat]!].isLancelot ? (side === "BLUE" ? "RED" : "BLUE") : side,
      )
    : s.sides;

  return done(
    {
      ...s,
      phase: "LOYALTY_FLIP",
      sides,
      loyalty: {
        ...loyalty,
        drawn: loyalty.drawn + 1,
        flips: [...loyalty.flips, { afterRoundIndex, swapped }],
      },
      pendingLoyaltyFlip: false,
    },
    [
      {
        type: "LOYALTY_FLIPPED",
        swapped,
        hidden: s.settings.hideLoyaltyFlipResult,
      },
    ],
  );
};

/** 开一轮新的组队。轮内连续计数在此清零。 */
const startRound = (s: GameState, roundIndex: number, leaderSeat: number): GameState => ({
  ...s,
  phase: "TEAM_BUILD",
  roundIndex,
  leaderSeat,
  attempt: 0,
  rejectStreak: s.settings.rejectCounting === "PER_ROUND" ? 0 : s.rejectStreak,
  team: null,
  speakDirection: null,
  votes: s.votes.map(() => null),
  cards: s.cards.map(() => null),
});

/**
 * 任务结算之后的固定顺序（GAME.md §6.7）：
 *   忠诚牌 → 湖中女神 → 判胜负 → 下一轮
 * 每一步消费掉自己的 pending 标记，然后递归进入下一步。
 */
const advancePostMission = (s: GameState, rng?: Rng): ReduceResult => {
  if (s.pendingLoyaltyFlip) {
    return enterLoyaltyFlip(s, s.missions.length > 0 ? s.roundIndex : null);
  }

  const decided = missionsDecided(s);

  // 胜负已分时跳过女神查验（Q2）；忠诚牌不跳，它决定最终阵营归属
  if (s.pendingLadyCheck && !decided) {
    if (ladyTargets(s).length === 0) {
      // 无合法目标，跳过本次查验
      return advancePostMission({ ...s, pendingLadyCheck: false }, rng);
    }
    return done({ ...s, phase: "LADY_OF_LAKE", pendingLadyCheck: false });
  }

  if (successCount(s) >= MISSIONS_TO_WIN) {
    return done({ ...s, phase: "ASSASSINATION", pendingLadyCheck: false }, [
      { type: "ASSASSINATION_STARTED" },
    ]);
  }

  if (failCount(s) >= MISSIONS_TO_WIN) {
    return endGame(s, {
      winner: "RED",
      reason: "MISSIONS_FAILED",
      assassinatedSeat: null,
    });
  }

  // 开局翻牌走的也是这条路，但那时本轮任务还没打过 —— 不能把轮次推掉，
  // 否则第 1 轮任务直接被跳过。只有本轮确实结算过任务才进下一轮。
  if (s.missions.at(-1)?.roundIndex !== s.roundIndex) {
    return done({ ...s, phase: "TEAM_BUILD" });
  }

  const leader = rng ? nextLeader(s, rng) : (s.leaderSeat + 1) % s.playerCount;
  return done(startRound(s, s.roundIndex + 1, leader));
};

/** 离开发牌阶段。开局翻牌模式会先翻一张。 */
const leaveRoleReveal = (s: GameState): ReduceResult => {
  if (s.pendingLoyaltyFlip) return enterLoyaltyFlip(s, null);
  return done({ ...s, phase: "TEAM_BUILD" });
};

// ──────────────────────────── reduce ────────────────────────────

export const reduce = (state: GameState, action: Action, rng: Rng): ReduceResult => {
  if (state.phase === "GAME_OVER") return fail("GAME_OVER");

  switch (action.type) {
    case "ACK_ROLE": {
      if (state.phase !== "ROLE_REVEAL") return fail("WRONG_PHASE");
      if (!inRange(action.seat, state.playerCount)) return fail("INVALID_SEAT");
      if (state.roleAcked[action.seat]) return fail("ALREADY_ACTED");

      const roleAcked = state.roleAcked.map((v, i) => (i === action.seat ? true : v));
      const next = { ...state, roleAcked };
      return roleAcked.every(Boolean) ? leaveRoleReveal(next) : done(next);
    }

    case "PROPOSE_TEAM": {
      if (state.phase !== "TEAM_BUILD") return fail("WRONG_PHASE");
      if (action.seat !== state.leaderSeat) return fail("NOT_YOUR_TURN");

      const required = TEAM_SIZE[state.playerCount][state.roundIndex];
      if (required === undefined || action.team.length !== required) {
        return fail("INVALID_TEAM_SIZE");
      }
      if (new Set(action.team).size !== action.team.length) {
        return fail("DUPLICATE_TEAM_MEMBER");
      }
      if (!action.team.every((s) => inRange(s, state.playerCount))) {
        return fail("INVALID_SEAT");
      }

      return done(
        {
          ...state,
          phase: "VOTE",
          team: [...action.team],
          speakDirection: action.speakDirection,
          votes: state.votes.map(() => null),
        },
        [{ type: "TEAM_PROPOSED", team: [...action.team] }],
      );
    }

    case "VOTE": {
      if (state.phase !== "VOTE") return fail("WRONG_PHASE");
      if (!inRange(action.seat, state.playerCount)) return fail("INVALID_SEAT");
      if (state.votes[action.seat] !== null) return fail("ALREADY_ACTED");

      const votes = state.votes.map((v, i) => (i === action.seat ? action.approve : v));
      if (votes.some((v) => v === null)) return done({ ...state, votes });

      // 全员投完 —— 同时揭票
      const finalVotes = votes as readonly boolean[];
      const approvals = finalVotes.filter(Boolean).length;
      // 严格过半，没有弃权
      const approved = approvals * 2 > state.playerCount;

      const rejectStreak = approved
        ? state.settings.rejectCounting === "PER_ROUND"
          ? 0
          : state.rejectStreak
        : state.rejectStreak + 1;

      return done(
        {
          ...state,
          phase: "VOTE_RESULT",
          votes,
          rejectStreak,
          proposals: [
            ...state.proposals,
            {
              roundIndex: state.roundIndex,
              attempt: state.attempt,
              leaderSeat: state.leaderSeat,
              team: state.team ?? [],
              speakDirection: state.speakDirection,
              votes: [...finalVotes],
              approved,
            },
          ],
        },
        [{ type: "VOTE_REVEALED", approved, rejectStreak }],
      );
    }

    case "PLAY_CARD": {
      if (state.phase !== "MISSION") return fail("WRONG_PHASE");
      if (!inRange(action.seat, state.playerCount)) return fail("INVALID_SEAT");
      if (!state.team?.includes(action.seat)) return fail("NOT_ON_TEAM");
      if (state.cards[action.seat] !== null) return fail("ALREADY_ACTED");

      // 服务端强制出牌约束 —— 前端不给按钮不等于安全
      const rule = missionCardRule(state, action.seat);
      if (rule === "SUCCESS_ONLY" && !action.success) return fail("ILLEGAL_CARD");
      if (rule === "FAIL_ONLY" && action.success) return fail("ILLEGAL_CARD");

      const cards = state.cards.map((c, i) => (i === action.seat ? action.success : c));
      const team = state.team;
      if (team.some((s) => cards[s] === null)) return done({ ...state, cards });

      // 全员出完 —— 结算
      const fails = team.filter((s) => cards[s] === false).length;
      const required = failsRequired(state.playerCount, state.roundIndex);
      const success = fails < required;

      const cardsBySeat: Record<number, boolean> = {};
      for (const s of team) cardsBySeat[s] = cards[s]!;

      const schedule = LOYALTY_FLIP_SCHEDULE[state.settings.loyaltyFlipTiming];
      const loyaltyLeft = state.loyalty
        ? state.loyalty.drawn < state.loyalty.deck.length
        : false;

      return done(
        {
          ...state,
          phase: "MISSION_RESULT",
          cards,
          missions: [
            ...state.missions,
            {
              roundIndex: state.roundIndex,
              leaderSeat: state.leaderSeat,
              team: [...team],
              failCount: fails,
              failsRequired: required,
              success,
              cardsBySeat,
            },
          ],
          pendingLoyaltyFlip:
            state.settings.mode === "LANCELOT" &&
            loyaltyLeft &&
            (schedule.afterRounds as readonly number[]).includes(state.roundIndex),
          pendingLadyCheck:
            state.settings.ladyOfTheLake &&
            (LADY_CHECK_AFTER_ROUNDS as readonly number[]).includes(state.roundIndex),
        },
        [{ type: "MISSION_RESOLVED", success, failCount: fails }],
      );
    }

    case "LADY_CHECK": {
      if (state.phase !== "LADY_OF_LAKE") return fail("WRONG_PHASE");
      if (!state.lady) return fail("WRONG_PHASE");
      if (action.seat !== state.lady.holderSeat) return fail("NOT_YOUR_TURN");
      if (!ladyTargets(state).includes(action.targetSeat)) {
        return fail("INVALID_LADY_TARGET");
      }

      // 查验当刻的真实阵营 —— 兰斯洛特换过阵营就按换后的算
      const revealedSide: Side = state.sides[action.targetSeat]!;
      const withCheck: GameState = {
        ...state,
        lady: {
          holderSeat: action.targetSeat,
          formerHolders: [...state.lady.formerHolders, action.targetSeat],
          checks: [
            ...state.lady.checks,
            {
              afterRoundIndex: state.roundIndex,
              holderSeat: action.seat,
              targetSeat: action.targetSeat,
              revealedSide,
            },
          ],
        },
      };

      const result = advancePostMission(withCheck, rng);
      if (!result.ok) return result;
      return done(result.state, [
        { type: "LADY_PASSED", toSeat: action.targetSeat },
        ...result.events,
      ]);
    }

    case "EARLY_ASSASSINATE": {
      if (!canEarlyAssassinate(state)) return fail("EARLY_ASSASSINATION_UNAVAILABLE");
      if (action.seat !== assassinSeat(state)) return fail("NOT_YOUR_TURN");

      return done({ ...state, phase: "ASSASSINATION", earlyAssassinationUsed: true }, [
        { type: "ASSASSINATION_STARTED" },
      ]);
    }

    case "ASSASSINATE": {
      if (state.phase !== "ASSASSINATION") return fail("WRONG_PHASE");
      if (action.seat !== assassinSeat(state)) return fail("NOT_YOUR_TURN");
      if (!inRange(action.targetSeat, state.playerCount)) return fail("INVALID_SEAT");
      if (action.targetSeat === action.seat) return fail("INVALID_SEAT");

      const hit = state.roles[action.targetSeat] === ("MERLIN" satisfies RoleId);
      if (hit) {
        return endGame(state, {
          winner: "RED",
          reason: "ASSASSINATION_HIT",
          assassinatedSeat: action.targetSeat,
        });
      }

      // 提前刺杀落空 → 红方立即判负；常规刺杀落空 → 蓝方按任务线获胜
      const isEarly = successCount(state) < MISSIONS_TO_WIN;
      return endGame(state, {
        winner: "BLUE",
        reason: isEarly ? "ASSASSINATION_MISS" : "MISSIONS_SUCCEEDED",
        assassinatedSeat: action.targetSeat,
      });
    }

    case "ADVANCE": {
      switch (state.phase) {
        case "ROLE_REVEAL":
          // 只有房主能强制跳过没看完牌的人
          if (!action.byHost) return fail("NOT_YOUR_TURN");
          return leaveRoleReveal(state);

        case "VOTE_RESULT": {
          const last = state.proposals.at(-1);
          if (last?.approved) {
            return done({
              ...state,
              phase: "MISSION",
              cards: state.cards.map(() => null),
            });
          }
          if (state.rejectStreak >= REJECT_LIMIT) {
            return endGame(state, {
              winner: "RED",
              reason: "REJECT_LIMIT",
              assassinatedSeat: null,
            });
          }
          return done({
            ...state,
            phase: "TEAM_BUILD",
            attempt: state.attempt + 1,
            leaderSeat: nextLeader(state, rng),
            team: null,
            speakDirection: null,
            votes: state.votes.map(() => null),
          });
        }

        case "MISSION_RESULT":
        case "LOYALTY_FLIP":
          return advancePostMission(state, rng);

        default:
          return fail("WRONG_PHASE");
      }
    }
  }
};

// ──────────────────────────── 聊天 ────────────────────────────

/**
 * 追加一条聊天。**不走 reduce** —— 它不改变任何规则状态，
 * 也不该受阶段限制（看牌时、终局后都能说话）。
 *
 * 但**成员判定必须留在引擎里**：谁能往队友频道发，和谁能读它是同一条规则
 * （`evilChatSeats`），拆到服务端就迟早会出现两套判据。不允许时返回 null，
 * 调用方静默丢弃 —— 回一个「你不在这个频道」等于给探测者一个神谕。
 */
export const appendChat = (
  state: GameState,
  msg: { readonly seat: number; readonly channel: ChatChannel; readonly text: string; readonly at: number },
): GameState | null => {
  const text = sanitizeText(msg.text, CHAT_TEXT_MAX);
  if (!text) return null;
  if (msg.seat < 0 || msg.seat >= state.playerCount) return null;
  if (msg.channel === "EVIL" && !evilChatSeats(state.roles).includes(msg.seat)) return null;

  // 旧版本快照没有 chat；恢复后的第一条消息从空记录开始即可。
  const chat = state.chat ?? [];
  const next: ChatMessage = {
    // 递增的 id 由长度推不出来（会截断），拿最后一条的 id 往上加
    id: (chat[chat.length - 1]?.id ?? 0) + 1,
    channel: msg.channel,
    seat: msg.seat,
    text,
    at: msg.at,
  };
  // 只留最近 CHAT_HISTORY_MAX 条：整份聊天记录每次状态推送都要重发一遍
  return { ...state, chat: [...chat, next].slice(-CHAT_HISTORY_MAX) };
};
