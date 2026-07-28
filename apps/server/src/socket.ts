/**
 * Socket.IO 接线。这一层只做四件事：
 *   1. 认身份（playerId + token，握手时带）
 *   2. 过 Zod（非法 payload 直接丢，并计入限流）
 *   3. 调 rooms.ts 的操作
 *   4. **给房间里每个人分别推裁剪后的状态** —— 绝不广播同一份
 *
 * 第 4 条是铁律 2 的落点：Socket.IO 的 `io.to(room).emit()` 在这里是禁用的，
 * 因为它会把同一份 payload 发给所有人。每个连接必须单播自己那一份。
 */

import type { Server as IOServer, Socket } from "socket.io";
import type { ClientEventName, GameEvent, Profile } from "@avalon/shared";
import { CLIENT_EVENTS, profileSchema } from "@avalon/shared/schemas";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { createCounter, createRateLimiter } from "./ratelimit.js";
import type { Registry } from "./registry.js";
import type { Store } from "./store.js";
import {
  advanceAutomatically,
  applyAction,
  isAutoAdvancePhase,
  isHost,
  phaseStamp,
  joinRoom,
  kick,
  leaveRoom,
  markDisconnected,
  canDissolve,
  setReady,
  setSeatCount,
  requestSwap,
  respondSwap,
  reopenRoom,
  setOptions,
  setSettings,
  shuffleSeats,
  sit,
  stand,
  startGame,
  stateFor,
  transferHost,
  type Room,
  type RoomResult,
} from "./rooms.js";

interface SocketData {
  playerId: string;
  token: string;
  profile: Profile;
  roomId: string | null;
  ip: string;
}

type AppSocket = Socket & { data: SocketData };

export const attachSocket = (io: IOServer, registry: Registry, store: Store): void => {
  const msgLimiter = createRateLimiter(config.msgPerWindow, config.msgWindowMs);
  const pingLimiter = createRateLimiter(config.pingPerWindow, config.pingWindowMs);
  const socketsPerIp = createCounter();

  const now = (): number => Date.now();

  const clientIp = (socket: Socket): string => {
    if (!config.trustProxy) return socket.conn.remoteAddress ?? "unknown";
    const fwd = socket.handshake.headers["x-forwarded-for"];
    const first = Array.isArray(fwd) ? fwd[0] : fwd?.split(",")[0];
    return (first ?? socket.handshake.address ?? "unknown").trim();
  };

  /**
   * 给房间里每个在线连接单播自己那一份裁剪视图。
   * **不要**换成 io.to(roomId).emit —— 那样所有人收到同一份，等于把身份全发出去。
   */
  const pushRoom = (room: Room): void => {
    for (const socket of io.sockets.sockets.values()) {
      const data = (socket as AppSocket).data;
      if (data.roomId !== room.id) continue;
      socket.emit("state", stateFor(room, data.playerId));
    }
    store.save(room);
    scheduleAutoAdvance(room);
  };

  /**
   * 结果类阶段到点自动往下走。房主仍可点「立即继续」提前。
   * 定时器按房间维护，每次状态推送时重排 —— 阶段变了旧的自然作废。
   */
  const autoTimers = new Map<string, NodeJS.Timeout>();

  const scheduleAutoAdvance = (room: Room): void => {
    const existing = autoTimers.get(room.id);
    if (existing) {
      clearTimeout(existing);
      autoTimers.delete(room.id);
    }
    if (!isAutoAdvancePhase(room)) return;

    const stamp = phaseStamp(room);
    const timer = setTimeout(() => {
      autoTimers.delete(room.id);
      // 这期间有人抢先推进过就别再推了，否则会连跳一个阶段
      if (phaseStamp(room) !== stamp) return;
      const result = advanceAutomatically(room, now());
      if (!result?.ok) return;
      pushRoom(room);
      pushEvents(room, result.events);
    }, config.autoAdvanceMs);
    timer.unref();
    autoTimers.set(room.id, timer);
  };

  /** 一次性提示（播动画音效用），不含机密，可以群发 */
  const pushEvents = (room: Room, events: readonly GameEvent[]): void => {
    for (const event of events) io.to(`room:${room.id}`).emit("event", event);
  };

  const pushLobby = (): void => {
    io.to("lobby").emit("room:list", { rooms: registry.list() });
  };

  const reply = (socket: AppSocket, result: RoomResult<unknown>, room?: Room): void => {
    if (!result.ok) {
      socket.emit("error", { code: result.error, message: result.error });
      return;
    }
    if (room) pushRoom(room);
  };

  /** 取当前连接所在房间；不在房间里就回错误 */
  const currentRoom = (socket: AppSocket): Room | null => {
    if (!socket.data.roomId) return null;
    const room = registry.get(socket.data.roomId);
    if (!room) {
      socket.data.roomId = null;
      socket.emit("error", { code: "ROOM_NOT_FOUND", message: "房间已不存在" });
      return null;
    }
    return room;
  };

  io.use((socket, next) => {
    const auth = socket.handshake.auth as Partial<Record<string, unknown>>;
    const playerId = typeof auth["playerId"] === "string" ? auth["playerId"] : "";
    const token = typeof auth["token"] === "string" ? auth["token"] : "";
    const parsed = profileSchema.safeParse(auth["profile"]);

    if (!playerId || !token || !parsed.success) {
      next(new Error("握手信息不完整"));
      return;
    }

    const ip = clientIp(socket);
    if (socketsPerIp.get(ip) >= config.maxSocketsPerIp) {
      next(new Error("同一网络的连接数过多"));
      return;
    }

    Object.assign(socket.data, {
      playerId,
      token,
      profile: parsed.data,
      roomId: null,
      ip,
    } satisfies SocketData);
    next();
  });

  io.on("connection", (raw) => {
    const socket = raw as AppSocket;
    socketsPerIp.inc(socket.data.ip);
    socket.join("lobby");
    socket.emit("room:list", { rooms: registry.list() });

    /** 挂一个事件：先限流，再过 Zod，最后交给 handler */
    // Socket.on 的类型按事件表收窄，这里是动态挂载，取一个宽松签名
    const listen = socket.on.bind(socket) as unknown as (
      event: string,
      listener: (payload: unknown) => void,
    ) => void;

    const on = <E extends ClientEventName>(
      event: E,
      handler: (payload: import("zod").infer<(typeof CLIENT_EVENTS)[E]>) => void,
    ): void => {
      listen(event, (raw: unknown) => {
        if (!msgLimiter.hit(socket.id, now())) {
          socket.emit("error", { code: "RATE_LIMITED", message: "操作太快了，慢一点" });
          return;
        }
        const parsed = CLIENT_EVENTS[event].safeParse(raw ?? {});
        if (!parsed.success) {
          socket.emit("error", { code: "INVALID_PAYLOAD", message: "参数不合法" });
          return;
        }
        try {
          handler(parsed.data as never);
        } catch (e) {
          logger.error({ err: String(e), event, playerId: socket.data.playerId }, "处理事件出错");
          socket.emit("error", { code: "INTERNAL", message: "服务器出错了" });
        }
      });
    };

    /**
     * 延迟心跳。**不走上面的 on()** —— 它用的是玩家操作的那份配额，
     * 后台心跳挤掉一次投票是不能接受的。超限或非法就静默丢弃：
     * 这是后台轮询，弹「操作太快了」纯属噪音。
     */
    listen("net:ping", (raw: unknown) => {
      if (!pingLimiter.hit(socket.id, now())) return;
      const parsed = CLIENT_EVENTS["net:ping"].safeParse(raw ?? {});
      if (!parsed.success) return;
      socket.emit("net:pong", { t: parsed.data.t });
    });

    on("room:join", ({ roomId, asSpectator }) => {
      const room = registry.get(roomId);
      if (!room) {
        socket.emit("error", { code: "ROOM_NOT_FOUND", message: "房间不存在或已解散" });
        return;
      }

      const joined = joinRoom(
        room,
        {
          id: socket.data.playerId,
          token: socket.data.token,
          nick: socket.data.profile.nick,
          avatar: socket.data.profile.avatar,
        },
        now(),
      );
      if (!joined.ok) {
        reply(socket, joined);
        return;
      }

      socket.data.roomId = room.id;
      socket.leave("lobby");
      socket.join(`room:${room.id}`);

      // **不自动入座。** 进来先在等待区，自己挑一个和线下真实位置对应的号。
      void asSpectator;
      pushRoom(room);
      pushLobby();
    });

    on("room:leave", () => {
      const room = currentRoom(socket);
      if (!room) return;
      leaveRoom(room, socket.data.playerId, now());
      socket.leave(`room:${room.id}`);
      socket.join("lobby");
      socket.data.roomId = null;
      socket.emit("room:list", { rooms: registry.list() });
      pushRoom(room);
      pushLobby();
    });

    on("room:profile", (profile) => {
      // 先更新连接上的 profile —— 之后 room:join 用的就是它。
      // 不在房间里也要更新，否则「进房前改的昵称」会被握手时的旧值覆盖掉。
      socket.data.profile = profile;
      if (!socket.data.roomId) return;
      const room = currentRoom(socket);
      if (!room) return;
      const player = room.players.get(socket.data.playerId);
      if (player) {
        player.nick = profile.nick;
        player.avatar = profile.avatar;
      }
      pushRoom(room);
    });

    on("room:sit", ({ seatIndex }) => {
      const room = currentRoom(socket);
      if (room) reply(socket, sit(room, socket.data.playerId, seatIndex, now()), room);
    });

    on("room:ready", ({ ready }) => {
      const room = currentRoom(socket);
      if (room) reply(socket, setReady(room, socket.data.playerId, ready, now()), room);
    });

    on("room:seatCount", ({ seatCount }) => {
      const room = currentRoom(socket);
      if (room) reply(socket, setSeatCount(room, socket.data.playerId, seatCount, now()), room);
    });

    on("room:dissolve", () => {
      const room = currentRoom(socket);
      if (!room) return;
      const allowed = canDissolve(room, socket.data.playerId);
      if (!allowed.ok) {
        reply(socket, allowed);
        return;
      }
      // 先把所有人请出去，再销毁 —— 反过来的话 currentRoom 已经查不到房间了
      for (const s of io.sockets.sockets.values()) {
        const d = (s as AppSocket).data;
        if (d.roomId !== room.id) continue;
        s.emit("kicked", { reason: "房主解散了这个房间" });
        s.leave(`room:${room.id}`);
        s.join("lobby");
        d.roomId = null;
      }
      const timer = autoTimers.get(room.id);
      if (timer) {
        clearTimeout(timer);
        autoTimers.delete(room.id);
      }
      registry.destroy(room.id);
      void store.remove(room.id);
      pushLobby();
    });

    on("room:stand", () => {
      const room = currentRoom(socket);
      if (room) reply(socket, stand(room, socket.data.playerId, now()), room);
    });

    on("room:shuffleSeats", () => {
      const room = currentRoom(socket);
      if (!room) return;
      if (!isHost(room, socket.data.playerId)) {
        socket.emit("error", { code: "NOT_HOST", message: "只有房主能打乱座次" });
        return;
      }
      reply(socket, shuffleSeats(room, now()), room);
    });

    on("room:requestSwap", ({ targetPlayerId }) => {
      const room = currentRoom(socket);
      if (room) reply(socket, requestSwap(room, socket.data.playerId, targetPlayerId, now()), room);
    });

    on("room:respondSwap", ({ accept }) => {
      const room = currentRoom(socket);
      if (room) reply(socket, respondSwap(room, socket.data.playerId, accept, now()), room);
    });

    on("room:settings", ({ settings }) => {
      const room = currentRoom(socket);
      if (room) reply(socket, setSettings(room, socket.data.playerId, settings, now()), room);
    });

    on("room:options", (options) => {
      const room = currentRoom(socket);
      if (!room) return;
      const result = setOptions(room, socket.data.playerId, options, now());
      reply(socket, result, room);
      if (result.ok) pushLobby();
    });

    on("room:kick", ({ playerId }) => {
      const room = currentRoom(socket);
      if (!room) return;
      const result = kick(room, socket.data.playerId, playerId, now());
      if (result.ok) {
        for (const s of io.sockets.sockets.values()) {
          const d = (s as AppSocket).data;
          if (d.playerId !== playerId) continue;
          s.emit("kicked", { reason: "你被房主移出了房间" });
          s.leave(`room:${room.id}`);
          s.join("lobby");
          d.roomId = null;
        }
      }
      reply(socket, result, room);
      pushLobby();
    });

    on("room:transferHost", ({ playerId }) => {
      const room = currentRoom(socket);
      if (room) reply(socket, transferHost(room, socket.data.playerId, playerId, now()), room);
    });

    on("game:start", () => {
      const room = currentRoom(socket);
      if (!room) return;
      const result = startGame(room, socket.data.playerId, now());
      reply(socket, result, room);
      if (result.ok) pushLobby();
    });

    on("game:restart", () => {
      const room = currentRoom(socket);
      if (!room) return;
      const result = reopenRoom(room, socket.data.playerId, now());
      reply(socket, result, room);
      // 房间从「对局中」变回「等待中」，大厅列表要跟着变
      if (result.ok) pushLobby();
    });

    on("game:action", ({ action }) => {
      const room = currentRoom(socket);
      if (!room) return;

      const outcome = applyAction(room, socket.data.playerId, action, now());
      if (!outcome.ok) {
        socket.emit("error", { code: outcome.error, message: outcome.error });
        return;
      }
      if (!outcome.value.ok) {
        socket.emit("error", { code: outcome.value.error, message: outcome.value.error });
        return;
      }

      pushRoom(room);
      pushEvents(room, outcome.value.events);

      if (room.game?.phase === "GAME_OVER") {
        void store.saveReport(room.id, { finishedAt: now(), game: stateFor(room, "").game });
        pushLobby();
      }
    });

    socket.on("disconnect", () => {
      socketsPerIp.dec(socket.data.ip);
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const room = registry.get(roomId);
      if (!room) return;
      markDisconnected(room, socket.data.playerId, now());
      pushRoom(room);
      pushLobby();
    });
  });

  // 定时清扫：回收空房间 + 房主自动移交
  const timer = setInterval(() => {
    const { collected, hostChanged } = registry.sweep(now());
    for (const id of collected) {
      const timer = autoTimers.get(id);
      if (timer) {
        clearTimeout(timer);
        autoTimers.delete(id);
      }
      void store.remove(id);
    }
    for (const id of hostChanged) {
      const room = registry.get(id);
      if (room) pushRoom(room);
    }
    if (collected.length > 0 || hostChanged.length > 0) pushLobby();
  }, config.sweepIntervalMs);
  timer.unref();
};
