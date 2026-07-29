/**
 * 战绩档案与排行榜。**这一层是唯一持久化的东西** ——
 * 房间快照会过期、会被清，档案不会。
 *
 * 没有账号系统，所以「一个人」= localStorage 里那个 `playerId`。
 * 清缓存或换手机就是换了个人，这点无解，页面上要写明白。
 *
 * 写入时机：**只在 `GAME_OVER` 之后**。它读的是全员真实身份，
 * 对局途中写等于把机密落盘，也可能被别的路径读出去。
 */

import type { Redis } from "ioredis";
import type { Avatar, Outcome } from "@avalon/shared";
import { addStats, emptyStats, seatStats, type PlayerStats } from "@avalon/engine";
import type { GameState } from "@avalon/engine";
import { logger } from "./logger.js";
import type { Room } from "./rooms.js";
import { occupants } from "./rooms.js";

/** 档案结构一变就 +1。战绩是长期数据，不能像房间快照那样说清就清 */
const V = "v1";
const playerKey = (id: string) => `avalon:rec:${V}:player:${id}`;
const PLAYER_INDEX = `avalon:rec:${V}:players`;
const matchKey = (id: string) => `avalon:rec:${V}:match:${id}`;
const MATCH_INDEX = `avalon:rec:${V}:matches`;

/** 排行榜只收够局数的人，否则一局全胜的人永远挂在榜首 */
export const RANKED_MIN_GAMES = 5;
/** 对局列表最多留这么多条，防止无限膨胀 */
const MATCH_LIST_MAX = 2000;

export interface PlayerRecord {
  readonly id: string;
  /** 最后一次用的昵称头像 —— 没有账号，只能记最近这次 */
  readonly nick: string;
  readonly avatar: Avatar;
  readonly updatedAt: number;
  readonly stats: PlayerStats;
}

/** 归档的一局。终局之后才写，所以身份全部公开 */
export interface MatchRecord {
  readonly id: string;
  readonly roomId: string;
  readonly roomName: string;
  readonly finishedAt: number;
  readonly playerCount: number;
  readonly mode: string;
  readonly outcome: Outcome;
  readonly seats: readonly {
    readonly seat: number;
    readonly playerId: string;
    readonly nick: string;
    readonly avatar: Avatar;
    readonly roleId: string;
    readonly side: string;
    readonly won: boolean;
  }[];
  readonly missions: readonly {
    readonly roundIndex: number;
    readonly leaderSeat: number;
    readonly team: readonly number[];
    readonly failCount: number;
    readonly success: boolean;
    /**
     * 出了失败牌的座位，升序。**只在档案里有** —— 对局中的下行视图
     * （`PublicMissionSummary`）永远没有这个字段，铁律 3 原样不动。
     *
     * 老档案没有这一项，读出来是 undefined，页面按「不记录」处理。
     */
    readonly failedBy?: readonly number[];
  }[];
  readonly proposals: readonly {
    readonly roundIndex: number;
    readonly attempt: number;
    readonly leaderSeat: number;
    readonly team: readonly number[];
    readonly votes: readonly boolean[];
    readonly approved: boolean;
  }[];
}

export const createRecords = (redis: Redis) => {
  const readPlayer = async (id: string): Promise<PlayerRecord | null> => {
    const raw = await redis.get(playerKey(id));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PlayerRecord;
    } catch {
      return null;
    }
  };

  /**
   * 归档一局，并把每个人的战绩累加进档案。
   * @returns 归档 id，失败返回 null（Redis 挂了不该拖垮对局）
   */
  const archive = async (room: Room, now: number): Promise<string | null> => {
    const game: GameState | null = room.game;
    if (!game || game.phase !== "GAME_OVER" || !game.outcome) return null;

    try {
      const perSeat = seatStats(game);
      const seatIds = room.seats;
      const matchId = `${room.id}-${now.toString(36)}`;

      const seats = seatIds.map((playerId, seat) => {
        const p = playerId ? room.players.get(playerId) : undefined;
        return {
          seat,
          playerId: playerId ?? "",
          nick: p?.nick ?? "已离开",
          avatar: p?.avatar ?? { seed: "gone", bg: "2a3145" },
          roleId: game.roles[seat]!,
          side: game.sides[seat]!,
          won: game.sides[seat] === game.outcome!.winner,
        };
      });

      const record: MatchRecord = {
        id: matchId,
        roomId: room.id,
        roomName: room.name,
        finishedAt: now,
        playerCount: game.playerCount,
        mode: game.settings.mode,
        outcome: game.outcome,
        seats,
        missions: game.missions.map((m) => ({
          roundIndex: m.roundIndex,
          leaderSeat: m.leaderSeat,
          team: [...m.team],
          failCount: m.failCount,
          success: m.success,
          /*
           * 谁放的失败牌 —— 只落进档案，复盘时才看得到。
           *
           * 敢公开是因为归档发生在终局之后，那时 `seats` 已经把全员身份
           * 摊开了，而失败牌只有红方能放：说出座位号，并不比阵容表多给出
           * 什么。对局**途中**它照样是能直接判负的机密，projectFor 里
           * 那段逐字段裁剪一个字都没改。
           *
           * 存座位而不是存 cardsBySeat 整个映射：出成功牌的人不该被记一笔，
           * 那是没有信息量的默认动作。
           */
          // 注意极性：cardsBySeat 里 true 是**成功**牌，失败牌是 false
          failedBy: Object.entries(m.cardsBySeat)
            .filter(([, success]) => !success)
            .map(([seat]) => Number(seat))
            .sort((a, b) => a - b),
        })),
        proposals: game.proposals.map((p) => ({
          roundIndex: p.roundIndex,
          attempt: p.attempt,
          leaderSeat: p.leaderSeat,
          team: [...p.team],
          votes: [...p.votes],
          approved: p.approved,
        })),
      };

      const tx = redis.multi();
      // 对局永久保留，不设 TTL
      tx.set(matchKey(matchId), JSON.stringify(record));
      tx.lpush(MATCH_INDEX, matchId);
      tx.ltrim(MATCH_INDEX, 0, MATCH_LIST_MAX - 1);

      // 逐人累加。先读后写有竞态，但同一个人不会同时结束两局，够用了
      for (const [seat, playerId] of seatIds.entries()) {
        if (!playerId) continue;
        const player = room.players.get(playerId);
        const prev = await readPlayer(playerId);
        const next: PlayerRecord = {
          id: playerId,
          nick: player?.nick ?? prev?.nick ?? "无名氏",
          avatar: player?.avatar ?? prev?.avatar ?? { seed: playerId, bg: "2a3145" },
          updatedAt: now,
          stats: addStats(prev?.stats ?? emptyStats(), perSeat[seat]!),
        };
        tx.set(playerKey(playerId), JSON.stringify(next));
        tx.zadd(PLAYER_INDEX, next.stats.games, playerId);
      }

      await tx.exec();
      return matchId;
    } catch (e) {
      logger.warn({ err: String(e), roomId: room.id }, "归档战绩失败");
      return null;
    }
  };

  /** 排行榜。按局数取出候选再在内存里排 —— 玩家总数是几百量级，不值得上 Lua */
  const leaderboard = async (limit = 50): Promise<PlayerRecord[]> => {
    try {
      const ids = await redis.zrevrange(PLAYER_INDEX, 0, 499);
      if (ids.length === 0) return [];
      const raw = await redis.mget(ids.map(playerKey));
      return raw
        .flatMap((json) => {
          if (!json) return [];
          try {
            return [JSON.parse(json) as PlayerRecord];
          } catch {
            return [];
          }
        })
        .filter((p) => p.stats.games >= RANKED_MIN_GAMES)
        .sort((a, b) => {
          const wa = a.stats.wins / a.stats.games;
          const wb = b.stats.wins / b.stats.games;
          // 胜率相同就比局数 —— 打得多的更可信
          return wb - wa || b.stats.games - a.stats.games;
        })
        .slice(0, limit);
    } catch (e) {
      logger.warn({ err: String(e) }, "读排行榜失败");
      return [];
    }
  };

  const recentMatches = async (limit = 30): Promise<MatchRecord[]> => {
    try {
      const ids = await redis.lrange(MATCH_INDEX, 0, limit - 1);
      if (ids.length === 0) return [];
      const raw = await redis.mget(ids.map(matchKey));
      return raw.flatMap((json) => {
        if (!json) return [];
        try {
          return [JSON.parse(json) as MatchRecord];
        } catch {
          return [];
        }
      });
    } catch {
      return [];
    }
  };

  const match = async (id: string): Promise<MatchRecord | null> => {
    try {
      const raw = await redis.get(matchKey(id));
      return raw ? (JSON.parse(raw) as MatchRecord) : null;
    } catch {
      return null;
    }
  };

  /** 某人的档案 + 他打过的局 */
  const player = async (id: string): Promise<{ profile: PlayerRecord; matches: MatchRecord[] } | null> => {
    const profile = await readPlayer(id);
    if (!profile) return null;
    const all = await recentMatches(200);
    return { profile, matches: all.filter((m) => m.seats.some((s) => s.playerId === id)).slice(0, 30) };
  };

  return { archive, leaderboard, recentMatches, match, player, readPlayer };
};

export type Records = ReturnType<typeof createRecords>;
export { occupants };
