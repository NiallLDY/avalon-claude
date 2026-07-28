/**
 * 端到端联调：真的起一个 Socket.IO 服务端，接 5 个真实客户端打完一局。
 *
 * 这层要验的是**单测验不到的东西** —— 裁剪逻辑单测已经覆盖，
 * 这里验的是「接线有没有接错」：会不会有人把全量状态广播出去、
 * 座位号是不是真的由服务端填、限流和 Zod 有没有真的挂上。
 *
 * 不依赖 Redis：store 用桩替掉。Redis 只是快照，不影响对局。
 */

import { createServer, type Server as HttpServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Server as IOServer } from "socket.io";
import { io as connect, type Socket as ClientSocket } from "socket.io-client";
import { ROLE_IDS, type ClientAction, type StatePayload } from "@avalon/shared";
import { attachSocket } from "./socket.js";
import { createRegistry, type Registry } from "./registry.js";
import type { Store } from "./store.js";

/** Redis 桩。对局不依赖 Redis，快照写不写都不影响正确性 */
const fakeStore = (): Store =>
  ({
    save: () => undefined,
    saveNow: async () => undefined,
    remove: async () => undefined,
    restoreAll: async () => [],
    saveReport: async () => undefined,
    loadReport: async () => null,
    close: async () => undefined,
    redis: null,
  }) as unknown as Store;

interface Client {
  socket: ClientSocket;
  id: string;
  /** 最近一次收到的状态 */
  state: StatePayload | null;
  errors: { code: string; message: string }[];
}

let http: HttpServer;
let io: IOServer;
let registry: Registry;
let port: number;
const clients: Client[] = [];

const listen = (server: HttpServer): Promise<number> =>
  new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });

const nextState = (c: Client): Promise<StatePayload> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${c.id} 等状态超时`)), 3000);
    c.socket.once("state", (payload: StatePayload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

const connectClient = async (id: string): Promise<Client> => {
  const socket = connect(`http://127.0.0.1:${port}`, {
    path: "/ws",
    transports: ["websocket"],
    auth: {
      playerId: id,
      token: `token-${id}`,
      profile: { nick: `玩家${id}`, avatar: { seed: id, bg: "223344" } },
    },
  });
  const client: Client = { socket, id, state: null, errors: [] };
  socket.on("state", (payload: StatePayload) => {
    client.state = payload;
  });
  socket.on("error", (e: { code: string; message: string }) => client.errors.push(e));

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${id} 连接超时`)), 3000);
    socket.on("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.on("connect_error", (e: Error) => {
      clearTimeout(timer);
      reject(e);
    });
  });
  clients.push(client);
  return client;
};

/** 等到所有客户端的状态都满足条件，或超时 */
const waitFor = async (
  members: readonly Client[],
  predicate: (c: Client) => boolean,
  label: string,
): Promise<void> => {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (members.every(predicate)) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`等待超时：${label}`);
};

const act = (c: Client, action: ClientAction): void => {
  c.socket.emit("game:action", { action });
};

beforeEach(async () => {
  http = createServer();
  io = new IOServer(http, { path: "/ws", maxHttpBufferSize: 4096 });
  registry = createRegistry();
  attachSocket(io, registry, fakeStore());
  port = await listen(http);
});

afterEach(async () => {
  for (const c of clients) c.socket.close();
  clients.length = 0;
  await io.close();
  await new Promise<void>((r) => http.close(() => r()));
});

/** 建房 + 拉 n 个客户端进来落座，返回房间码与客户端列表 */
const setupRoom = async (n: number): Promise<{ roomId: string; members: Client[] }> => {
  const created = registry.create({
    name: "联调房",
    visibility: "PUBLIC",
    allowSpectators: true,
    hostId: "p0",
    ip: "127.0.0.1",
    now: Date.now(),
  });
  if (!created.ok) throw new Error(created.error);
  const roomId = created.room.id;

  const members: Client[] = [];
  for (let i = 0; i < n; i++) {
    const c = await connectClient(`p${i}`);
    const state = nextState(c);
    c.socket.emit("room:join", { roomId });
    c.state = await state;
    members.push(c);
  }
  // 进房不再自动入座，得自己挑位子
  for (const [i, c] of members.entries()) c.socket.emit("room:sit", { seatIndex: i });
  await waitFor(members, (c) => (c.state?.room.seats.filter(Boolean).length ?? 0) === n, "全员入座");
  for (const c of members) c.socket.emit("room:ready", { ready: true });
  await waitFor(members, (c) => c.state?.room.canStart === true, "全员准备");
  return { roomId, members };
};

describe("握手", () => {
  it("缺少身份信息的连接直接被拒", async () => {
    const socket = connect(`http://127.0.0.1:${port}`, {
      path: "/ws",
      transports: ["websocket"],
      auth: { playerId: "x" }, // 没有 token 和 profile
    });
    const error = await new Promise<Error>((resolve) => {
      socket.on("connect_error", resolve);
    });
    expect(error.message).toContain("握手");
    socket.close();
  });

  it("昵称会被清洗后才进房间", async () => {
    const socket = connect(`http://127.0.0.1:${port}`, {
      path: "/ws",
      transports: ["websocket"],
      auth: {
        playerId: "dirty",
        token: "t",
        profile: { nick: "  梅​林  ", avatar: { seed: "s", bg: "000000" } },
      },
    });
    await new Promise<void>((resolve) => socket.on("connect", () => resolve()));

    const created = registry.create({
      name: "房", visibility: "PUBLIC", allowSpectators: true,
      hostId: "dirty", ip: "127.0.0.1", now: Date.now(),
    });
    if (!created.ok) throw new Error(created.error);

    await new Promise<StatePayload>((resolve) => {
      socket.once("state", resolve);
      socket.emit("room:join", { roomId: created.room.id });
    });
    socket.emit("room:sit", { seatIndex: 0 });
    const seatedState = await new Promise<StatePayload>((r) => socket.once("state", r));
    expect(seatedState.room.seats[0]!.nick).toBe("梅林");
    socket.close();
  });
});

describe("房间", () => {
  it("入座顺序就是环形座次，每人都能看到完整名单", async () => {
    const { members } = await setupRoom(5);
    for (const c of members) {
      expect(c.state!.room.seats.map((p) => p?.id)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
    }
    expect(members[0]!.state!.room.hostId).toBe("p0");
    expect(members[0]!.state!.room.canStart).toBe(true);
  });

  it("非房主开局会被拒", async () => {
    const { members } = await setupRoom(5);
    members[1]!.socket.emit("game:start", {});
    await waitFor([members[1]!], (c) => c.errors.length > 0, "收到错误");
    expect(members[1]!.errors[0]!.code).toBe("NOT_HOST");
    expect(members[1]!.state!.game).toBeNull();
  });

  it("非法 payload 被 Zod 挡下，不会打到房间逻辑", async () => {
    const { members } = await setupRoom(5);
    const host = members[0]!;
    host.socket.emit("game:action", { action: { type: "总之给我梅林" } });
    await waitFor([host], (c) => c.errors.length > 0, "收到错误");
    expect(host.errors[0]!.code).toBe("INVALID_PAYLOAD");
  });
});

describe("延迟心跳", () => {
  it("net:ping 原样回声，客户端据此算 RTT", async () => {
    const c = await connectClient("solo");
    const sent = Date.now();
    c.socket.emit("net:ping", { t: sent });

    const echoed = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("等 net:pong 超时")), 3000);
      c.socket.once("net:pong", ({ t }: { t: number }) => {
        clearTimeout(timer);
        resolve(t);
      });
    });
    expect(echoed).toBe(sent);
  });

  it("心跳不占玩家的操作配额", async () => {
    const { members } = await setupRoom(5);
    const host = members[0]!;
    // 打满一整个心跳窗口的量。要是心跳和操作共用一份限流，
    // 后面这次 game:start 就该被 RATE_LIMITED 挡掉。
    for (let i = 0; i < 40; i++) host.socket.emit("net:ping", { t: Date.now() });

    host.socket.emit("game:start", {});
    await waitFor([host], (c) => c.state?.game !== null, "开局");
    expect(host.errors).toEqual([]);
  });

  it("超频的心跳被静默丢弃，不弹错误", async () => {
    const c = await connectClient("flood");
    for (let i = 0; i < 30; i++) c.socket.emit("net:ping", { t: Date.now() });
    await new Promise((r) => setTimeout(r, 100));
    expect(c.errors).toEqual([]);
  });
});

describe("一整局", () => {
  it("五个人能从发牌打到刺杀，且全程没人看到别人的身份", async () => {
    const { members } = await setupRoom(5);
    const host = members[0]!;

    host.socket.emit("game:start", {});
    await waitFor(members, (c) => c.state?.game?.phase === "ROLE_REVEAL", "发牌");

    // 每个人只能看到自己的角色，别人的一律看不到
    const seenRoles = new Set<string>();
    for (const [seat, c] of members.entries()) {
      const game = c.state!.game!;
      expect(game.me!.seat).toBe(seat);
      seenRoles.add(game.me!.roleId);

      const { me, ...rest } = game;
      const json = JSON.stringify(rest);
      for (const role of ROLE_IDS) expect(json, `${c.id} 看到了 ${role}`).not.toContain(`"${role}"`);
    }
    // 5 人局有 5 个不同角色（忠臣只有 1 个），说明确实各拿各的
    expect(seenRoles.size).toBe(5);

    for (const c of members) act(c, { type: "ACK_ROLE" });
    await waitFor(members, (c) => c.state?.game?.phase === "TEAM_BUILD", "组队");

    /** 打一轮任务：队长提名 → 全票通过 → 全员出成功 → 推进 */
    const playRound = async (): Promise<void> => {
      const leaderSeat = host.state!.game!.leaderSeat;
      const leader = members[leaderSeat]!;
      const size = leader.state!.game!.teamSize;
      const team = Array.from({ length: size }, (_, i) => (leaderSeat + i) % members.length);

      act(leader, { type: "PROPOSE_TEAM", team, speakDirection: "CW" });
      await waitFor(members, (c) => c.state?.game?.phase === "VOTE", "投票");

      for (const c of members) act(c, { type: "VOTE", approve: true });
      await waitFor(members, (c) => c.state?.game?.phase === "VOTE_RESULT", "揭票");

      act(host, { type: "ADVANCE" });
      await waitFor(members, (c) => c.state?.game?.phase === "MISSION", "执行任务");

      // 没上车的人出牌会被拒
      const bench = members.find((c) => !team.includes(c.state!.game!.me!.seat));
      if (bench) {
        const before = bench.errors.length;
        act(bench, { type: "PLAY_CARD", success: true });
        await waitFor([bench], (c) => c.errors.length > before, "非队员出牌被拒");
        expect(bench.errors.at(-1)!.code).toBe("NOT_ON_TEAM");
      }

      for (const seat of team) {
        const player = members[seat]!;
        // 蓝方的出牌权限必须是「只能成功」，服务端下发的 me 里就该体现出来
        if (player.state!.game!.me!.side === "BLUE") {
          expect(player.state!.game!.me!.missionCardRule).toBe("SUCCESS_ONLY");
        }
        act(player, { type: "PLAY_CARD", success: true });
      }
      await waitFor(members, (c) => c.state?.game?.phase === "MISSION_RESULT", "任务结算");
      act(host, { type: "ADVANCE" });
    };

    await playRound();
    await waitFor(members, (c) => c.state?.game?.phase === "TEAM_BUILD", "第 2 轮");
    await playRound();
    await waitFor(members, (c) => c.state?.game?.phase === "TEAM_BUILD", "第 3 轮");
    await playRound();

    // 三轮全成功 → 刺杀阶段
    await waitFor(members, (c) => c.state?.game?.phase === "ASSASSINATION", "刺杀");

    // 刺杀权限只有刺客有
    const assassins = members.filter((c) => c.state!.game!.me!.canAssassinate);
    expect(assassins).toHaveLength(1);
    expect(assassins[0]!.state!.game!.me!.roleId).toBe("ASSASSIN");

    // 任务牌是谁出的，任何人任何阶段都拿不到
    for (const c of members) {
      expect(JSON.stringify(c.state!.game)).not.toContain("cardsBySeat");
      expect(c.state!.game!.missions).toHaveLength(3);
      expect(c.state!.game!.missions.every((m) => m.success)).toBe(true);
    }

    // 刺客刺一个非梅林的人 → 蓝方胜
    const assassin = assassins[0]!;
    const merlinSeat = members.findIndex((c) => c.state!.game!.me!.roleId === "MERLIN");
    const target = members.findIndex(
      (c) => c.state!.game!.me!.seat !== merlinSeat && c.state!.game!.me!.seat !== assassin.state!.game!.me!.seat,
    );
    act(assassin, { type: "ASSASSINATE", targetSeat: target });

    await waitFor(members, (c) => c.state?.game?.phase === "GAME_OVER", "终局");
    for (const c of members) {
      expect(c.state!.game!.outcome!.winner).toBe("BLUE");
      // 终局揭晓全员身份
      expect(c.state!.game!.reveal).toHaveLength(5);
      // 但出牌人映射依然不给
      expect(JSON.stringify(c.state!.game)).not.toContain("cardsBySeat");
    }

    // ── 再来一局 ──
    // 打完这一局，房间必须还能接着用。**非房主**点也要能重开。
    for (const c of members) c.errors.length = 0;
    members[3]!.socket.emit("game:restart", {});

    await waitFor(members, (c) => c.state?.game === null, "退回等待页");
    for (const c of members) {
      expect(c.errors).toEqual([]);
      // 座位原样保留 —— 线下大家还坐在原位上
      expect(c.state!.room.seats.map((p) => p?.id)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
      // 准备清空，得重新确认一遍
      expect(c.state!.room.canStart).toBe(false);
      expect(c.state!.room.startBlockedReason).toContain("没准备");
    }

    // 重新准备 → 房主开新局，走完一个完整的循环
    for (const c of members) c.socket.emit("room:ready", { ready: true });
    await waitFor(members, (c) => c.state?.room.canStart === true, "全员准备");
    members[0]!.socket.emit("game:start", {});
    await waitFor(members, (c) => c.state?.game?.phase === "ROLE_REVEAL", "开下一局");
    for (const c of members) expect(c.errors).toEqual([]);
  }, 20_000);
});

describe("观战者", () => {
  it("观战者拿不到任何身份，连自己的 me 都是 null", async () => {
    const { roomId, members } = await setupRoom(5);
    const spec = await connectClient("spec");
    const first = nextState(spec);
    spec.socket.emit("room:join", { roomId, asSpectator: true });
    await first;

    members[0]!.socket.emit("game:start", {});
    await waitFor([spec], (c) => c.state?.game !== null, "开局后观战者收到状态");

    expect(spec.state!.game!.me).toBeNull();
    const json = JSON.stringify(spec.state!.game);
    for (const role of ROLE_IDS) expect(json).not.toContain(`"${role}"`);
  });
});
