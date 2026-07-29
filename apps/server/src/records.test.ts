/**
 * 归档层。重点只有一个：**哪些机密允许落进永久档案，哪些不允许。**
 *
 * 档案和实时下行视图是两条完全不同的线 —— 档案写在终局之后，本来就带着
 * 全员身份；下行视图在对局途中，一个字都不能多。这里锁的是那条分界线。
 */

import { describe, expect, it } from "vitest";
import { TEAM_SIZE, type Avatar, type ClientAction } from "@avalon/shared";
import { createRecords, type MatchRecord } from "./records.js";
import {
  applyAction,
  createRoom,
  joinRoom,
  setReady,
  setSeatCount,
  sit,
  startGame,
  type Room,
} from "./rooms.js";

const AVATAR: Avatar = { seed: "x", bg: "112233" };
const T0 = 1_700_000_000_000;
const SEATS = [0, 1, 2, 3, 4];

/** 够用的内存版 Redis。只实现 archive / match 走到的那几个命令 */
const fakeRedis = () => {
  const kv = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const zset = new Map<string, Map<string, number>>();
  const queue: (() => void)[] = [];

  const tx = {
    set: (k: string, v: string) => (queue.push(() => void kv.set(k, v)), tx),
    lpush: (k: string, v: string) => (
      queue.push(() => void lists.set(k, [v, ...(lists.get(k) ?? [])])), tx
    ),
    ltrim: (k: string, a: number, b: number) => (
      queue.push(() => void lists.set(k, (lists.get(k) ?? []).slice(a, b + 1))), tx
    ),
    zadd: (k: string, score: number, m: string) => (
      queue.push(() => {
        const z = zset.get(k) ?? new Map<string, number>();
        z.set(m, score);
        zset.set(k, z);
      }),
      tx
    ),
    exec: async () => {
      for (const op of queue.splice(0)) op();
      return [];
    },
  };

  return {
    get: async (k: string) => kv.get(k) ?? null,
    mget: async (ks: string[]) => ks.map((k) => kv.get(k) ?? null),
    lrange: async (k: string, a: number, b: number) =>
      (lists.get(k) ?? []).slice(a, b < 0 ? undefined : b + 1),
    zrevrange: async (k: string, a: number, b: number) =>
      [...(zset.get(k) ?? new Map<string, number>())]
        .sort((x, y) => y[1] - x[1])
        .map(([m]) => m)
        .slice(a, b < 0 ? undefined : b + 1),
    multi: () => tx,
  } as unknown as Parameters<typeof createRecords>[0];
};

/**
 * 打一局五人局到终局，第 2 轮塞一个红方进队伍并让他放失败牌。
 *
 * 发牌用的是真随机源，所以红方是谁每次都不一样 —— 队伍按「当前红方」现算，
 * 而不是写死座位号。
 */
const playToGameOver = (): Room => {
  const room = createRoom({
    name: "档案测试",
    visibility: "PUBLIC",
    allowSpectators: true,
    hostId: "p0",
    ownerIp: "1.2.3.4",
    now: T0,
    existingIds: new Set(),
  });
  setSeatCount(room, "p0", 5, T0);
  for (const i of SEATS) {
    joinRoom(room, { id: `p${i}`, token: `t${i}`, nick: `玩家${i}`, avatar: AVATAR }, T0);
    sit(room, `p${i}`, i, T0);
    setReady(room, `p${i}`, true, T0);
  }
  expect(startGame(room, "p0", T0).ok).toBe(true);

  const act = (seat: number, action: ClientAction) => {
    const r = applyAction(room, `p${seat}`, action, T0);
    expect(r.ok, `座位 ${seat} 的 ${action.type} 被拒：${r.ok ? "" : r.error}`).toBe(true);
  };

  const g = () => room.game!;
  // 看牌确认，才进得了组队
  for (const i of SEATS) act(i, { type: "ACK_ROLE" });

  const evilSeat = g().sides.findIndex((s) => s === "RED");

  // 轮数不能写死：中间挂掉一轮，蓝方要打到第 4 轮才凑够三胜
  for (let round = 0; round < 5 && g().phase === "TEAM_BUILD"; round++) {
    const size = TEAM_SIZE[5][round]!;
    // 第 2 轮硬塞一个红方进去，让他有机会放失败牌
    const team = round === 1 ? [evilSeat] : [];
    for (const s of SEATS) if (team.length < size && !team.includes(s)) team.push(s);

    act(g().leaderSeat, { type: "PROPOSE_TEAM", team, speakDirection: null });
    for (const i of SEATS) act(i, { type: "VOTE", approve: true });
    act(0, { type: "ADVANCE" });
    for (const s of team) act(s, { type: "PLAY_CARD", success: s !== evilSeat });
    act(0, { type: "ADVANCE" });
  }

  if (g().phase === "ASSASSINATION") {
    const merlin = g().roles.indexOf("MERLIN");
    const assassin = g().roles.indexOf("ASSASSIN");
    const target = SEATS.find((s) => s !== merlin && s !== assassin)!;
    act(assassin, { type: "ASSASSINATE", targetSeat: target });
  }
  expect(g().phase, "用例本身没打到终局").toBe("GAME_OVER");
  return room;
};

describe("归档", () => {
  it("失败牌是谁放的，写进永久档案", async () => {
    const room = playToGameOver();
    const records = createRecords(fakeRedis());
    const id = await records.archive(room, T0 + 1000);
    expect(id).not.toBeNull();

    const saved = (await records.match(id!)) as MatchRecord;

    const failed = saved.missions.find((m) => m.failCount > 0);
    expect(failed, "这局本该有一轮失败").toBeDefined();
    expect(failed!.failedBy).toHaveLength(failed!.failCount);
    // 记的是座位号；能放失败牌的只有红方，而且必须在车上
    for (const seat of failed!.failedBy!) {
      expect(saved.seats[seat]!.side).toBe("RED");
      expect(failed!.team).toContain(seat);
    }

    // 成功的那几轮写空数组 —— 「没人放」和「没记录」是两件事，页面要分得开
    for (const m of saved.missions.filter((x) => x.failCount === 0)) {
      expect(m.failedBy).toEqual([]);
    }
  });

  it("档案只记出失败牌的座位，出成功牌的人不留痕", async () => {
    const room = playToGameOver();
    const records = createRecords(fakeRedis());
    const id = await records.archive(room, T0 + 1000);
    const saved = (await records.match(id!)) as MatchRecord;

    // 原始映射不落盘：它连出成功牌的人也一起记着，那是没有信息量的默认动作
    expect(JSON.stringify(saved)).not.toContain("cardsBySeat");
    for (const m of saved.missions) {
      expect(m.failedBy!.length).toBeLessThan(m.team.length + 1);
    }
  });
});
