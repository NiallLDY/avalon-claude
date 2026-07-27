/**
 * 常量表自洽性检查。
 * 这些断言防的是「手抄 GAME.md 抄错一格」—— 配置表一旦错了，
 * 整局游戏的平衡性就是坏的，而且很难在对局里被发现。
 */

import { describe, expect, it } from "vitest";
import { ROLES, type RoleId } from "./roles.js";
import {
  LANCELOT_MIN_PLAYERS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  MISSION_COUNT,
  SETUP_LANCELOT,
  SETUP_STANDARD,
  TEAM_SIZE,
  failsRequired,
  isProtectedRound,
  type PlayerCount,
} from "./tables.js";

const ALL_COUNTS = [5, 6, 7, 8, 9, 10] as const;
const LANCELOT_COUNTS = [7, 8, 9, 10] as const;

const sideCount = (roles: readonly RoleId[], side: "BLUE" | "RED") =>
  roles.filter((r) => ROLES[r].side === side).length;

/** GAME.md §3 的蓝/红人数分布，官方标准 */
const EXPECTED_SPLIT: Record<PlayerCount, [blue: number, red: number]> = {
  5: [3, 2],
  6: [4, 2],
  7: [4, 3],
  8: [5, 3],
  9: [6, 3],
  10: [6, 4],
};

describe("TEAM_SIZE", () => {
  it.each(ALL_COUNTS)("%i 人局每轮都有合法人数", (n) => {
    const sizes = TEAM_SIZE[n];
    expect(sizes).toHaveLength(MISSION_COUNT);
    for (const size of sizes) {
      expect(size).toBeGreaterThanOrEqual(2);
      expect(size).toBeLessThanOrEqual(n);
    }
  });

  it("保护轮只存在于 7–10 人局的第 4 轮", () => {
    for (const n of ALL_COUNTS) {
      for (let round = 0; round < MISSION_COUNT; round++) {
        expect(isProtectedRound(n, round)).toBe(n >= 7 && round === 3);
        expect(failsRequired(n, round)).toBe(n >= 7 && round === 3 ? 2 : 1);
      }
    }
  });
});

describe("SETUP_STANDARD", () => {
  it.each(ALL_COUNTS)("%i 人局角色数等于人数", (n) => {
    expect(SETUP_STANDARD[n]).toHaveLength(n);
  });

  it.each(ALL_COUNTS)("%i 人局蓝/红配比符合官方", (n) => {
    const roles = SETUP_STANDARD[n];
    const [blue, red] = EXPECTED_SPLIT[n];
    expect(sideCount(roles, "BLUE")).toBe(blue);
    expect(sideCount(roles, "RED")).toBe(red);
  });

  it.each(ALL_COUNTS)("%i 人局恰好一个梅林、一个派西维尔、一个刺客", (n) => {
    const roles = SETUP_STANDARD[n];
    for (const unique of ["MERLIN", "PERCIVAL", "ASSASSIN", "MORGANA"] as const) {
      expect(roles.filter((r) => r === unique)).toHaveLength(1);
    }
  });

  it("唯一角色不会重复出现（忠臣除外）", () => {
    for (const n of ALL_COUNTS) {
      const roles = SETUP_STANDARD[n].filter((r) => r !== "LOYAL_SERVANT");
      expect(new Set(roles).size).toBe(roles.length);
    }
  });
});

describe("SETUP_LANCELOT", () => {
  it("只在 7–10 人可用", () => {
    for (const n of ALL_COUNTS) {
      const available = SETUP_LANCELOT[n] !== undefined;
      expect(available).toBe(n >= LANCELOT_MIN_PLAYERS);
    }
  });

  it.each(LANCELOT_COUNTS)("%i 人局角色数与蓝红配比与标准模式一致", (n) => {
    const roles = SETUP_LANCELOT[n]!;
    const [blue, red] = EXPECTED_SPLIT[n];
    expect(roles).toHaveLength(n);
    expect(sideCount(roles, "BLUE")).toBe(blue);
    expect(sideCount(roles, "RED")).toBe(red);
  });

  it.each(LANCELOT_COUNTS)("%i 人局有且仅有一对兰斯洛特，且没有刺客", (n) => {
    const roles = SETUP_LANCELOT[n]!;
    expect(roles.filter((r) => r === "LANCELOT_BLUE")).toHaveLength(1);
    expect(roles.filter((r) => r === "LANCELOT_RED")).toHaveLength(1);
    // 本模式刺杀由莫甘娜执行，牌堆里不该有刺客
    expect(roles).not.toContain("ASSASSIN");
    expect(roles.filter((r) => r === "MORGANA")).toHaveLength(1);
  });
});

describe("ROLES 元数据", () => {
  it("莫德雷德对梅林隐身，奥伯伦与队友互不相认", () => {
    expect(ROLES.MORDRED.visibleToMerlin).toBe(false);
    expect(ROLES.OBERON.visibleToEvil).toBe(false);
    expect(ROLES.OBERON.seesEvil).toBe(false);
  });

  it("蓝方一律只能出成功，红兰斯洛特只能出失败", () => {
    for (const meta of Object.values(ROLES)) {
      if (meta.side === "BLUE") expect(meta.missionCard).toBe("SUCCESS_ONLY");
    }
    expect(ROLES.LANCELOT_RED.missionCard).toBe("FAIL_ONLY");
  });

  it("红兰斯洛特没有视野（他不认识队友，但队友认识他）", () => {
    expect(ROLES.LANCELOT_RED.seesEvil).toBe(false);
    expect(ROLES.LANCELOT_RED.visibleToEvil).toBe(true);
    expect(ROLES.LANCELOT_RED.visibleToMerlin).toBe(true);
  });

  it("只有两个兰斯洛特被标记为 isLancelot", () => {
    const lancelots = Object.values(ROLES).filter((r) => r.isLancelot);
    expect(lancelots.map((r) => r.id).sort()).toEqual([
      "LANCELOT_BLUE",
      "LANCELOT_RED",
    ]);
  });

  it("每个角色的 artId 唯一，且与已生成的插画文件名对齐", () => {
    const artIds = Object.values(ROLES).map((r) => r.artId);
    expect(new Set(artIds).size).toBe(artIds.length);
    for (const id of artIds) expect(id).toMatch(/^[a-z][a-z-]*[a-z]$/);
  });
});

describe("人数边界", () => {
  it("MIN/MAX 与配置表覆盖范围一致", () => {
    expect(MIN_PLAYERS).toBe(5);
    expect(MAX_PLAYERS).toBe(10);
    expect(Object.keys(SETUP_STANDARD).map(Number).sort((a, b) => a - b)).toEqual([
      ...ALL_COUNTS,
    ]);
  });
});
