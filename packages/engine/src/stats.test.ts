/**
 * 战绩统计。口径出错不会崩，只会让排行榜悄悄不对 —— 所以每条口径都要有断言。
 */

import { describe, expect, it } from "vitest";
import { ROLES, type RoleId } from "@avalon/shared";
import { computeVision } from "./vision.js";
import { seededRng } from "./rng.js";
import { createGame, reduce } from "./machine.js";
import { addStats, emptyStats, rate, seatStats } from "./stats.js";
import type { Action, GameState } from "./types.js";

const RNG = seededRng([0]);
const FIVE: readonly RoleId[] = ["MERLIN", "PERCIVAL", "LOYAL_SERVANT", "MORGANA", "ASSASSIN"];

const make = (roles: readonly RoleId[] = FIVE): GameState => {
  const base = createGame(
    {
      playerCount: roles.length as 5,
      settings: {
        mode: "STANDARD", ladyOfTheLake: false, earlyAssassination: false,
        leaderRotation: "CLOCKWISE", rejectCounting: "PER_ROUND",
        loyaltyFlipTiming: "NORMAL", hideLoyaltyFlipResult: false,
        lancelotsKnowEachOther: false, spectatorsSeeRoles: false,
      },
      firstLeaderSeat: 0,
    },
    seededRng([0]),
  );
  return { ...base, roles: [...roles], sides: roles.map((r) => ROLES[r].side),
    vision: computeVision(roles, seededRng([0])) };
};

const apply = (g: GameState, a: Action): GameState => {
  const r = reduce(g, a, RNG);
  if (!r.ok) throw new Error(`${a.type}: ${r.error}`);
  return r.state;
};

const ackAll = (g: GameState): GameState =>
  g.roles.reduce((acc, _, seat) => apply(acc, { type: "ACK_ROLE", seat }), g);

/** 打一轮：队长提名 → 按 votes 投 → 通过就出牌 */
const round = (g: GameState, team: number[], votes: boolean[], fails: number[] = []): GameState => {
  let s = apply(g, { type: "PROPOSE_TEAM", seat: g.leaderSeat, team, speakDirection: null });
  for (const [seat] of s.roles.entries()) s = apply(s, { type: "VOTE", seat, approve: votes[seat]! });
  s = apply(s, { type: "ADVANCE" });
  if (s.phase !== "MISSION") return s;
  for (const seat of team) {
    s = apply(s, { type: "PLAY_CARD", seat, success: !fails.includes(seat) });
  }
  return apply(s, { type: "ADVANCE" });
};

describe("seatStats", () => {
  it("对局没结束时拒绝统计 —— 那时候读 roles 是泄漏", () => {
    expect(() => seatStats(ackAll(make()))).toThrow();
  });

  it("带狼上车率只算通过的车，被否决的不算在队长头上", () => {
    let g = ackAll(make());
    // 0 号当队长带上 3 号（莫甘娜），全票通过
    g = round(g, [0, 3], [true, true, true, true, true]);
    // 1 号当队长带干净的车，但被否决
    g = apply(g, { type: "PROPOSE_TEAM", seat: 1, team: [0, 1, 2], speakDirection: null });
    for (const [seat] of g.roles.entries()) g = apply(g, { type: "VOTE", seat, approve: false });
    g = apply(g, { type: "ADVANCE" });
    // 打完剩下的凑到终局
    g = round(g, [0, 1, 2], [true, true, true, true, true]);
    g = round(g, [0, 1], [true, true, true, true, true]);
    g = apply(g, { type: "ASSASSINATE", seat: 4, targetSeat: 1 });

    const stats = seatStats(g);
    expect(stats[0]!.leaderApproved).toBeGreaterThanOrEqual(1);
    expect(stats[0]!.leaderApprovedWithEvil).toBe(1);
    // 1 号那次被否了，分母不该 +1
    expect(stats[1]!.leaderApproved).toBe(0);
  });

  it("反对准确率：只有反对且车上真有狼才算命中", () => {
    let g = ackAll(make());
    // 带狼的车，2 号反对（命中），1 号赞成（失误）
    g = round(g, [0, 3], [true, true, false, true, true]);
    g = round(g, [0, 1, 2], [true, true, true, true, true]);
    g = round(g, [0, 1], [true, true, true, true, true]);
    g = apply(g, { type: "ASSASSINATE", seat: 4, targetSeat: 2 });

    const stats = seatStats(g);
    expect(stats[2]!.votedReject).toBe(1);
    expect(stats[2]!.votedRejectWithEvil).toBe(1);
    expect(stats[1]!.votedApproveWithEvil).toBe(1);
  });

  /**
   * 口径：三个「判断力」指标只统计自己是蓝方的局。
   *
   * 自己就是狼的时候，带狼上车是打算好的、给有狼的车投赞成是本职工作 ——
   * 混进去算，红方玩得越好数字越难看。红方那几局连分母都不进。
   */
  it("红方的组队与投票不进判断力指标，一个都不算", () => {
    let g = ackAll(make());
    // 0 号带干净的车过第一轮，队长顺时针挪到 1 号
    g = round(g, [0, 1], [true, true, true, true, true]);

    // 1 号、2 号的车连否两次，把队长挪到 3 号（莫甘娜）。红方两人都投了反对
    for (const seat of [1, 2]) {
      g = apply(g, { type: "PROPOSE_TEAM", seat, team: [0, 1, 2], speakDirection: null });
      for (const [s] of g.roles.entries()) g = apply(g, { type: "VOTE", seat: s, approve: false });
      g = apply(g, { type: "ADVANCE" });
    }
    expect(g.leaderSeat).toBe(3);

    // 3 号当队长，把自己（红）塞进车里，全票通过
    g = round(g, [0, 1, 3], [true, true, true, true, true]);
    g = round(g, [0, 1], [true, true, true, true, true]);
    g = apply(g, { type: "ASSASSINATE", seat: 4, targetSeat: 1 });

    const stats = seatStats(g);
    for (const seat of [3, 4]) {
      const s = stats[seat]!;
      expect(
        [
          s.leaderApproved, s.leaderApprovedWithEvil,
          s.votedReject, s.votedRejectWithEvil,
          s.votedApprove, s.votedApproveWithEvil,
        ],
        `${seat} 号是红方，判断力指标应该连分母都不进`,
      ).toEqual([0, 0, 0, 0, 0, 0]);
    }

    // 对照：同一局里蓝方照常统计，别让上面那组断言是因为「谁都没算」才过的
    expect(stats[0]!.leaderApproved).toBe(1);
    expect(stats[1]!.votedApprove).toBe(3);
    expect(stats[1]!.votedApproveWithEvil).toBe(1); // 只有带上 3 号那一车有狼
    expect(stats[2]!.votedReject).toBe(2);
  });

  it("刺杀只算真的动手那一次，命中才计入分子", () => {
    let g = ackAll(make());
    for (const team of [[0, 1], [0, 1, 2], [0, 1]]) {
      g = round(g, team, [true, true, true, true, true]);
    }
    g = apply(g, { type: "ASSASSINATE", seat: 4, targetSeat: 0 }); // 0 是梅林

    const stats = seatStats(g);
    expect(stats[4]!.assassinated).toBe(1);
    expect(stats[4]!.assassinatedHit).toBe(1);
    // 没动手的人分母是 0
    expect(stats[3]!.assassinated).toBe(0);
    // 梅林被刺中：进过刺杀阶段所以计入分母，但没活下来
    expect(stats[0]!.asMerlin).toBe(1);
    expect(stats[0]!.merlinSurvived).toBe(0);
  });

  /**
   * 回归：**提前刺杀**下梅林被漏记。
   *
   * 原来的口径是「蓝方拿满三次任务才算被考验过」，可开了提前刺杀之后，
   * 刺客打完 2 次任务就能开枪 —— 梅林实打实挨了一刀活下来了，
   * 分子分母却都是 0，页面上显示「—」，看着像这局根本没当过梅林。
   */
  it("提前刺杀下梅林躲过一刀，也要算进存活率", () => {
    const early = (): GameState => {
      const g = make();
      return { ...g, settings: { ...g.settings, earlyAssassination: true } };
    };
    let g = ackAll(early());
    // 只打 2 轮任务就动手 —— 远不到三次成功
    g = round(g, [0, 1], [true, true, true, true, true]);
    g = round(g, [0, 1, 2], [true, true, true, true, true]);
    expect(g.missions.filter((m) => m.success)).toHaveLength(2);

    // 4 号是刺客：先发起提前刺杀进入刺杀阶段，再刺 1 号（不是梅林）→ 落空，红方判负
    g = apply(g, { type: "EARLY_ASSASSINATE", seat: 4 });
    g = apply(g, { type: "ASSASSINATE", seat: 4, targetSeat: 1 });
    expect(g.outcome).toMatchObject({ reason: "ASSASSINATION_MISS" });

    const stats = seatStats(g);
    // 0 号是梅林：被瞄过一次并且活了下来
    expect(stats[0]!.asMerlin, "提前刺杀没算进梅林的分母").toBe(1);
    expect(stats[0]!.merlinSurvived, "梅林躲过一刀却没算存活").toBe(1);
    // 刺客那边照旧记一次动手、没命中
    expect(stats[4]!.assassinated).toBe(1);
    expect(stats[4]!.assassinatedHit).toBe(0);
  });

  it("提前刺杀命中梅林：计入分母，不计入存活", () => {
    const g0 = make();
    let g = ackAll({ ...g0, settings: { ...g0.settings, earlyAssassination: true } });
    g = round(g, [0, 1], [true, true, true, true, true]);
    g = round(g, [0, 1, 2], [true, true, true, true, true]);
    g = apply(g, { type: "EARLY_ASSASSINATE", seat: 4 });
    g = apply(g, { type: "ASSASSINATE", seat: 4, targetSeat: 0 });
    expect(g.outcome).toMatchObject({ reason: "ASSASSINATION_HIT" });

    const stats = seatStats(g);
    expect(stats[0]!.asMerlin).toBe(1);
    expect(stats[0]!.merlinSurvived).toBe(0);
  });

  it("红方靠任务赢的局里，梅林没被考验过，不计入存活率", () => {
    let g = ackAll(make());
    for (const team of [[0, 3], [0, 1, 3], [0, 3]]) {
      g = round(g, team, [true, true, true, true, true], [3]);
    }
    expect(g.outcome).toMatchObject({ winner: "RED", reason: "MISSIONS_FAILED" });
    const stats = seatStats(g);
    expect(stats[0]!.asMerlin).toBe(0);
  });

  it("胜负按终局阵营算，每人恰好一局", () => {
    let g = ackAll(make());
    for (const team of [[0, 1], [0, 1, 2], [0, 1]]) {
      g = round(g, team, [true, true, true, true, true]);
    }
    g = apply(g, { type: "ASSASSINATE", seat: 4, targetSeat: 1 });

    const stats = seatStats(g);
    expect(stats).toHaveLength(5);
    expect(stats.every((s) => s.games === 1)).toBe(true);
    expect(stats.filter((s) => s.wins === 1)).toHaveLength(3); // 蓝方 3 人
    expect(stats[0]!.asBlue).toBe(1);
    expect(stats[3]!.asRed).toBe(1);
  });
});

describe("累加与比率", () => {
  it("累加是逐字段相加", () => {
    const a = { ...emptyStats(), games: 2, wins: 1 };
    const b = { ...emptyStats(), games: 3, wins: 2 };
    expect(addStats(a, b)).toMatchObject({ games: 5, wins: 3 });
  });

  it("分母为 0 时返回 null，不是 0 —— 「没数据」不该看着像「表现极差」", () => {
    expect(rate(0, 0)).toBeNull();
    expect(rate(1, 4)).toBe(0.25);
  });
});
