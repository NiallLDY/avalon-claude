/**
 * 状态机单测。GAME.md §6 §7 §8 §9 §10
 *
 * 测试用固定的角色排布（不走洗牌），这样每条规则都能精确断言，
 * 发牌本身的随机性由 vision.test.ts 负责。
 */

import { describe, expect, it } from "vitest";
import { MAX_LOYALTY_SWAPS, ROLES, type PlayerCount, type RoleId } from "@avalon/shared";
import { seededRng, type Rng } from "./rng.js";
import { computeVision } from "./vision.js";
import { assassinSeat, canEarlyAssassinate, createGame, ladyTargets, reduce } from "./machine.js";
import type { ErrorCode, GameSettings } from "@avalon/shared";
import type { Action, GameState } from "./types.js";

// ──────────────────────────── 测试脚手架 ────────────────────────────

const RNG = seededRng([0]);

const settings = (over: Partial<GameSettings> = {}): GameSettings => ({
  mode: "STANDARD",
  ladyOfTheLake: false,
  earlyAssassination: false,
  leaderRotation: "CLOCKWISE",
  rejectCounting: "PER_ROUND",
  loyaltyFlipTiming: "NORMAL",
  hideLoyaltyFlipResult: false,
  lancelotsKnowEachOther: false,
  spectatorsSeeRoles: false,
  ...over,
});

/** 造一局角色排布固定的游戏，座位 i 就是 roles[i] */
const makeGame = (
  roles: readonly RoleId[],
  over: Partial<GameSettings> = {},
  firstLeaderSeat = 0,
): GameState => {
  const base = createGame(
    {
      playerCount: roles.length as PlayerCount,
      settings: settings(over),
      firstLeaderSeat,
    },
    seededRng([0]),
  );
  return {
    ...base,
    roles: [...roles],
    sides: roles.map((r) => ROLES[r].side),
    vision: computeVision(roles, seededRng([0])),
  };
};

const apply = (g: GameState, action: Action): GameState => {
  const r = reduce(g, action, RNG);
  if (!r.ok) throw new Error(`意外失败 ${action.type}: ${r.error}`);
  return r.state;
};

const expectError = (g: GameState, action: Action, code: ErrorCode): void => {
  const r = reduce(g, action, RNG);
  expect(r.ok, `期望 ${code}，却成功了`).toBe(false);
  if (!r.ok) expect(r.error).toBe(code);
};

/** 全员看牌，进入 TEAM_BUILD（或开局翻牌） */
const ackAll = (g: GameState): GameState =>
  g.roles.reduce((acc, _, seat) => apply(acc, { type: "ACK_ROLE", seat }), g);

const voteAll = (g: GameState, approve: boolean | readonly boolean[]): GameState =>
  g.roles.reduce(
    (acc, _, seat) =>
      apply(acc, {
        type: "VOTE",
        seat,
        approve: typeof approve === "boolean" ? approve : approve[seat]!,
      }),
    g,
  );

const advance = (g: GameState, byHost = false): GameState =>
  apply(g, byHost ? { type: "ADVANCE", byHost: true } : { type: "ADVANCE" });

/** 提名 → 全票通过 → 进入 MISSION */
const proposeAndApprove = (g: GameState, team: readonly number[]): GameState => {
  const proposed = apply(g, {
    type: "PROPOSE_TEAM",
    seat: g.leaderSeat,
    team,
    speakDirection: null,
  });
  return advance(voteAll(proposed, true));
};

/** 队员出牌，failSeats 里的人出失败，其余出成功。停在 MISSION_RESULT */
const playCards = (g: GameState, failSeats: readonly number[] = []): GameState =>
  (g.team ?? []).reduce(
    (acc, seat) => apply(acc, { type: "PLAY_CARD", seat, success: !failSeats.includes(seat) }),
    g,
  );

/** 跑完一整轮任务，停在 MISSION_RESULT（不 advance，留给调用方决定） */
const runMission = (
  g: GameState,
  team: readonly number[],
  failSeats: readonly number[] = [],
): GameState => playCards(proposeAndApprove(g, team), failSeats);

// 5 人标准局：座位 0 梅林、1 派西维尔、2 忠臣、3 莫甘娜、4 刺客
const FIVE: readonly RoleId[] = [
  "MERLIN", "PERCIVAL", "LOYAL_SERVANT", "MORGANA", "ASSASSIN",
];
// 7 人兰斯洛特局
const SEVEN_LANCELOT: readonly RoleId[] = [
  "MERLIN", "PERCIVAL", "LOYAL_SERVANT", "LANCELOT_BLUE",
  "MORGANA", "LANCELOT_RED", "OBERON",
];

// ──────────────────────────── 测试 ────────────────────────────

describe("开局", () => {
  it("从发牌阶段开始，没人看过牌", () => {
    const g = makeGame(FIVE);
    expect(g.phase).toBe("ROLE_REVEAL");
    expect(g.roleAcked).toEqual([false, false, false, false, false]);
    expect(g.outcome).toBeNull();
  });

  it("全员看牌后进入组队", () => {
    expect(ackAll(makeGame(FIVE)).phase).toBe("TEAM_BUILD");
  });

  it("同一个人不能重复确认", () => {
    const g = apply(makeGame(FIVE), { type: "ACK_ROLE", seat: 0 });
    expectError(g, { type: "ACK_ROLE", seat: 0 }, "ALREADY_ACTED");
  });

  it("房主可以强制跳过没看完牌的人；普通玩家不行", () => {
    const g = makeGame(FIVE);
    expectError(g, { type: "ADVANCE" }, "NOT_YOUR_TURN");
    expect(advance(g, true).phase).toBe("TEAM_BUILD");
  });
});

describe("组队", () => {
  it("只有队长能提名", () => {
    const g = ackAll(makeGame(FIVE, {}, 0));
    expectError(
      g,
      { type: "PROPOSE_TEAM", seat: 1, team: [0, 1], speakDirection: null },
      "NOT_YOUR_TURN",
    );
  });

  it("队伍人数必须等于本轮要求", () => {
    const g = ackAll(makeGame(FIVE)); // 第 1 轮要 2 人
    expectError(
      g,
      { type: "PROPOSE_TEAM", seat: 0, team: [0, 1, 2], speakDirection: null },
      "INVALID_TEAM_SIZE",
    );
  });

  it("不能重复选同一个人", () => {
    const g = ackAll(makeGame(FIVE));
    expectError(
      g,
      { type: "PROPOSE_TEAM", seat: 0, team: [1, 1], speakDirection: null },
      "DUPLICATE_TEAM_MEMBER",
    );
  });

  it("队长可以把自己选进队伍", () => {
    const g = ackAll(makeGame(FIVE));
    expect(
      apply(g, { type: "PROPOSE_TEAM", seat: 0, team: [0, 1], speakDirection: null }).phase,
    ).toBe("VOTE");
  });
});

describe("投票", () => {
  it("赞成票必须严格过半（5 人局需要 3 票）", () => {
    const g = ackAll(makeGame(FIVE));
    const proposed = apply(g, {
      type: "PROPOSE_TEAM", seat: 0, team: [0, 1], speakDirection: null,
    });

    const twoYes = voteAll(proposed, [true, true, false, false, false]);
    expect(twoYes.proposals.at(-1)!.approved).toBe(false);

    const threeYes = voteAll(proposed, [true, true, true, false, false]);
    expect(threeYes.proposals.at(-1)!.approved).toBe(true);
  });

  it("没投完票不揭票", () => {
    const g = ackAll(makeGame(FIVE));
    const proposed = apply(g, {
      type: "PROPOSE_TEAM", seat: 0, team: [0, 1], speakDirection: null,
    });
    const partial = apply(proposed, { type: "VOTE", seat: 0, approve: true });
    expect(partial.phase).toBe("VOTE");
    expect(partial.proposals).toHaveLength(0);
  });

  it("不能重复投票", () => {
    const g = ackAll(makeGame(FIVE));
    const proposed = apply(g, {
      type: "PROPOSE_TEAM", seat: 0, team: [0, 1], speakDirection: null,
    });
    const voted = apply(proposed, { type: "VOTE", seat: 0, approve: true });
    expectError(voted, { type: "VOTE", seat: 0, approve: false }, "ALREADY_ACTED");
  });

  it("未上车的人也要投票", () => {
    const g = ackAll(makeGame(FIVE));
    const proposed = apply(g, {
      type: "PROPOSE_TEAM", seat: 0, team: [0, 1], speakDirection: null,
    });
    const record = voteAll(proposed, true).proposals.at(-1)!;
    expect(record.votes).toHaveLength(5);
  });
});

describe("流局", () => {
  /** 反复否决 n 次，返回状态 */
  const rejectTimes = (g: GameState, n: number): GameState => {
    let cur = g;
    for (let i = 0; i < n; i++) {
      const proposed = apply(cur, {
        type: "PROPOSE_TEAM",
        seat: cur.leaderSeat,
        team: [0, 1],
        speakDirection: null,
      });
      cur = advance(voteAll(proposed, false));
    }
    return cur;
  };

  it("连续 5 次否决红方直接获胜", () => {
    const g = rejectTimes(ackAll(makeGame(FIVE)), 5);
    expect(g.phase).toBe("GAME_OVER");
    expect(g.outcome).toEqual({
      winner: "RED",
      reason: "REJECT_LIMIT",
      assassinatedSeat: null,
    });
  });

  it("4 次否决还没输，且队长在顺位传递", () => {
    const g = rejectTimes(ackAll(makeGame(FIVE, {}, 0)), 4);
    expect(g.phase).toBe("TEAM_BUILD");
    expect(g.rejectStreak).toBe(4);
    expect(g.leaderSeat).toBe(4); // 0 → 1 → 2 → 3 → 4
    expect(g.attempt).toBe(4);
  });

  it("轮内连续模式下，任一提名通过即清零（Q1）", () => {
    const rejected = rejectTimes(ackAll(makeGame(FIVE)), 4);
    expect(rejected.rejectStreak).toBe(4);
    const approved = proposeAndApprove(rejected, [0, 1]);
    expect(approved.rejectStreak).toBe(0);
  });

  it("全局累计模式下，通过也不清零", () => {
    const rejected = rejectTimes(
      ackAll(makeGame(FIVE, { rejectCounting: "GLOBAL" })),
      4,
    );
    const approved = proposeAndApprove(rejected, [0, 1]);
    expect(approved.rejectStreak).toBe(4);
  });

  it("进入新一轮时轮内计数清零", () => {
    const g = ackAll(makeGame(FIVE));
    const next = advance(runMission(g, [0, 1]));
    expect(next.roundIndex).toBe(1);
    expect(next.rejectStreak).toBe(0);
  });
});

describe("任务出牌", () => {
  it("只有队员能出牌", () => {
    const g = proposeAndApprove(ackAll(makeGame(FIVE)), [0, 1]);
    expectError(g, { type: "PLAY_CARD", seat: 2, success: true }, "NOT_ON_TEAM");
  });

  it("蓝方不能出失败牌 —— 服务端强制，不靠前端不给按钮", () => {
    const g = proposeAndApprove(ackAll(makeGame(FIVE)), [0, 1]);
    expectError(g, { type: "PLAY_CARD", seat: 0, success: false }, "ILLEGAL_CARD");
    expectError(g, { type: "PLAY_CARD", seat: 1, success: false }, "ILLEGAL_CARD");
  });

  it("红方可以出成功也可以出失败", () => {
    const g = proposeAndApprove(ackAll(makeGame(FIVE)), [3, 4]);
    expect(apply(g, { type: "PLAY_CARD", seat: 3, success: true }).cards[3]).toBe(true);
    expect(apply(g, { type: "PLAY_CARD", seat: 4, success: false }).cards[4]).toBe(false);
  });

  it("1 张失败牌即任务失败（非保护轮）", () => {
    const g = runMission(ackAll(makeGame(FIVE)), [0, 3], [3]);
    const mission = g.missions.at(-1)!;
    expect(mission.failCount).toBe(1);
    expect(mission.failsRequired).toBe(1);
    expect(mission.success).toBe(false);
  });

  it("保护轮（7 人第 4 轮）1 张失败牌不算失败，2 张才算", () => {
    // 直接把状态推到第 4 轮，避免跑三整轮
    const base = ackAll(makeGame([
      "MERLIN", "PERCIVAL", "LOYAL_SERVANT", "LOYAL_SERVANT",
      "MORGANA", "ASSASSIN", "OBERON",
    ]));
    const round4: GameState = { ...base, roundIndex: 3 }; // 7 人第 4 轮要 4 人

    const oneFail = runMission(round4, [0, 1, 4, 5], [4]);
    expect(oneFail.missions.at(-1)).toMatchObject({
      failCount: 1, failsRequired: 2, success: true,
    });

    const twoFails = runMission(round4, [0, 1, 4, 5], [4, 5]);
    expect(twoFails.missions.at(-1)).toMatchObject({
      failCount: 2, failsRequired: 2, success: false,
    });
  });

  it("出牌人映射留在引擎里，供测试验证约束确实生效", () => {
    const g = runMission(ackAll(makeGame(FIVE)), [0, 3], [3]);
    expect(g.missions.at(-1)!.cardsBySeat).toEqual({ 0: true, 3: false });
  });
});

describe("胜负判定", () => {
  it("3 次任务失败 → 红方胜", () => {
    let g = ackAll(makeGame(FIVE));
    g = advance(runMission(g, [0, 3], [3])); // 第 1 轮失败
    g = advance(runMission(g, [0, 1, 3], [3])); // 第 2 轮失败
    g = advance(runMission(g, [0, 3], [3])); // 第 3 轮失败
    expect(g.phase).toBe("GAME_OVER");
    expect(g.outcome).toMatchObject({ winner: "RED", reason: "MISSIONS_FAILED" });
  });

  it("3 次任务成功 → 进入刺杀阶段", () => {
    let g = ackAll(makeGame(FIVE));
    g = advance(runMission(g, [0, 1]));
    g = advance(runMission(g, [0, 1, 2]));
    g = advance(runMission(g, [0, 1]));
    expect(g.phase).toBe("ASSASSINATION");
    expect(g.outcome).toBeNull();
  });

  it("刺中梅林 → 红方胜", () => {
    let g = ackAll(makeGame(FIVE));
    g = advance(runMission(g, [0, 1]));
    g = advance(runMission(g, [0, 1, 2]));
    g = advance(runMission(g, [0, 1]));
    g = apply(g, { type: "ASSASSINATE", seat: 4, targetSeat: 0 });
    expect(g.outcome).toEqual({
      winner: "RED", reason: "ASSASSINATION_HIT", assassinatedSeat: 0,
    });
  });

  it("刺错人 → 蓝方胜", () => {
    let g = ackAll(makeGame(FIVE));
    g = advance(runMission(g, [0, 1]));
    g = advance(runMission(g, [0, 1, 2]));
    g = advance(runMission(g, [0, 1]));
    g = apply(g, { type: "ASSASSINATE", seat: 4, targetSeat: 1 });
    expect(g.outcome).toMatchObject({ winner: "BLUE", reason: "MISSIONS_SUCCEEDED" });
  });

  it("只有刺客能刺杀，且不能刺自己", () => {
    let g = ackAll(makeGame(FIVE));
    g = advance(runMission(g, [0, 1]));
    g = advance(runMission(g, [0, 1, 2]));
    g = advance(runMission(g, [0, 1]));
    expectError(g, { type: "ASSASSINATE", seat: 3, targetSeat: 0 }, "NOT_YOUR_TURN");
    expectError(g, { type: "ASSASSINATE", seat: 4, targetSeat: 4 }, "INVALID_SEAT");
  });

  it("对局结束后任何动作都被拒绝", () => {
    let g = ackAll(makeGame(FIVE));
    g = advance(runMission(g, [0, 3], [3]));
    g = advance(runMission(g, [0, 1, 3], [3]));
    g = advance(runMission(g, [0, 3], [3]));
    expectError(g, { type: "ADVANCE" }, "GAME_OVER");
  });
});

describe("提前刺杀（Q3）", () => {
  const early = () => ackAll(makeGame(FIVE, { earlyAssassination: true }));

  it("完成 2 次任务前不解锁 —— 流局再多也不行", () => {
    let g = early();
    expect(canEarlyAssassinate(g)).toBe(false);

    // 否决 4 次，任务数仍是 0
    for (let i = 0; i < 4; i++) {
      const p = apply(g, {
        type: "PROPOSE_TEAM", seat: g.leaderSeat, team: [0, 1], speakDirection: null,
      });
      g = advance(voteAll(p, false));
    }
    expect(g.missions).toHaveLength(0);
    expect(canEarlyAssassinate(g)).toBe(false);
    expectError(g, { type: "EARLY_ASSASSINATE", seat: 4 }, "EARLY_ASSASSINATION_UNAVAILABLE");
  });

  it("完成 2 次任务后解锁", () => {
    let g = early();
    g = advance(runMission(g, [0, 1]));
    expect(canEarlyAssassinate(g)).toBe(false);
    g = advance(runMission(g, [0, 1, 2]));
    expect(canEarlyAssassinate(g)).toBe(true);
  });

  it("发起后立刻中断当前流程跳到刺杀", () => {
    let g = early();
    g = advance(runMission(g, [0, 1]));
    g = advance(runMission(g, [0, 1, 2]));
    g = apply(g, { type: "EARLY_ASSASSINATE", seat: 4 });
    expect(g.phase).toBe("ASSASSINATION");
    expect(g.earlyAssassinationUsed).toBe(true);
  });

  it("提前刺杀落空 → 红方立即判负", () => {
    let g = early();
    g = advance(runMission(g, [0, 1]));
    g = advance(runMission(g, [0, 1, 2]));
    g = apply(g, { type: "EARLY_ASSASSINATE", seat: 4 });
    g = apply(g, { type: "ASSASSINATE", seat: 4, targetSeat: 2 });
    expect(g.outcome).toMatchObject({ winner: "BLUE", reason: "ASSASSINATION_MISS" });
  });

  it("提前刺杀命中 → 红方胜", () => {
    let g = early();
    g = advance(runMission(g, [0, 1]));
    g = advance(runMission(g, [0, 1, 2]));
    g = apply(g, { type: "EARLY_ASSASSINATE", seat: 4 });
    g = apply(g, { type: "ASSASSINATE", seat: 4, targetSeat: 0 });
    expect(g.outcome).toMatchObject({ winner: "RED", reason: "ASSASSINATION_HIT" });
  });

  it("没开这个模式就用不了", () => {
    let g = ackAll(makeGame(FIVE));
    g = advance(runMission(g, [0, 1]));
    g = advance(runMission(g, [0, 1, 2]));
    expect(canEarlyAssassinate(g)).toBe(false);
  });
});

describe("兰斯洛特模式", () => {
  const lancelot = (over: Partial<GameSettings> = {}) =>
    makeGame(SEVEN_LANCELOT, { mode: "LANCELOT", ...over });

  it("刺杀由莫甘娜执行，没有刺客", () => {
    const g = lancelot();
    expect(g.roles).not.toContain("ASSASSIN");
    expect(assassinSeat(g)).toBe(4); // 座位 4 是莫甘娜
  });

  it("常规翻牌：牌堆 3 张，第 2 次任务后才开始翻", () => {
    let g = ackAll(lancelot());
    expect(g.loyalty!.deck).toHaveLength(3);

    g = advance(runMission(g, [0, 1])); // 第 1 轮后不翻
    expect(g.phase).toBe("TEAM_BUILD");
    expect(g.loyalty!.drawn).toBe(0);

    g = runMission(g, [0, 1, 2]); // 第 2 轮
    g = advance(g);
    expect(g.phase).toBe("LOYALTY_FLIP");
    expect(g.loyalty!.drawn).toBe(1);
  });

  it("开局翻牌：牌堆 5 张，发牌后立刻翻第一张", () => {
    const g = ackAll(lancelot({ loyaltyFlipTiming: "OPENING" }));
    expect(g.loyalty!.deck).toHaveLength(5);
    expect(g.phase).toBe("LOYALTY_FLIP");
    expect(g.loyalty!.flips.at(0)!.afterRoundIndex).toBeNull();

    const started = advance(g);
    expect(started.phase).toBe("TEAM_BUILD");
    // 开局翻牌不能把轮次推掉 —— 否则第 1 轮任务直接被跳过
    expect(started.roundIndex).toBe(0);
    expect(started.missions).toHaveLength(0);
  });

  /**
   * 官方 Lancelot promo 的牌堆是**固定构成**的，不是每张独立掷骰：
   * 变体 #1 是 3 空白 + 2 转换共 5 张、只翻 3 张，变体 #2 是 5 空白 + 2 转换
   * 共 7 张、发 5 张。所以一局最多换 2 次，而且翻过的牌会改变后面的概率。
   */
  describe("忠诚牌堆构成", () => {
    /*
     * 分布类断言不能用 seededRng —— 它是**循环**的固定序列，
     * 洗一副 7 张牌只消费 6 个数，取模之后能洗出的排列少得可怜，
     * 会让「翻满 2 张」这种本该占四成的情况一次都不出现。
     */
    const lcg = (seed: number): Rng => {
      let x = (seed >>> 0) || 1;
      return {
        int(max) {
          x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
          return max <= 0 ? 0 : x % max;
        },
      };
    };
    const decksOf = (timing: "NORMAL" | "OPENING", n: number) =>
      Array.from({ length: n }, (_, i) =>
        createGame(
          { playerCount: 7, settings: settings({ mode: "LANCELOT", loyaltyFlipTiming: timing }) },
          lcg(i + 1),
        ).loyalty!.deck,
      );

    it("翻的张数按时机表来", () => {
      for (const d of decksOf("NORMAL", 30)) expect(d).toHaveLength(3);
      for (const d of decksOf("OPENING", 30)) expect(d).toHaveLength(5);
    });

    it("一局最多只可能换 2 次 —— 牌堆里就只有 2 张转换牌", () => {
      for (const timing of ["NORMAL", "OPENING"] as const) {
        for (const deck of decksOf(timing, 200)) {
          expect(deck.filter(Boolean).length, timing).toBeLessThanOrEqual(MAX_LOYALTY_SWAPS);
        }
      }
    });

    it("两种极端都出得来：一张转换牌都没翻到，和翻满 2 张", () => {
      for (const timing of ["NORMAL", "OPENING"] as const) {
        const counts = new Set(decksOf(timing, 200).map((d) => d.filter(Boolean).length));
        expect(counts, `${timing} 只出现过 ${[...counts]}`).toContain(0);
        expect(counts, `${timing} 只出现过 ${[...counts]}`).toContain(MAX_LOYALTY_SWAPS);
      }
    });

    it("常规变体有 2 张牌永远不揭 —— 翻 3 张不等于把 5 张翻完", () => {
      // 5 张里有 2 张转换，如果翻满 5 张，「一张都没转换」就不可能出现；
      // 官方是只翻 3 张，所以这种局面必须存在
      const none = decksOf("NORMAL", 200).filter((d) => !d.some(Boolean));
      expect(none.length, "常规模式下从来没出现过整局不换边").toBeGreaterThan(0);
    });

    it("标准模式没有忠诚牌堆", () => {
      const g = createGame({ playerCount: 7, settings: settings() }, RNG);
      expect(g.loyalty).toBeNull();
    });
  });

  it("翻到「阵营转换」时两个兰斯洛特互换阵营，其他人不动", () => {
    // 牌堆全是转换牌
    const base = ackAll(lancelot({ loyaltyFlipTiming: "OPENING" }));
    const g: GameState = {
      ...base,
      loyalty: { deck: [true, true, true, true, true], drawn: 0, flips: [] },
      phase: "ROLE_REVEAL",
      pendingLoyaltyFlip: true,
      sides: SEVEN_LANCELOT.map((r) => ROLES[r].side),
    };
    const flipped = advance(g, true);

    expect(flipped.sides[3]).toBe("RED"); // 蓝兰 → 红
    expect(flipped.sides[5]).toBe("BLUE"); // 红兰 → 蓝
    expect(flipped.sides[0]).toBe("BLUE"); // 梅林不动
    expect(flipped.sides[4]).toBe("RED"); // 莫甘娜不动
  });

  it("阵营转换后出牌约束跟着变：原蓝兰只能出失败，原红兰只能出成功", () => {
    const base = ackAll(lancelot({ loyaltyFlipTiming: "OPENING" }));
    const swapped: GameState = {
      ...base,
      loyalty: { deck: [true, true, true, true, true], drawn: 0, flips: [] },
      phase: "ROLE_REVEAL",
      pendingLoyaltyFlip: true,
      sides: SEVEN_LANCELOT.map((r) => ROLES[r].side),
    };
    const g = proposeAndApprove(advance(advance(swapped, true)), [3, 5]);

    // 座位 3 是蓝兰，现在归红方 → 只能失败
    expectError(g, { type: "PLAY_CARD", seat: 3, success: true }, "ILLEGAL_CARD");
    // 座位 5 是红兰，现在归蓝方 → 只能成功
    expectError(g, { type: "PLAY_CARD", seat: 5, success: false }, "ILLEGAL_CARD");
  });

  it("没翻牌时红兰只能出失败、蓝兰只能出成功", () => {
    const g = proposeAndApprove(ackAll(lancelot()), [3, 5]);
    expectError(g, { type: "PLAY_CARD", seat: 3, success: false }, "ILLEGAL_CARD");
    expectError(g, { type: "PLAY_CARD", seat: 5, success: true }, "ILLEGAL_CARD");
  });

  it("常规翻牌一局最多 3 张", () => {
    // 队伍里避开两个兰斯洛特（座位 3、5），否则阵营一翻出牌约束就跟着变
    let g = ackAll(lancelot());
    g = advance(runMission(g, [0, 1])); // 第 1 轮成功，不翻
    expect(g.loyalty!.drawn).toBe(0);

    g = advance(advance(runMission(g, [0, 1, 4], [4]))); // 第 2 轮失败 → 翻第 1 张
    expect(g.loyalty!.drawn).toBe(1);

    g = advance(advance(runMission(g, [0, 1, 2]))); // 第 3 轮 → 翻第 2 张
    expect(g.loyalty!.drawn).toBe(2);

    // 第 4 轮是保护轮，1 张失败牌不足以判负 → 任务成功，凑满 3 次成功
    g = advance(advance(runMission(g, [0, 1, 2, 4], [4]))); // → 翻第 3 张
    expect(g.loyalty!.drawn).toBe(3);
    expect(g.phase).toBe("ASSASSINATION");
    expect(g.loyalty!.drawn).toBe(g.loyalty!.deck.length);
  });
});

describe("湖中女神", () => {
  const withLady = (leader = 0) =>
    makeGame([
      "MERLIN", "PERCIVAL", "LOYAL_SERVANT", "LOYAL_SERVANT",
      "MORGANA", "ASSASSIN", "OBERON",
    ], { ladyOfTheLake: true }, leader);

  it("第一代女神是首任队长的上一位", () => {
    expect(withLady(0).lady!.holderSeat).toBe(6); // (0-1+7)%7
    expect(withLady(3).lady!.holderSeat).toBe(2);
  });

  it("第 1 轮任务后不查验，第 2 轮后才查", () => {
    let g = ackAll(withLady());
    g = advance(runMission(g, [0, 1]));
    expect(g.phase).toBe("TEAM_BUILD");

    g = advance(runMission(g, [0, 1, 2]));
    expect(g.phase).toBe("LADY_OF_LAKE");
  });

  it("查验结果是当刻真实阵营，且只有当代女神拿得到", () => {
    let g = ackAll(withLady());
    g = advance(runMission(g, [0, 1]));
    g = advance(runMission(g, [0, 1, 2]));
    g = apply(g, { type: "LADY_CHECK", seat: 6, targetSeat: 4 }); // 查莫甘娜

    const check = g.lady!.checks.at(-1)!;
    expect(check).toMatchObject({ holderSeat: 6, targetSeat: 4, revealedSide: "RED" });
    expect(g.lady!.holderSeat).toBe(4); // 被查者接任
  });

  it("当过女神的人不能再被查（含自己）", () => {
    // 第 2 轮故意打失败，避免三连胜提前触发刺杀把第 3 轮的查验跳掉
    let g = ackAll(withLady());
    g = advance(runMission(g, [0, 1]));
    g = advance(runMission(g, [0, 1, 4], [4]));
    expect(g.phase).toBe("LADY_OF_LAKE");

    expect(ladyTargets(g)).not.toContain(6); // 初代女神自己
    expectError(g, { type: "LADY_CHECK", seat: 6, targetSeat: 6 }, "INVALID_LADY_TARGET");

    g = apply(g, { type: "LADY_CHECK", seat: 6, targetSeat: 4 });
    g = advance(runMission(g, [0, 1, 2]));
    expect(g.phase).toBe("LADY_OF_LAKE");
    expect(g.lady!.holderSeat).toBe(4);
    expect(ladyTargets(g)).not.toContain(4);
    expect(ladyTargets(g)).not.toContain(6);
    expectError(g, { type: "LADY_CHECK", seat: 4, targetSeat: 6 }, "INVALID_LADY_TARGET");
  });

  it("非当代女神不能发起查验", () => {
    let g = ackAll(withLady());
    g = advance(runMission(g, [0, 1]));
    g = advance(runMission(g, [0, 1, 2]));
    expectError(g, { type: "LADY_CHECK", seat: 0, targetSeat: 4 }, "NOT_YOUR_TURN");
  });

  it("第 3 次任务成功直接触发刺杀时跳过查验（Q2）", () => {
    let g = ackAll(withLady());
    g = advance(runMission(g, [0, 1])); // 成功 1
    g = advance(runMission(g, [0, 1, 2])); // 成功 2 → 查验
    g = apply(g, { type: "LADY_CHECK", seat: 6, targetSeat: 1 });
    g = advance(runMission(g, [0, 1, 2])); // 成功 3
    expect(g.phase).toBe("ASSASSINATION");
    expect(g.lady!.checks).toHaveLength(1); // 第 3 轮那次被跳过了
  });
});

describe("队长轮转", () => {
  it("顺时针传递，绕回 0", () => {
    let g = ackAll(makeGame(FIVE, {}, 4));
    expect(g.leaderSeat).toBe(4);
    g = advance(runMission(g, [0, 1]));
    expect(g.leaderSeat).toBe(0);
  });

  it("全随机模式下不会连任", () => {
    const rng = seededRng([1, 2, 3, 0, 2, 1, 3]);
    let g = ackAll(makeGame(FIVE, { leaderRotation: "RANDOM" }, 2));
    for (let i = 0; i < 6; i++) {
      const before = g.leaderSeat;
      const p = reduce(g, {
        type: "PROPOSE_TEAM", seat: before, team: [0, 1], speakDirection: null,
      }, rng);
      if (!p.ok) throw new Error(p.error);
      const voted = voteAll(p.state, false);
      const next = reduce(voted, { type: "ADVANCE" }, rng);
      if (!next.ok) break;
      g = next.state;
      if (g.phase !== "TEAM_BUILD") break;
      expect(g.leaderSeat).not.toBe(before);
      expect(g.leaderSeat).toBeGreaterThanOrEqual(0);
      expect(g.leaderSeat).toBeLessThan(5);
    }
  });
});

describe("复盘数据", () => {
  it("每次提名都留档，含被否决的", () => {
    let g = ackAll(makeGame(FIVE));
    const p1 = apply(g, {
      type: "PROPOSE_TEAM", seat: 0, team: [0, 1], speakDirection: "CW",
    });
    g = advance(voteAll(p1, false));
    g = proposeAndApprove(g, [1, 2]);

    expect(g.proposals).toHaveLength(2);
    expect(g.proposals[0]).toMatchObject({
      roundIndex: 0, attempt: 0, leaderSeat: 0, approved: false, speakDirection: "CW",
    });
    expect(g.proposals[1]).toMatchObject({ attempt: 1, leaderSeat: 1, approved: true });
  });
});
