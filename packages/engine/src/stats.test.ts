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
        loyaltyFlipTiming: "NORMAL", loyaltySwapChance: 0.33, hideLoyaltyFlipResult: false,
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
