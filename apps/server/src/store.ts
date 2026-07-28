/**
 * Redis 快照。**不是数据库** —— 内存才是唯一真相（PLAN.md §2.2）。
 * 它只解决一件事：进程重启（部署、崩溃）时正在进行的对局不至于全丢。
 *
 * 因此：
 *   - 写入是防抖的，掉几百毫秒的状态无所谓
 *   - 结构变更时直接换 KEY_VERSION，旧快照自然失效，不做迁移
 *   - Redis 挂了不影响对局，只是重启会丢局
 */

import { Redis } from "ioredis";
import type { GameState } from "@avalon/engine";
import { config } from "./config.js";
import type { Room, RoomPlayer } from "./rooms.js";
import { logger } from "./logger.js";

/** 快照结构一变就 +1，旧数据自动作废。对局是短生命周期数据，清掉无损失 */
const KEY_VERSION = "v2"; // 座位模型改成定长槽位，v1 快照不兼容
const roomKey = (id: string) => `avalon:${KEY_VERSION}:room:${id}`;
const reportKey = (id: string) => `avalon:${KEY_VERSION}:report:${id}`;
const ROOM_INDEX = `avalon:${KEY_VERSION}:rooms`;

interface RoomSnapshot {
  readonly id: string;
  readonly name: string;
  readonly visibility: Room["visibility"];
  readonly allowSpectators: boolean;
  readonly hostId: string;
  readonly players: readonly RoomPlayer[];
  readonly seatCount: number;
  readonly seats: readonly (string | null)[];
  readonly settings: Room["settings"];
  readonly game: GameState | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly ownerIp: string;
}

const toSnapshot = (room: Room): RoomSnapshot => ({
  id: room.id,
  name: room.name,
  visibility: room.visibility,
  allowSpectators: room.allowSpectators,
  hostId: room.hostId,
  // 快照落盘时全员按掉线记 —— 进程都重启了，所有 socket 必然已经断开
  players: [...room.players.values()].map((p) => ({ ...p, connected: false, ready: false, disconnectedAt: room.updatedAt })),
  seatCount: room.seatCount,
  seats: [...room.seats],
  settings: room.settings,
  game: room.game,
  createdAt: room.createdAt,
  updatedAt: room.updatedAt,
  ownerIp: room.ownerIp,
});

const fromSnapshot = (snap: RoomSnapshot): Room => ({
  id: snap.id,
  name: snap.name,
  visibility: snap.visibility,
  allowSpectators: snap.allowSpectators,
  hostId: snap.hostId,
  hostOfflineSince: snap.updatedAt,
  players: new Map(snap.players.map((p) => [p.id, { ...p }])),
  seatCount: snap.seatCount,
  seats: [...snap.seats],
  settings: snap.settings,
  game: snap.game,
  createdAt: snap.createdAt,
  updatedAt: snap.updatedAt,
  ownerIp: snap.ownerIp,
  // 换座请求不跨进程重启保留 —— 双方都断开了，请求本来就该作废
  pendingSwap: null,
});

export const createStore = () => {
  const redis = new Redis(config.redisUrl, {
    // Redis 挂了不该拖垮对局：重试两次就放弃，调用方 catch 掉继续跑
    maxRetriesPerRequest: 2,
    lazyConnect: false,
    // 保留离线队列：连接建立前发出的命令排队等待，而不是直接抛。
    // 关掉它会让启动瞬间的 restoreAll 必然失败 —— 那时 TCP 还没握完手。
    enableOfflineQueue: true,
    retryStrategy: (times) => Math.min(times * 500, 5_000),
  });

  redis.on("error", (e: Error) => logger.warn({ err: e.message }, "redis 连接异常，对局不受影响"));

  /** 等连接就绪。Redis 不可用时不能把启动卡死，所以带超时 */
  const waitReady = (timeoutMs = 5_000): Promise<boolean> =>
    new Promise((resolve) => {
      if (redis.status === "ready") return resolve(true);
      const done = (value: boolean) => {
        clearTimeout(timer);
        redis.off("ready", onReady);
        resolve(value);
      };
      const onReady = () => done(true);
      const timer = setTimeout(() => done(false), timeoutMs);
      timer.unref();
      redis.once("ready", onReady);
    });

  const pending = new Map<string, NodeJS.Timeout>();

  const writeNow = async (room: Room): Promise<void> => {
    try {
      const ttl = Math.ceil((config.finishedRoomMs + config.idleRoomMs) / 1000);
      await redis
        .multi()
        .set(roomKey(room.id), JSON.stringify(toSnapshot(room)), "EX", ttl)
        .sadd(ROOM_INDEX, room.id)
        .exec();
    } catch (e) {
      logger.warn({ err: String(e), roomId: room.id }, "写快照失败");
    }
  };

  /** 防抖写入。同一房间连续变更只落最后一次 */
  const save = (room: Room): void => {
    const existing = pending.get(room.id);
    if (existing) clearTimeout(existing);
    pending.set(
      room.id,
      setTimeout(() => {
        pending.delete(room.id);
        void writeNow(room);
      }, config.snapshotDebounceMs).unref(),
    );
  };

  const remove = async (roomId: string): Promise<void> => {
    const timer = pending.get(roomId);
    if (timer) {
      clearTimeout(timer);
      pending.delete(roomId);
    }
    try {
      await redis.multi().del(roomKey(roomId)).srem(ROOM_INDEX, roomId).exec();
    } catch (e) {
      logger.warn({ err: String(e), roomId }, "删除快照失败");
    }
  };

  /** 启动时恢复。解析失败的快照直接丢弃，不试图修 */
  const restoreAll = async (): Promise<Room[]> => {
    if (!(await waitReady())) {
      logger.warn("redis 未就绪，按空房间列表启动");
      return [];
    }
    try {
      const ids = await redis.smembers(ROOM_INDEX);
      if (ids.length === 0) return [];
      const raw = await redis.mget(ids.map(roomKey));
      const rooms: Room[] = [];
      const stale: string[] = [];
      for (const [i, json] of raw.entries()) {
        const id = ids[i]!;
        if (!json) {
          stale.push(id);
          continue;
        }
        try {
          rooms.push(fromSnapshot(JSON.parse(json) as RoomSnapshot));
        } catch {
          stale.push(id);
        }
      }
      if (stale.length > 0) await redis.srem(ROOM_INDEX, ...stale);
      return rooms;
    } catch (e) {
      logger.warn({ err: String(e) }, "恢复快照失败，按空房间列表启动");
      return [];
    }
  };

  /** 终局战报，供复盘页看。TTL 到期自动清 */
  const saveReport = async (roomId: string, report: unknown): Promise<void> => {
    try {
      await redis.set(reportKey(roomId), JSON.stringify(report), "EX", config.reportTtlSeconds);
    } catch (e) {
      logger.warn({ err: String(e), roomId }, "写战报失败");
    }
  };

  const loadReport = async (roomId: string): Promise<unknown | null> => {
    try {
      const raw = await redis.get(reportKey(roomId));
      return raw ? (JSON.parse(raw) as unknown) : null;
    } catch {
      return null;
    }
  };

  const close = async (): Promise<void> => {
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear();
    await redis.quit().catch(() => undefined);
  };

  return { save, saveNow: writeNow, remove, restoreAll, saveReport, loadReport, close, redis };
};

export type Store = ReturnType<typeof createStore>;
