/**
 * 从**终局**状态算每个座位的战绩指标。纯函数，零 I/O。
 *
 * 只在 `GAME_OVER` 之后调用 —— 它读的是 `roles`（全员真实身份），
 * 对局途中这是最高机密。调用方必须自己保证这一点，函数里也再挡一道。
 *
 * 指标口径写在每个字段上。口径不写清楚，排行榜就是一堆没人看得懂的数字。
 */

import type { RoleId, Side } from "@avalon/shared";
import type { GameState } from "./types.js";

/** 一局里某个座位的贡献。全部是可累加的计数，聚合时直接相加 */
export interface SeatStats {
  readonly games: 1;
  readonly wins: 0 | 1;

  /** 以对局结束时的阵营算（兰斯洛特可能换过边） */
  readonly asBlue: 0 | 1;
  readonly blueWins: 0 | 1;
  readonly asRed: 0 | 1;
  readonly redWins: 0 | 1;

  /** 当队长且车通过的次数 */
  readonly leaderApproved: number;
  /** 其中车上有红方的次数。→ 带狼上车率 */
  readonly leaderApprovedWithEvil: number;

  /** 投反对的总次数 */
  readonly votedReject: number;
  /** 其中那车确实有红方。→ 反对准确率 */
  readonly votedRejectWithEvil: number;
  /** 投赞成的总次数 */
  readonly votedApprove: number;
  /** 其中那车有红方。→ 赞成失误率 */
  readonly votedApproveWithEvil: number;

  /** 当刺客并执行了刺杀的次数（每局至多 1） */
  readonly assassinated: 0 | 1;
  /** 刺中梅林 */
  readonly assassinatedHit: 0 | 1;

  /** 当梅林的次数 */
  readonly asMerlin: 0 | 1;
  /** 当梅林且没被刺中 */
  readonly merlinSurvived: 0 | 1;
}

const ZERO: SeatStats = {
  games: 1,
  wins: 0,
  asBlue: 0,
  blueWins: 0,
  asRed: 0,
  redWins: 0,
  leaderApproved: 0,
  leaderApprovedWithEvil: 0,
  votedReject: 0,
  votedRejectWithEvil: 0,
  votedApprove: 0,
  votedApproveWithEvil: 0,
  assassinated: 0,
  assassinatedHit: 0,
  asMerlin: 0,
  merlinSurvived: 0,
};

/**
 * 「这车有狼吗」按**对局结束时的阵营**判断。
 *
 * 兰斯洛特换过边的话，当时车上那个人到底算不算狼是有歧义的；
 * 用终局阵营是唯一能一致复现的口径 —— 复盘时看到的身份也是这一套。
 */
const teamHasEvil = (team: readonly number[], sides: readonly Side[]): boolean =>
  team.some((seat) => sides[seat] === "RED");

/**
 * 算战绩需要的**全部**输入。
 *
 * 刻意不收 `GameState` —— 归档里的 `MatchRecord` 也能凑出这几样，
 * 于是「归档时算」和「事后按新口径重算」走的是同一份实现，不会漂移。
 * 注意这里没有 missions：口径改成「有没有人真的开枪」之后就不需要了。
 */
export interface StatsInput {
  readonly playerCount: number;
  readonly mode: string;
  readonly outcome: {
    readonly winner: Side;
    readonly reason: string;
    readonly assassinatedSeat: number | null;
  };
  readonly roles: readonly RoleId[];
  /** 终局阵营。兰斯洛特换过边的话和 roles 对不上 */
  readonly sides: readonly Side[];
  readonly proposals: readonly {
    readonly leaderSeat: number;
    readonly team: readonly number[];
    readonly votes: readonly boolean[];
    readonly approved: boolean;
  }[];
}

export const statsFrom = (input: StatsInput): readonly SeatStats[] => {
  const { outcome, sides, roles, proposals } = input;
  const merlinSeat = roles.indexOf("MERLIN" satisfies RoleId);

  return Array.from({ length: input.playerCount }, (_, seat) => {
    const side = sides[seat]!;
    const won = side === outcome.winner;

    let leaderApproved = 0;
    let leaderApprovedWithEvil = 0;
    let votedReject = 0;
    let votedRejectWithEvil = 0;
    let votedApprove = 0;
    let votedApproveWithEvil = 0;

    for (const p of proposals) {
      const evilAboard = teamHasEvil(p.team, sides);

      // 带狼上车率只看**通过的**车 —— 被否决的车没上路，不该算在头上
      if (p.leaderSeat === seat && p.approved) {
        leaderApproved += 1;
        if (evilAboard) leaderApprovedWithEvil += 1;
      }

      const vote = p.votes[seat];
      if (vote === true) {
        votedApprove += 1;
        if (evilAboard) votedApproveWithEvil += 1;
      } else if (vote === false) {
        votedReject += 1;
        if (evilAboard) votedRejectWithEvil += 1;
      }
    }

    // 刺杀：只算真的动了手那一次。没走到刺杀阶段就不计入分母
    const didAssassinate =
      outcome.assassinatedSeat !== null &&
      roles[seat] === (input.mode === "LANCELOT" ? "MORGANA" : "ASSASSIN");
    const hit = didAssassinate && outcome.reason === "ASSASSINATION_HIT";

    const isMerlin = seat === merlinSeat;
    /*
     * 「被考验过」= **真的有人开了枪**，而不是「蓝方拿满三次任务」。
     *
     * 原来按三次成功算，把**提前刺杀**整个漏掉了：那时刺客打完 2 次任务就能动手，
     * 梅林实打实挨了一刀，却既不进分母也不进分子 —— 存活率显示「—」，
     * 看起来就像这局根本没当过梅林。
     *
     * 红方靠任务赢、没走到刺杀的局仍然不算：那种局梅林确实没被考验过。
     */
    const merlinTested = isMerlin && outcome.assassinatedSeat !== null;

    return {
      ...ZERO,
      wins: won ? 1 : 0,
      asBlue: side === "BLUE" ? 1 : 0,
      blueWins: side === "BLUE" && won ? 1 : 0,
      asRed: side === "RED" ? 1 : 0,
      redWins: side === "RED" && won ? 1 : 0,
      leaderApproved,
      leaderApprovedWithEvil,
      votedReject,
      votedRejectWithEvil,
      votedApprove,
      votedApproveWithEvil,
      assassinated: didAssassinate ? 1 : 0,
      assassinatedHit: hit ? 1 : 0,
      asMerlin: merlinTested ? 1 : 0,
      merlinSurvived: merlinTested && outcome.reason !== "ASSASSINATION_HIT" ? 1 : 0,
    } satisfies SeatStats;
  });
};

/** 归档那一刻从对局状态算。事后重算走 `statsFrom` —— 同一份实现 */
export const seatStats = (state: GameState): readonly SeatStats[] => {
  if (state.phase !== "GAME_OVER" || !state.outcome) {
    throw new Error("战绩只能在对局结束后统计");
  }
  return statsFrom({
    playerCount: state.playerCount,
    mode: state.settings.mode,
    outcome: state.outcome,
    roles: state.roles,
    sides: state.sides,
    proposals: state.proposals,
  });
};

/** 累计战绩。字段和 SeatStats 一一对应，只是 games/wins 不再限定 0|1 */
export type PlayerStats = { -readonly [K in keyof SeatStats]: number };

export const emptyStats = (): PlayerStats => ({
  games: 0,
  wins: 0,
  asBlue: 0,
  blueWins: 0,
  asRed: 0,
  redWins: 0,
  leaderApproved: 0,
  leaderApprovedWithEvil: 0,
  votedReject: 0,
  votedRejectWithEvil: 0,
  votedApprove: 0,
  votedApproveWithEvil: 0,
  assassinated: 0,
  assassinatedHit: 0,
  asMerlin: 0,
  merlinSurvived: 0,
});

export const addStats = (a: PlayerStats, b: SeatStats | PlayerStats): PlayerStats => {
  const out = emptyStats();
  for (const key of Object.keys(out) as (keyof PlayerStats)[]) {
    out[key] = a[key] + b[key];
  }
  return out;
};

/** 比率。分母为 0 时返回 null —— 用 0 会让「没数据」看着像「表现极差」 */
export const rate = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? numerator / denominator : null;
