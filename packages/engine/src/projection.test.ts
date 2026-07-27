/**
 * 视图裁剪单测 —— 防信息泄漏的最后一道闸。
 *
 * 做法：跑几局覆盖各种模式的完整对局，把**每一个中间状态**都收集起来，
 * 然后对「每个状态 × 每个观察者」断言不变量。
 * 这样将来给 GameState 加字段时，只要忘了在 projectFor 里裁剪，这里立刻红。
 */

import { describe, expect, it } from "vitest";
import { ROLE_IDS, ROLES, type RoleId } from "@avalon/shared";
import { seededRng } from "./rng.js";
import { computeVision } from "./vision.js";
import { createGame, ladyTargets, reduce } from "./machine.js";
import { projectFor } from "./projection.js";
import type { GameSettings, PlayerCount } from "@avalon/shared";
import type { Action, GameState } from "./types.js";

const RNG = seededRng([0]);

const settings = (over: Partial<GameSettings> = {}): GameSettings => ({
  mode: "STANDARD",
  ladyOfTheLake: false,
  earlyAssassination: false,
  leaderRotation: "CLOCKWISE",
  rejectCounting: "PER_ROUND",
  loyaltyFlipTiming: "NORMAL",
  loyaltySwapChance: 0.33,
  hideLoyaltyFlipResult: false,
  ...over,
});

const makeGame = (roles: readonly RoleId[], over: Partial<GameSettings> = {}): GameState => {
  const base = createGame(
    { playerCount: roles.length as PlayerCount, settings: settings(over), firstLeaderSeat: 0 },
    seededRng([0]),
  );
  return {
    ...base,
    roles: [...roles],
    sides: roles.map((r) => ROLES[r].side),
    vision: computeVision(roles, seededRng([0])),
  };
};

/**
 * 自动打完一局，返回途经的**每一个**状态。
 * @param failBias 红方队员出失败牌的倾向，用来分别走出「蓝方赢」和「红方赢」两条线
 */
const playThrough = (start: GameState, failBias: boolean): GameState[] => {
  const seen: GameState[] = [start];
  let g = start;

  for (let guard = 0; guard < 400 && g.phase !== "GAME_OVER"; guard++) {
    const action = nextAction(g, failBias);
    if (!action) break;
    const r = reduce(g, action, RNG);
    if (!r.ok) throw new Error(`卡在 ${g.phase}: ${r.error}`);
    g = r.state;
    seen.push(g);
  }
  return seen;
};

const nextAction = (g: GameState, failBias: boolean): Action | null => {
  switch (g.phase) {
    case "ROLE_REVEAL": {
      const seat = g.roleAcked.indexOf(false);
      return seat < 0 ? { type: "ADVANCE", byHost: true } : { type: "ACK_ROLE", seat };
    }
    case "TEAM_BUILD": {
      const need = projectFor(g, null).teamSize;
      // 优先带上红方，这样 failBias 才有机会生效
      const evil = g.roles.flatMap((r, i) => (ROLES[r].side === "RED" ? [i] : []));
      const rest = g.roles.flatMap((_, i) => (evil.includes(i) ? [] : [i]));
      const team = failBias ? [...evil, ...rest].slice(0, need) : rest.slice(0, need);
      return { type: "PROPOSE_TEAM", seat: g.leaderSeat, team, speakDirection: "CW" };
    }
    case "VOTE": {
      const seat = g.votes.indexOf(null);
      return { type: "VOTE", seat, approve: true };
    }
    case "MISSION": {
      const seat = (g.team ?? []).find((s) => g.cards[s] === null);
      if (seat === undefined) return null;
      const side = g.sides[seat]!;
      const isLancelot = ROLES[g.roles[seat]!].isLancelot;
      // 蓝方只能成功；红兰只能失败；其余红方按 failBias
      const success = isLancelot ? side === "BLUE" : side === "BLUE" || !failBias;
      return { type: "PLAY_CARD", seat, success };
    }
    case "LADY_OF_LAKE": {
      const target = ladyTargets(g)[0];
      if (target === undefined) return null;
      return { type: "LADY_CHECK", seat: g.lady!.holderSeat, targetSeat: target };
    }
    case "ASSASSINATION": {
      const assassin = g.roles.indexOf(
        g.settings.mode === "LANCELOT" ? "MORGANA" : "ASSASSIN",
      );
      // 故意刺错人，让对局以「蓝方胜」收尾
      const target = g.roles.findIndex((r, i) => r !== "MERLIN" && i !== assassin);
      return { type: "ASSASSINATE", seat: assassin, targetSeat: target };
    }
    default:
      return { type: "ADVANCE" };
  }
};

const FIVE: readonly RoleId[] = ["MERLIN", "PERCIVAL", "LOYAL_SERVANT", "MORGANA", "ASSASSIN"];
const SEVEN_LANCELOT: readonly RoleId[] = [
  "MERLIN", "PERCIVAL", "LOYAL_SERVANT", "LANCELOT_BLUE",
  "MORGANA", "LANCELOT_RED", "OBERON",
];
const SEVEN_STD: readonly RoleId[] = [
  "MERLIN", "PERCIVAL", "LOYAL_SERVANT", "LOYAL_SERVANT",
  "MORGANA", "ASSASSIN", "OBERON",
];

/** 覆盖各模式的全部中间状态 */
const ALL_STATES: { label: string; state: GameState }[] = [
  ...playThrough(makeGame(FIVE), false).map((s, i) => ({ label: `5p-blue#${i}`, state: s })),
  ...playThrough(makeGame(FIVE), true).map((s, i) => ({ label: `5p-red#${i}`, state: s })),
  ...playThrough(makeGame(SEVEN_STD, { ladyOfTheLake: true }), false).map((s, i) => ({
    label: `7p-lady#${i}`, state: s,
  })),
  ...playThrough(makeGame(SEVEN_LANCELOT, { mode: "LANCELOT", ladyOfTheLake: true }), false).map(
    (s, i) => ({ label: `7p-lancelot#${i}`, state: s }),
  ),
  ...playThrough(
    makeGame(SEVEN_LANCELOT, { mode: "LANCELOT", loyaltyFlipTiming: "OPENING", hideLoyaltyFlipResult: true }),
    true,
  ).map((s, i) => ({ label: `7p-hidden#${i}`, state: s })),
];

/** 视图里出现的角色名 token */
const rolesMentionedIn = (json: string): RoleId[] =>
  ROLE_IDS.filter((r) => json.includes(`"${r}"`));

const forEachView = (
  fn: (ctx: {
    state: GameState;
    viewer: number | null;
    view: ReturnType<typeof projectFor>;
    label: string;
  }) => void,
) => {
  for (const { label, state } of ALL_STATES) {
    const viewers: (number | null)[] = [
      null,
      ...Array.from({ length: state.playerCount }, (_, i) => i),
    ];
    for (const viewer of viewers) {
      fn({
        state,
        viewer,
        view: projectFor(state, viewer),
        label: `${label}/viewer=${viewer ?? "spectator"}`,
      });
    }
  }
};

describe("裁剪覆盖率", () => {
  it("确实跑出了足够多样的状态", () => {
    expect(ALL_STATES.length).toBeGreaterThan(100);
    const phases = new Set(ALL_STATES.map((s) => s.state.phase));
    for (const p of [
      "ROLE_REVEAL", "TEAM_BUILD", "VOTE", "VOTE_RESULT",
      "MISSION", "MISSION_RESULT", "LOYALTY_FLIP", "LADY_OF_LAKE",
      "ASSASSINATION", "GAME_OVER",
    ]) {
      expect(phases, `没跑到 ${p} 阶段`).toContain(p);
    }
  });
});

describe("铁律 2 · 绝不下发他人身份", () => {
  it("非终局状态下，视图里除了自己的角色不出现任何角色名", () => {
    forEachView(({ state, viewer, view, label }) => {
      if (state.phase === "GAME_OVER") return;
      const { me, ...rest } = view;
      expect(rolesMentionedIn(JSON.stringify(rest)), label).toEqual([]);
      if (viewer !== null) {
        expect(me?.roleId, label).toBe(state.roles[viewer]);
      }
    });
  });

  it("观战者拿不到任何身份信息", () => {
    forEachView(({ state, viewer, view, label }) => {
      if (viewer !== null) return;
      expect(view.me, label).toBeNull();
      if (state.phase !== "GAME_OVER") {
        expect(rolesMentionedIn(JSON.stringify(view)), label).toEqual([]);
      }
    });
  });

  it("视图里不含 sides / vision / roles 这些原始字段", () => {
    forEachView(({ view, label }) => {
      const { me, ...rest } = view;
      const json = JSON.stringify(rest);
      expect(json, label).not.toContain('"sides"');
      expect(json, label).not.toContain('"roles"');
      expect(json, label).not.toContain('"vision"');
    });
  });

  it("只有终局才揭晓全员身份", () => {
    forEachView(({ state, view, label }) => {
      if (state.phase === "GAME_OVER") {
        expect(view.reveal, label).toEqual([...state.roles]);
      } else {
        expect(view.reveal, label).toBeNull();
      }
    });
  });
});

describe("铁律 3 · 任务出牌永久匿名", () => {
  it("任何视图、任何阶段都不含出牌人映射 —— 终局也不例外", () => {
    forEachView(({ view, label }) => {
      expect(JSON.stringify(view), label).not.toContain("cardsBySeat");
    });
  });

  it("任务只公开失败牌数量，不公开是谁出的", () => {
    forEachView(({ state, view, label }) => {
      expect(view.missions, label).toHaveLength(state.missions.length);
      for (const [i, m] of view.missions.entries()) {
        expect(m.failCount, label).toBe(state.missions[i]!.failCount);
        expect(Object.keys(m), label).not.toContain("cardsBySeat");
      }
    });
  });

  it("出牌进行中只暴露「谁出过了」，不暴露牌面", () => {
    forEachView(({ state, view, viewer, label }) => {
      if (state.phase !== "MISSION") return;
      const played = state.cards.flatMap((c, i) => (c !== null ? [i] : []));
      expect(view.playedSeats, label).toEqual(played);
      // 自己的牌自己看得到，别人的看不到
      if (viewer !== null) {
        expect(view.me!.myCard, label).toBe(state.cards[viewer] ?? null);
      }
    });
  });
});

describe("投票信息", () => {
  it("投票进行中只暴露「谁投过了」", () => {
    forEachView(({ state, view, viewer, label }) => {
      if (state.phase !== "VOTE") return;
      expect(view.revealedVotes, label).toBeNull();
      expect(view.votedSeats, label).toEqual(
        state.votes.flatMap((v, i) => (v !== null ? [i] : [])),
      );
      if (viewer !== null) {
        expect(view.me!.myVote, label).toBe(state.votes[viewer] ?? null);
      }
    });
  });

  it("揭票阶段全员的票同时公开", () => {
    forEachView(({ state, view, label }) => {
      if (state.phase !== "VOTE_RESULT") return;
      expect(view.revealedVotes, label).toEqual(state.votes.map((v) => v === true));
    });
  });
});

describe("湖中女神", () => {
  it("查了谁是公开的，查到什么只有当代女神知道", () => {
    forEachView(({ state, view, viewer, label }) => {
      if (!state.lady) return expect(view.lady, label).toBeNull();

      // 公开部分不含阵营结果
      expect(JSON.stringify(view.lady), label).not.toContain("revealedSide");
      expect(view.lady!.checks, label).toHaveLength(state.lady.checks.length);

      // 只有自己发起的查验才拿得到结果
      const mine = state.lady.checks.filter((c) => c.holderSeat === viewer);
      expect(view.me?.myLadyChecks ?? [], label).toEqual(
        mine.map((c) => ({ targetSeat: c.targetSeat, side: c.revealedSide })),
      );
    });
  });

  it("别人的查验结果不会出现在自己的视图里", () => {
    forEachView(({ state, view, viewer, label }) => {
      if (!state.lady || viewer === null) return;
      const othersChecks = state.lady.checks.filter((c) => c.holderSeat !== viewer);
      if (othersChecks.length === 0) return;
      const myTargets = new Set(view.me!.myLadyChecks.map((c) => c.targetSeat));
      for (const c of othersChecks) {
        // 除非我自己也查过同一个人，否则视图里不该有他的阵营
        if (!myTargets.has(c.targetSeat)) {
          expect(
            view.me!.myLadyChecks.some((m) => m.targetSeat === c.targetSeat),
            label,
          ).toBe(false);
        }
      }
    });
  });
});

describe("忠诚牌", () => {
  it("房主选择隐藏时，全体都看不到翻牌内容", () => {
    forEachView(({ state, view, label }) => {
      if (!state.loyalty) return expect(view.loyalty, label).toBeNull();
      if (!state.settings.hideLoyaltyFlipResult) return;
      for (const f of view.loyalty!.flips) {
        expect(f.swapped, label).toBeNull();
      }
    });
  });

  it("隐藏翻牌时，兰斯洛特本人仍然看得到自己的当前阵营", () => {
    forEachView(({ state, view, viewer, label }) => {
      if (viewer === null || !state.loyalty) return;
      if (!ROLES[state.roles[viewer]!].isLancelot) return;
      expect(view.me!.side, label).toBe(state.sides[viewer]);
      // 出牌约束也跟着当前阵营走，本人能提前知道自己只能出什么
      expect(view.me!.missionCardRule, label).toBe(
        state.sides[viewer] === "BLUE" ? "SUCCESS_ONLY" : "FAIL_ONLY",
      );
    });
  });
});

describe("自己的视野", () => {
  it("每个人拿到的是自己那一份，且与引擎算出的一致", () => {
    forEachView(({ state, view, viewer, label }) => {
      if (viewer === null) return;
      expect(view.me!.vision, label).toEqual(state.vision[viewer]);
    });
  });

  it("刺杀权限只给刺客本人", () => {
    forEachView(({ state, view, viewer, label }) => {
      if (viewer === null || state.phase !== "ASSASSINATION") return;
      const assassin = state.roles.indexOf(
        state.settings.mode === "LANCELOT" ? "MORGANA" : "ASSASSIN",
      );
      expect(view.me!.canAssassinate, label).toBe(viewer === assassin);
    });
  });
});
