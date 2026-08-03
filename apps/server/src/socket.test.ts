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
const savedReportRooms: string[] = [];
const fakeStore = (): Store =>
  ({
    save: () => undefined,
    saveNow: async () => undefined,
    remove: async () => undefined,
    restoreAll: async () => [],
    saveReport: async (roomId: string) => {
      savedReportRooms.push(roomId);
    },
    loadReport: async () => null,
    close: async () => undefined,
    redis: null,
  }) as unknown as Store;

/** 战绩归档桩。归档失败不该影响对局，测试里只记下调用 */
const archivedRooms: string[] = [];
const fakeRecords = () =>
  ({
    archive: async (room: { id: string }) => {
      archivedRooms.push(room.id);
      return null;
    },
    leaderboard: async () => [],
    recentMatches: async () => [],
    match: async () => null,
    player: async () => null,
    readPlayer: async () => null,
  }) as unknown as import("./records.js").Records;

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
  timeoutMs = 3000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
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
  savedReportRooms.length = 0;
  archivedRooms.length = 0;
  http = createServer();
  io = new IOServer(http, { path: "/ws", maxHttpBufferSize: 4096 });
  registry = createRegistry();
  attachSocket(io, registry, fakeStore(), fakeRecords());
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
      /*
       * 但出牌人**在对局中任何时刻都不给，终局这一屏也不给**。
       * 想知道谁放的失败牌，只能事后翻对局记录（records.ts 的 failedBy）——
       * 那是另一条线，走不到这里。
       */
      expect(JSON.stringify(c.state!.game)).not.toContain("cardsBySeat");
      expect(JSON.stringify(c.state!.game)).not.toContain("failedBy");
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

  it("三次任务失败由定时器推进到终局时也会保存战报并归档", async () => {
    const { roomId, members } = await setupRoom(5);
    const host = members[0]!;

    host.socket.emit("game:start", {});
    await waitFor(members, (c) => c.state?.game?.phase === "ROLE_REVEAL", "发牌");
    for (const c of members) act(c, { type: "ACK_ROLE" });
    await waitFor(members, (c) => c.state?.game?.phase === "TEAM_BUILD", "组队");

    const evil = members.find((c) => c.state!.game!.me!.side === "RED")!;
    const evilSeat = evil.state!.game!.me!.seat;

    const failMission = async (manualAdvance: boolean): Promise<void> => {
      const leaderSeat = host.state!.game!.leaderSeat;
      const leader = members[leaderSeat]!;
      const size = leader.state!.game!.teamSize;
      const team = [
        evilSeat,
        ...members.map((_, seat) => seat).filter((seat) => seat !== evilSeat),
      ].slice(0, size);

      act(leader, { type: "PROPOSE_TEAM", team, speakDirection: "CW" });
      await waitFor(members, (c) => c.state?.game?.phase === "VOTE", "投票");
      for (const c of members) act(c, { type: "VOTE", approve: true });
      await waitFor(members, (c) => c.state?.game?.phase === "VOTE_RESULT", "揭票");

      act(host, { type: "ADVANCE" });
      await waitFor(members, (c) => c.state?.game?.phase === "MISSION", "执行任务");
      for (const seat of team) {
        act(members[seat]!, { type: "PLAY_CARD", success: seat !== evilSeat });
      }
      await waitFor(members, (c) => c.state?.game?.phase === "MISSION_RESULT", "任务失败");

      if (manualAdvance) act(host, { type: "ADVANCE" });
    };

    // 前两轮手动推进，最后一轮故意等 6 秒定时器判胜，复现漏归档路径。
    await failMission(true);
    await waitFor(members, (c) => c.state?.game?.phase === "TEAM_BUILD", "第 2 轮");
    await failMission(true);
    await waitFor(members, (c) => c.state?.game?.phase === "TEAM_BUILD", "第 3 轮");
    await failMission(false);

    await waitFor(members, (c) => c.state?.game?.phase === "GAME_OVER", "自动终局", 9000);
    expect(host.state!.game!.outcome).toMatchObject({
      winner: "RED",
      reason: "MISSIONS_FAILED",
    });
    expect(savedReportRooms).toEqual([roomId]);
    expect(archivedRooms).toEqual([roomId]);
  }, 20_000);
});

describe("献花砸蛋", () => {
  it("扔出去全房间都收得到，扔的人是几号由服务端填", async () => {
    const { members } = await setupRoom(5);
    members[0]!.socket.emit("game:start", {});
    await waitFor(members, (c) => c.state?.game !== null, "开局");
    for (const c of members) act(c, { type: "ACK_ROLE" });
    await waitFor(members, (c) => c.state?.game?.phase === "TEAM_BUILD", "进组队阶段");

    const seen = members.map(() => [] as unknown[]);
    for (const [i, c] of members.entries()) {
      c.socket.on("reaction", (r: unknown) => seen[i]!.push(r));
    }

    // 客户端 payload 里没有 fromSeat —— 自报座位号就等于让人冒名顶替
    members[3]!.socket.emit("game:react", { targetSeat: 1, kind: "EGG" });
    await new Promise((r) => setTimeout(r, 150));

    for (const got of seen) {
      // count 是连发展开用的，单发是 1
      expect(got).toEqual([{ fromSeat: 3, targetSeat: 1, kind: "EGG", count: 1 }]);
    }
    // 纯气氛，不该动到对局状态
    for (const c of members) expect(c.state!.game!.phase).toBe("TEAM_BUILD");
  }, 15_000);

  it("十连发只发一条消息，个数交给客户端展开", async () => {
    const { members } = await setupRoom(5);
    members[0]!.socket.emit("game:start", {});
    await waitFor(members, (c) => c.state?.game !== null, "开局");
    for (const c of members) act(c, { type: "ACK_ROLE" });
    await waitFor(members, (c) => c.state?.game?.phase === "TEAM_BUILD", "进组队阶段");

    const seen: unknown[] = [];
    members[0]!.socket.on("reaction", (r: unknown) => seen.push(r));
    members[3]!.socket.emit("game:react", { targetSeat: 1, kind: "TOMATO", burst: true });
    await new Promise((r) => setTimeout(r, 150));

    // 一条消息带个数 —— 发十条会被限流掐掉，到达时间也不齐
    expect(seen).toEqual([{ fromSeat: 3, targetSeat: 1, kind: "TOMATO", count: 10 }]);
  }, 15_000);

  it("阶段不对就静默丢弃，不弹错误", async () => {
    const { members } = await setupRoom(5);
    members[0]!.socket.emit("game:start", {});
    await waitFor(members, (c) => c.state?.game !== null, "开局");
    for (const c of members) c.errors.length = 0;

    // 还在发牌阶段
    members[3]!.socket.emit("game:react", { targetSeat: 1, kind: "FLOWER" });
    await new Promise((r) => setTimeout(r, 150));

    for (const c of members) expect(c.errors).toEqual([]);
  }, 15_000);
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

/**
 * 聊天。要验的不是「发得出去」，而是**队友频道有没有被广播出去**。
 *
 * 这一层最容易出的错是图省事写 `io.to(room).emit(...)` —— 那样一条队友消息
 * 会原样发给全场，蓝方抓包就知道发的人是红方。所以断言落在
 * 「别人收到的 payload 里有没有这条」，而不是界面显不显示。
 */
describe("聊天", () => {
  it("公共频道所有人都收得到", async () => {
    const { members } = await setupRoom(5);
    members[0]!.socket.emit("game:start", {});
    await waitFor(members, (c) => c.state?.game?.phase === "ROLE_REVEAL", "发牌");

    members[2]!.socket.emit("game:chat", { channel: "ALL", text: "大家好" });
    await waitFor(members, (c) => (c.state?.game?.chat.length ?? 0) > 0, "公共消息到齐");

    for (const c of members) {
      const msg = c.state!.game!.chat[0]!;
      expect(msg.text, c.id).toBe("大家好");
      expect(msg.seat, c.id).toBe(2);
      expect(msg.channel, c.id).toBe("ALL");
    }
  });

  it("队友频道只到互认的坏人手里，别人的 payload 里连字都没有", async () => {
    const { members } = await setupRoom(5);
    members[0]!.socket.emit("game:start", {});
    await waitFor(members, (c) => c.state?.game?.phase === "ROLE_REVEAL", "发牌");

    /*
     * 认人只能看 canEvilChat。**不能拿 evilSeats 非空判断** ——
     * 梅林的视野里也有一串红方座位，那样会把梅林算成坏人。
     */
    const evil = members.filter((c) => c.state!.game!.me!.canEvilChat);
    expect(evil.length, "5 人局该有两个互认的坏人").toBe(2);
    const blue = members.filter((c) => !evil.includes(c));

    const secret = "刺客是我别投我";
    evil[0]!.socket.emit("game:chat", { channel: "EVIL", text: secret });
    await waitFor(evil, (c) => (c.state?.game?.chat.length ?? 0) > 0, "队友消息到齐");

    for (const c of evil) {
      expect(c.state!.game!.chat.map((m) => m.text), c.id).toContain(secret);
    }
    for (const c of blue) {
      // 整份下行 payload 里都不该出现 —— 不是「前端不显示」
      expect(JSON.stringify(c.state), `${c.id} 收到了队友频道`).not.toContain(secret);
      expect(c.state!.game!.chat.some((m) => m.channel === "EVIL"), c.id).toBe(false);
    }
  });

  it("蓝方硬发队友频道会被静默丢弃，谁都收不到", async () => {
    const { members } = await setupRoom(5);
    members[0]!.socket.emit("game:start", {});
    await waitFor(members, (c) => c.state?.game?.phase === "ROLE_REVEAL", "发牌");

    const blue = members.find((c) => c.state!.game!.me!.side === "BLUE")!;
    blue.socket.emit("game:chat", { channel: "EVIL", text: "我是内鬼" });
    // 没有「被拒」的回执可等，就发一条正常消息当水位线：它到了说明前一条已经处理完
    blue.socket.emit("game:chat", { channel: "ALL", text: "水位线" });
    await waitFor(members, (c) => (c.state?.game?.chat.length ?? 0) > 0, "水位线到达");

    for (const c of members) {
      expect(c.state!.game!.chat.map((m) => m.text), c.id).toEqual(["水位线"]);
    }
  });

  it("没入座的观战者只能看，发不出去", async () => {
    const { roomId, members } = await setupRoom(5);
    members[0]!.socket.emit("game:start", {});
    await waitFor(members, (c) => c.state?.game?.phase === "ROLE_REVEAL", "发牌");

    const watcher = await connectClient("watcher");
    const joined = nextState(watcher);
    watcher.socket.emit("room:join", { roomId });
    watcher.state = await joined;

    watcher.socket.emit("game:chat", { channel: "ALL", text: "让我说一句" });
    members[1]!.socket.emit("game:chat", { channel: "ALL", text: "水位线" });
    await waitFor(members, (c) => (c.state?.game?.chat.length ?? 0) > 0, "水位线到达");

    expect(members[0]!.state!.game!.chat.map((m) => m.text)).toEqual(["水位线"]);
    // 但看是能看的
    await waitFor([watcher], (c) => (c.state?.game?.chat.length ?? 0) > 0, "观战者收到公共消息");
    expect(watcher.state!.game!.chat.map((m) => m.text)).toEqual(["水位线"]);
  });
});
