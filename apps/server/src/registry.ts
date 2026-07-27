/**
 * 全站房间注册表。内存是唯一真相，Redis 只做快照。
 * 建房限流、并发房间数、空闲回收都在这里。
 */

import type { RoomSummary } from "@avalon/shared";
import { config } from "./config.js";
import { createCounter, createRateLimiter } from "./ratelimit.js";
import {
  createRoom,
  maybeTransferHost,
  roomSummary,
  shouldCollect,
  type Room,
} from "./rooms.js";

export interface CreateRoomInput {
  readonly name: string;
  readonly visibility: "PUBLIC" | "PRIVATE";
  readonly allowSpectators: boolean;
  readonly hostId: string;
  readonly ip: string;
  readonly now: number;
}

export type CreateRoomResult =
  | { readonly ok: true; readonly room: Room }
  | { readonly ok: false; readonly error: string };

export const createRegistry = () => {
  const rooms = new Map<string, Room>();
  const createLimiter = createRateLimiter(config.roomCreatePerIp, config.roomCreateWindowMs);
  const roomsPerIp = createCounter();

  const get = (id: string): Room | undefined => rooms.get(id);

  const create = (input: CreateRoomInput): CreateRoomResult => {
    if (rooms.size >= config.maxRooms) {
      return { ok: false, error: "服务器房间已满，请稍后再试" };
    }
    if (roomsPerIp.get(input.ip) >= config.maxRoomsPerIp) {
      return { ok: false, error: `同一网络最多同时开 ${config.maxRoomsPerIp} 个房间` };
    }
    if (!createLimiter.hit(input.ip, input.now)) {
      const minutes = Math.ceil(config.roomCreateWindowMs / 60_000);
      return { ok: false, error: `建房太频繁了，${minutes} 分钟内最多 ${config.roomCreatePerIp} 个` };
    }

    const room = createRoom({ ...input, ownerIp: input.ip, existingIds: new Set(rooms.keys()) });
    rooms.set(room.id, room);
    roomsPerIp.inc(input.ip);
    return { ok: true, room };
  };

  /**
   * 把从 Redis 快照恢复的房间放回内存。
   * 不走建房限流 —— 这不是新建，是重启前就存在的房间；但要占用并发房间数。
   */
  const adopt = (room: Room): void => {
    if (rooms.has(room.id)) return;
    rooms.set(room.id, room);
    roomsPerIp.inc(room.ownerIp);
  };

  const destroy = (id: string): void => {
    const room = rooms.get(id);
    if (!room) return;
    rooms.delete(id);
    roomsPerIp.dec(room.ownerIp);
  };

  /** 公开房间列表。私密房不进列表，只能凭房间码进 */
  const list = (query?: string): RoomSummary[] => {
    const needle = query?.trim().toLowerCase();
    return [...rooms.values()]
      .filter((r) => r.visibility === "PUBLIC")
      .filter((r) => !needle || r.name.toLowerCase().includes(needle) || r.id.toLowerCase() === needle)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 100)
      .map(roomSummary);
  };

  /**
   * 定时清扫：回收空房间、处理房主自动移交。
   * @returns 本次发生变化的房间 id，调用方据此推送状态
   */
  const sweep = (now: number): { collected: string[]; hostChanged: string[] } => {
    const collected: string[] = [];
    const hostChanged: string[] = [];

    for (const room of [...rooms.values()]) {
      if (shouldCollect(room, now)) {
        destroy(room.id);
        collected.push(room.id);
        continue;
      }
      if (maybeTransferHost(room, now) !== null) hostChanged.push(room.id);
    }
    createLimiter.sweep(now);
    return { collected, hostChanged };
  };

  return {
    get,
    create,
    adopt,
    destroy,
    list,
    sweep,
    size: () => rooms.size,
    all: () => [...rooms.values()],
  };
};

export type Registry = ReturnType<typeof createRegistry>;
