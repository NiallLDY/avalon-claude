/**
 * 视野单测。这是全项目最该被穷举的地方 ——
 * 视野算错不会崩、不会报错，只会让某个人默默拿到不该有的情报。
 *
 * 策略：对 5–10 人 × 标准/兰斯洛特 的每种配置，
 * 用多个不同 seed 反复发牌，对每次发牌断言全部不变量。
 */

import { describe, expect, it } from "vitest";
import {
  ROLES,
  SETUP_LANCELOT,
  isValidPlayerCount,
  type GameMode,
  type PlayerCount,
  type RoleId,
} from "@avalon/shared";
import { dealRoles, roleDeck, canStart } from "./setup.js";
import { computeVision } from "./vision.js";
import { seededRng } from "./rng.js";

const ALL_COUNTS = [5, 6, 7, 8, 9, 10] as const;
const LANCELOT_COUNTS = [7, 8, 9, 10] as const;
const SEEDS = [
  [1, 2, 3, 5, 7, 11, 13],
  [0, 0, 0, 0, 0, 0, 0],
  [9, 4, 6, 2, 8, 1, 3],
  [17, 23, 5, 41, 3, 29, 7],
  [2, 9, 9, 1, 4, 7, 6],
];

/** 遍历所有 (人数, 模式, seed) 组合，把发好的牌交给回调 */
const forEveryDeal = (
  fn: (ctx: {
    roles: readonly RoleId[];
    playerCount: PlayerCount;
    mode: GameMode;
    label: string;
  }) => void,
) => {
  for (const mode of ["STANDARD", "LANCELOT"] as const) {
    const counts = mode === "LANCELOT" ? LANCELOT_COUNTS : ALL_COUNTS;
    for (const playerCount of counts) {
      for (const [i, seed] of SEEDS.entries()) {
        const roles = dealRoles(playerCount, mode, seededRng(seed));
        fn({ roles, playerCount, mode, label: `${mode}/${playerCount}p/seed${i}` });
      }
    }
  }
};

const seatsOf = (roles: readonly RoleId[], pred: (r: RoleId) => boolean) =>
  roles.flatMap((r, seat) => (pred(r) ? [seat] : []));

describe("dealRoles", () => {
  it("发出的牌是牌堆的一个排列", () => {
    forEveryDeal(({ roles, playerCount, mode, label }) => {
      expect(roles, label).toHaveLength(playerCount);
      expect([...roles].sort(), label).toEqual([...roleDeck(playerCount, mode)].sort());
    });
  });

  it("兰斯洛特模式不足 7 人直接抛错", () => {
    for (const n of [5, 6] as const) {
      expect(() => roleDeck(n, "LANCELOT")).toThrow();
      expect(canStart(n, "LANCELOT")).toBe(false);
      expect(canStart(n, "STANDARD")).toBe(true);
    }
    for (const n of LANCELOT_COUNTS) {
      expect(SETUP_LANCELOT[n]).toBeDefined();
      expect(canStart(n, "LANCELOT")).toBe(true);
    }
  });

  it("拒绝非法人数", () => {
    for (const n of [0, 1, 4, 11, 100, 5.5]) {
      expect(isValidPlayerCount(n)).toBe(false);
    }
  });
});

describe("computeVision · 梅林", () => {
  it("看到除莫德雷德外的全部红方，且不含自己", () => {
    forEveryDeal(({ roles, label }) => {
      const vision = computeVision(roles, seededRng([1]));
      const merlin = roles.indexOf("MERLIN");
      const expected = seatsOf(
        roles,
        (r) => ROLES[r].side === "RED" && ROLES[r].visibleToMerlin,
      );
      expect([...vision[merlin]!.evilSeats].sort(), label).toEqual(expected.sort());
      expect(vision[merlin]!.evilSeats, label).not.toContain(merlin);
    });
  });

  it("莫德雷德在场时一定不在梅林视野里", () => {
    forEveryDeal(({ roles, label }) => {
      const mordred = roles.indexOf("MORDRED");
      if (mordred < 0) return;
      const vision = computeVision(roles, seededRng([1]));
      expect(vision[roles.indexOf("MERLIN")]!.evilSeats, label).not.toContain(mordred);
    });
  });

  it("奥伯伦和红兰斯洛特都在梅林视野里", () => {
    forEveryDeal(({ roles, label }) => {
      const merlinVision = computeVision(roles, seededRng([1]))[roles.indexOf("MERLIN")]!;
      for (const role of ["OBERON", "LANCELOT_RED"] as const) {
        const seat = roles.indexOf(role);
        if (seat >= 0) expect(merlinVision.evilSeats, `${label} ${role}`).toContain(seat);
      }
    });
  });

  it("梅林看不出谁是兰斯洛特", () => {
    forEveryDeal(({ roles, label }) => {
      const merlinVision = computeVision(roles, seededRng([1]))[roles.indexOf("MERLIN")]!;
      expect(merlinVision.lancelotSeats, label).toEqual([]);
    });
  });
});

describe("computeVision · 派西维尔", () => {
  it("恰好看到梅林与莫甘娜两个座位", () => {
    forEveryDeal(({ roles, label }) => {
      const vision = computeVision(roles, seededRng([1]));
      const percival = vision[roles.indexOf("PERCIVAL")]!;
      expect([...percival.merlinCandidates].sort(), label).toEqual(
        [roles.indexOf("MERLIN"), roles.indexOf("MORGANA")].sort(),
      );
      // 除了这两人以外什么都不知道
      expect(percival.evilSeats, label).toEqual([]);
    });
  });

  it("两人的展示顺序会被打乱（顺序本身会泄漏信息）", () => {
    // 找一次发牌，用两个不同 rng 应能得到两种顺序
    const roles = dealRoles(7, "STANDARD", seededRng([3, 1, 4, 1, 5]));
    const asc = computeVision(roles, seededRng([0]))[roles.indexOf("PERCIVAL")]!;
    const desc = computeVision(roles, seededRng([1]))[roles.indexOf("PERCIVAL")]!;
    expect([...asc.merlinCandidates].sort()).toEqual([...desc.merlinCandidates].sort());
    expect(asc.merlinCandidates).not.toEqual(desc.merlinCandidates);
  });
});

describe("computeVision · 红方互认", () => {
  it("有视野的红方看到除奥伯伦和自己外的全部红方", () => {
    forEveryDeal(({ roles, label }) => {
      const vision = computeVision(roles, seededRng([1]));
      const visibleEvil = seatsOf(
        roles,
        (r) => ROLES[r].side === "RED" && ROLES[r].visibleToEvil,
      );
      for (const [seat, roleId] of roles.entries()) {
        const meta = ROLES[roleId];
        if (meta.side !== "RED" || !meta.seesEvil) continue;
        expect([...vision[seat]!.evilSeats].sort(), `${label} seat${seat}`).toEqual(
          visibleEvil.filter((s) => s !== seat).sort(),
        );
      }
    });
  });

  it("莫德雷德在红方互认名单里", () => {
    forEveryDeal(({ roles, label }) => {
      const mordred = roles.indexOf("MORDRED");
      if (mordred < 0) return;
      const vision = computeVision(roles, seededRng([1]));
      for (const [seat, roleId] of roles.entries()) {
        if (seat === mordred) continue;
        if (ROLES[roleId].side === "RED" && ROLES[roleId].seesEvil) {
          expect(vision[seat]!.evilSeats, `${label} seat${seat}`).toContain(mordred);
        }
      }
    });
  });

  it("红方队友知道谁是红兰斯洛特", () => {
    forEveryDeal(({ roles, mode, label }) => {
      if (mode !== "LANCELOT") return;
      const redLancelot = roles.indexOf("LANCELOT_RED");
      const vision = computeVision(roles, seededRng([1]));
      for (const [seat, roleId] of roles.entries()) {
        if (ROLES[roleId].side === "RED" && ROLES[roleId].seesEvil) {
          expect(vision[seat]!.lancelotSeats, `${label} seat${seat}`).toEqual([redLancelot]);
        }
      }
    });
  });
});

describe("computeVision · 无视野角色", () => {
  it("奥伯伦什么都看不到，也不出现在任何队友视野里", () => {
    forEveryDeal(({ roles, label }) => {
      const oberon = roles.indexOf("OBERON");
      if (oberon < 0) return;
      const vision = computeVision(roles, seededRng([1]));

      expect(vision[oberon]!.evilSeats, label).toEqual([]);
      expect(vision[oberon]!.merlinCandidates, label).toEqual([]);

      for (const [seat, roleId] of roles.entries()) {
        if (seat === oberon) continue;
        if (roleId === "MERLIN") continue; // 梅林看得见他
        expect(vision[seat]!.evilSeats, `${label} seat${seat}`).not.toContain(oberon);
      }
    });
  });

  it("忠臣、蓝兰斯洛特、红兰斯洛特一律没有视野", () => {
    forEveryDeal(({ roles, label }) => {
      const vision = computeVision(roles, seededRng([1]));
      for (const [seat, roleId] of roles.entries()) {
        if (!["LOYAL_SERVANT", "LANCELOT_BLUE", "LANCELOT_RED"].includes(roleId)) continue;
        expect(vision[seat], `${label} ${roleId}@${seat}`).toEqual({
          evilSeats: [],
          merlinCandidates: [],
          lancelotSeats: [],
          counterpartSeat: null,
        });
      }
    });
  });
});

/**
 * 官方 Lancelot promo 变体 #3。默认是**不互认**（变体 #1/#2 的揭示阶段
 * 只让红兰伸拇指给红方认，两位兰斯洛特彼此并不知情），所以这里既要验开了之后
 * 认得到，也要验没开时一个字都不多给。
 */
describe("computeVision · 兰斯洛特互认（变体 #3）", () => {
  const lancelotSeatsOf = (roles: readonly RoleId[]) =>
    roles.flatMap((r, seat) => (ROLES[r].isLancelot ? [seat] : []));

  it("开了之后，两位兰斯洛特互相认得对方，且只多知道这一件事", () => {
    forEveryDeal(({ roles, mode, label }) => {
      if (mode !== "LANCELOT") return;
      const vision = computeVision(roles, seededRng([1]), { lancelotsKnowEachOther: true });
      const [a, b] = lancelotSeatsOf(roles) as [number, number];

      expect(vision[a]!.counterpartSeat, `${label} 蓝/红兰@${a}`).toBe(b);
      expect(vision[b]!.counterpartSeat, `${label} 蓝/红兰@${b}`).toBe(a);
      // 除了对家，兰斯洛特依旧什么都不知道
      for (const seat of [a, b]) {
        expect(vision[seat]!.evilSeats, `${label} @${seat}`).toEqual([]);
        expect(vision[seat]!.merlinCandidates, `${label} @${seat}`).toEqual([]);
        expect(vision[seat]!.lancelotSeats, `${label} @${seat}`).toEqual([]);
      }
    });
  });

  it("开了之后，别人的视野一个字都不变", () => {
    forEveryDeal(({ roles, mode, label }) => {
      if (mode !== "LANCELOT") return;
      const off = computeVision(roles, seededRng([1]), { lancelotsKnowEachOther: false });
      const on = computeVision(roles, seededRng([1]), { lancelotsKnowEachOther: true });
      const lancelots = new Set(lancelotSeatsOf(roles));
      for (const seat of roles.keys()) {
        if (lancelots.has(seat)) continue;
        expect(on[seat], `${label} @${seat} ${roles[seat]}`).toEqual(off[seat]);
      }
    });
  });

  it("默认（不传 settings / 关着）谁都不认识对家", () => {
    forEveryDeal(({ roles, label }) => {
      for (const v of [
        computeVision(roles, seededRng([1])),
        computeVision(roles, seededRng([1]), { lancelotsKnowEachOther: false }),
      ]) {
        for (const seat of roles.keys()) {
          expect(v[seat]!.counterpartSeat, `${label} @${seat}`).toBeNull();
        }
      }
    });
  });

  it("标准模式没有兰斯洛特，开了也不该凭空造出对家", () => {
    forEveryDeal(({ roles, mode, label }) => {
      if (mode !== "STANDARD") return;
      const vision = computeVision(roles, seededRng([1]), { lancelotsKnowEachOther: true });
      for (const seat of roles.keys()) {
        expect(vision[seat]!.counterpartSeat, `${label} @${seat}`).toBeNull();
      }
    });
  });
});

describe("computeVision · 全局不变量", () => {
  it("没有任何人的视野包含自己", () => {
    forEveryDeal(({ roles, label }) => {
      const vision = computeVision(roles, seededRng([1]));
      for (const [seat, v] of vision.entries()) {
        expect(v.evilSeats, `${label} seat${seat}`).not.toContain(seat);
      }
    });
  });

  it("蓝方除梅林、派西维尔外没有任何情报", () => {
    forEveryDeal(({ roles, label }) => {
      const vision = computeVision(roles, seededRng([1]));
      for (const [seat, roleId] of roles.entries()) {
        if (ROLES[roleId].side !== "BLUE") continue;
        if (roleId === "MERLIN" || roleId === "PERCIVAL") continue;
        expect(vision[seat]!.evilSeats, `${label} ${roleId}@${seat}`).toEqual([]);
        expect(vision[seat]!.merlinCandidates, `${label} ${roleId}@${seat}`).toEqual([]);
      }
    });
  });

  it("lancelotSeats 一定是 evilSeats 的子集", () => {
    forEveryDeal(({ roles, label }) => {
      const vision = computeVision(roles, seededRng([1]));
      for (const [seat, v] of vision.entries()) {
        for (const s of v.lancelotSeats) {
          expect(v.evilSeats, `${label} seat${seat}`).toContain(s);
        }
      }
    });
  });

  it("视野只引用合法座位号", () => {
    forEveryDeal(({ roles, playerCount, label }) => {
      const vision = computeVision(roles, seededRng([1]));
      for (const v of vision) {
        for (const s of [...v.evilSeats, ...v.merlinCandidates, ...v.lancelotSeats]) {
          expect(s, label).toBeGreaterThanOrEqual(0);
          expect(s, label).toBeLessThan(playerCount);
        }
      }
    });
  });
});
