/**
 * 房间模型与房间内的全部操作。
 *
 * 房间状态的**唯一真相在内存**，Redis 只是防进程重启的快照（见 store.ts）。
 * 时间由调用方注入 `now`，方便测试推进时钟。
 *
 * 座位模型：`seats` 是一个**有序的 playerId 数组**，索引就是引擎的 seatIndex。
 * 这样线下的环形落座顺序和引擎座位号天然一一对应，不需要额外映射。
 */

import {
  DEFAULT_SETTINGS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  LADY_MIN_PLAYERS,
  LANCELOT_MIN_PLAYERS,
  isValidPlayerCount,
  type Avatar,
  type ClientAction,
  type GameSettings,
  type PendingSwap,
  type PublicPlayer,
  type RoomSummary,
  type RoomView,
  type ServerErrorCode,
  type StatePayload,
} from "@avalon/shared";
import {
  createGame,
  projectFor,
  reduce,
  type Action,
  type GameState,
  type ReduceResult,
} from "@avalon/engine";
import { cryptoRng, newRoomCode } from "./ids.js";
import { config } from "./config.js";

export interface RoomPlayer {
  readonly id: string;
  readonly token: string;
  nick: string;
  avatar: Avatar;
  connected: boolean;
  /** 断线时刻，用于房主自动移交与 GC */
  disconnectedAt: number | null;
}

export interface Room {
  readonly id: string;
  name: string;
  visibility: "PUBLIC" | "PRIVATE";
  allowSpectators: boolean;
  hostId: string;
  /** 房主掉线的时刻。回到在线就清空 */
  hostOfflineSince: number | null;
  readonly players: Map<string, RoomPlayer>;
  /** 有序环形座次，索引即 seatIndex */
  seats: string[];
  settings: GameSettings;
  game: GameState | null;
  readonly createdAt: number;
  updatedAt: number;
  /** 建房者 IP，用于并发房间数限制 */
  readonly ownerIp: string;
  /** 待处理的换座请求。同一时刻只允许一个，避免多方互相抢座 */
  pendingSwap: (PendingSwap & { readonly at: number }) | null;
}

export type RoomResult<T = void> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ServerErrorCode | string };

const ok = <T>(value: T): RoomResult<T> => ({ ok: true, value });
const err = (error: ServerErrorCode | string): RoomResult<never> => ({ ok: false, error });

// ──────────────────────────── 查询 ────────────────────────────

export const seatOf = (room: Room, playerId: string): number => room.seats.indexOf(playerId);
export const isSeated = (room: Room, playerId: string): boolean => seatOf(room, playerId) >= 0;
export const isHost = (room: Room, playerId: string): boolean => room.hostId === playerId;
export const isInGame = (room: Room): boolean => room.game !== null && room.game.phase !== "GAME_OVER";

/** 开局前的合法性检查。理由要能直接显示给房主看 */
export const startBlockedReason = (room: Room): string | null => {
  const n = room.seats.length;
  if (!isValidPlayerCount(n)) {
    return n < MIN_PLAYERS ? `还差 ${MIN_PLAYERS - n} 人才能开局` : `最多 ${MAX_PLAYERS} 人`;
  }
  if (room.settings.mode === "LANCELOT" && n < LANCELOT_MIN_PLAYERS) {
    return `兰斯洛特模式至少 ${LANCELOT_MIN_PLAYERS} 人`;
  }
  // 官方规则：湖中女神仅限 7 人及以上
  if (room.settings.ladyOfTheLake && n < LADY_MIN_PLAYERS) {
    return `湖中女神至少 ${LADY_MIN_PLAYERS} 人，现在 ${n} 人`;
  }
  if (room.seats.some((id) => !room.players.get(id)?.connected)) {
    return "有玩家掉线，等他回来或先请他离座";
  }
  return null;
};

// ──────────────────────────── 视图 ────────────────────────────

const toPublic = (room: Room, player: RoomPlayer, seat: number | null): PublicPlayer => ({
  id: player.id,
  nick: player.nick,
  avatar: player.avatar,
  seat,
  connected: player.connected,
  isHost: room.hostId === player.id,
});

export const roomView = (room: Room): RoomView => {
  const seatedIds = new Set(room.seats);
  return {
    id: room.id,
    name: room.name,
    visibility: room.visibility,
    allowSpectators: room.allowSpectators,
    hostId: room.hostId,
    settings: room.settings,
    seated: room.seats.map((id, seat) => toPublic(room, room.players.get(id)!, seat)),
    spectators: [...room.players.values()]
      .filter((p) => !seatedIds.has(p.id))
      .map((p) => toPublic(room, p, null)),
    inGame: room.game !== null,
    canStart: startBlockedReason(room) === null && room.game === null,
    startBlockedReason: room.game === null ? startBlockedReason(room) : null,
    pendingSwap: room.pendingSwap
      ? {
          fromPlayerId: room.pendingSwap.fromPlayerId,
          toPlayerId: room.pendingSwap.toPlayerId,
          fromSeat: room.pendingSwap.fromSeat,
          toSeat: room.pendingSwap.toSeat,
        }
      : null,
  };
};

/** 大厅列表条目。刻意不含玩家身份，也不含 IP */
export const roomSummary = (room: Room): RoomSummary => ({
  id: room.id,
  name: room.name,
  playerCount: room.seats.length,
  inGame: isInGame(room),
  allowSpectators: room.allowSpectators,
});

/**
 * 某个玩家能看到的完整状态。
 * 不在座位上的人（观战者）拿到 viewer=null 的裁剪视图，自然什么身份都看不到。
 */
export const stateFor = (room: Room, playerId: string): StatePayload => {
  const seat = seatOf(room, playerId);
  return {
    room: roomView(room),
    game: room.game ? projectFor(room.game, seat >= 0 ? seat : null) : null,
    selfId: playerId,
  };
};

// ──────────────────────────── 生命周期 ────────────────────────────

export const createRoom = (opts: {
  name: string;
  visibility: "PUBLIC" | "PRIVATE";
  allowSpectators: boolean;
  hostId: string;
  ownerIp: string;
  now: number;
  existingIds: ReadonlySet<string>;
}): Room => {
  let id = newRoomCode();
  // 6 位码有 32^6 ≈ 10 亿种，撞了直接重摇
  for (let i = 0; i < 20 && opts.existingIds.has(id); i++) id = newRoomCode();

  return {
    id,
    name: opts.name,
    visibility: opts.visibility,
    allowSpectators: opts.allowSpectators,
    hostId: opts.hostId,
    hostOfflineSince: null,
    players: new Map(),
    seats: [],
    settings: DEFAULT_SETTINGS,
    game: null,
    createdAt: opts.now,
    updatedAt: opts.now,
    ownerIp: opts.ownerIp,
    pendingSwap: null,
  };
};

export const touch = (room: Room, now: number): void => {
  room.updatedAt = now;
};

/** 房间是否该被回收 */
export const shouldCollect = (room: Room, now: number): boolean => {
  const anyoneOnline = [...room.players.values()].some((p) => p.connected);
  if (anyoneOnline) return false;
  const idleFor = now - room.updatedAt;
  const finished = room.game?.phase === "GAME_OVER";
  return idleFor > (finished ? config.finishedRoomMs : config.idleRoomMs);
};

// ──────────────────────────── 进出房间 ────────────────────────────

export const joinRoom = (
  room: Room,
  player: { id: string; token: string; nick: string; avatar: Avatar },
  now: number,
): RoomResult<RoomPlayer> => {
  const existing = room.players.get(player.id);
  if (existing) {
    // 重连：座位、房主身份都保留
    existing.nick = player.nick;
    existing.avatar = player.avatar;
    existing.connected = true;
    existing.disconnectedAt = null;
    if (room.hostId === player.id) room.hostOfflineSince = null;
    touch(room, now);
    return ok(existing);
  }

  if (!room.allowSpectators && room.seats.length >= MAX_PLAYERS) return err("ROOM_FULL");

  const created: RoomPlayer = {
    id: player.id,
    token: player.token,
    nick: player.nick,
    avatar: player.avatar,
    connected: true,
    disconnectedAt: null,
  };
  room.players.set(player.id, created);
  touch(room, now);
  return ok(created);
};

export const markDisconnected = (room: Room, playerId: string, now: number): void => {
  const player = room.players.get(playerId);
  if (!player) return;
  player.connected = false;
  player.disconnectedAt = now;
  if (room.hostId === playerId) room.hostOfflineSince = now;

  dropSwapInvolving(room, playerId);
  // 对局中掉线**不释放座位**，重连即恢复。没开局的观战者直接清掉，免得列表越积越长
  if (!isInGame(room) && !isSeated(room, playerId)) room.players.delete(playerId);
  touch(room, now);
};

/**
 * 房主掉线超时后自动移交给**座位号最小的在线玩家**。
 * 没人落座就退而找任意在线玩家。原房主回来**不自动收回** —— 免得房主反复闪断把控制权抖来抖去。
 * @returns 新房主 id，没换就返回 null
 */
export const maybeTransferHost = (room: Room, now: number): string | null => {
  if (room.hostOfflineSince === null) return null;
  if (now - room.hostOfflineSince < config.hostTransferAfterMs) return null;

  const bySeat = room.seats.find((id) => room.players.get(id)?.connected);
  const fallback = [...room.players.values()].find((p) => p.connected)?.id;
  const next = bySeat ?? fallback;
  if (!next || next === room.hostId) return null;

  room.hostId = next;
  room.hostOfflineSince = null;
  touch(room, now);
  return next;
};

export const leaveRoom = (room: Room, playerId: string, now: number): void => {
  if (isInGame(room) && isSeated(room, playerId)) {
    // 对局中不允许真正离开，只当掉线处理，否则座位号会整体前移，整局都乱了
    markDisconnected(room, playerId, now);
    return;
  }
  dropSwapInvolving(room, playerId);
  room.seats = room.seats.filter((id) => id !== playerId);
  room.players.delete(playerId);
  if (room.hostId === playerId) {
    const next = room.seats.find((id) => room.players.get(id)?.connected)
      ?? [...room.players.values()].find((p) => p.connected)?.id;
    if (next) {
      room.hostId = next;
      room.hostOfflineSince = null;
    }
  }
  touch(room, now);
};

// ──────────────────────────── 座位 ────────────────────────────

export const sit = (room: Room, playerId: string, now: number): RoomResult => {
  if (isInGame(room)) return err("ROOM_IN_GAME");
  if (!room.players.has(playerId)) return err("ROOM_NOT_FOUND");
  if (isSeated(room, playerId)) return err("ALREADY_SEATED");
  if (room.seats.length >= MAX_PLAYERS) return err("ROOM_FULL");
  room.seats.push(playerId);
  touch(room, now);
  return ok(undefined);
};

export const stand = (room: Room, playerId: string, now: number): RoomResult => {
  if (isInGame(room)) return err("ROOM_IN_GAME");
  if (!isSeated(room, playerId)) return err("NOT_SEATED");
  dropSwapInvolving(room, playerId);
  if (!room.allowSpectators) {
    // 不允许观战的房间里，起立等于离开
    leaveRoom(room, playerId, now);
    return ok(undefined);
  }
  room.seats = room.seats.filter((id) => id !== playerId);
  touch(room, now);
  return ok(undefined);
};

/** 房主调整环形座次。新顺序必须是当前落座者的一个排列，不能借机塞人或踢人 */
export const reorderSeats = (
  room: Room,
  order: readonly string[],
  now: number,
): RoomResult => {
  if (isInGame(room)) return err("ROOM_IN_GAME");
  if (order.length !== room.seats.length) return err("座位顺序必须包含且仅包含当前落座的玩家");
  const current = new Set(room.seats);
  if (new Set(order).size !== order.length) return err("座位顺序里有重复玩家");
  if (!order.every((id) => current.has(id))) return err("座位顺序里有不在座的玩家");
  room.seats = [...order];
  touch(room, now);
  return ok(undefined);
};

export const shuffleSeats = (room: Room, now: number): RoomResult => {
  if (isInGame(room)) return err("ROOM_IN_GAME");
  const seats = [...room.seats];
  for (let i = seats.length - 1; i > 0; i--) {
    const j = cryptoRng.int(i + 1);
    [seats[i], seats[j]] = [seats[j]!, seats[i]!];
  }
  room.seats = seats;
  touch(room, now);
  return ok(undefined);
};

/** 换座请求的有效期。超时自动作废，免得一个没人管的请求把对方卡住 */
export const SWAP_REQUEST_TTL_MS = 60_000;

const expireSwap = (room: Room, now: number): void => {
  if (room.pendingSwap && now - room.pendingSwap.at > SWAP_REQUEST_TTL_MS) {
    room.pendingSwap = null;
  }
};

/**
 * 向某人发起换座。线下常常临时挪位置，不能只有房主能调座次。
 * 需要对方同意 —— 单方面就能把别人挪走的话，座次会被恶意打乱。
 */
export const requestSwap = (
  room: Room,
  fromId: string,
  toId: string,
  now: number,
): RoomResult => {
  if (isInGame(room)) return err("ROOM_IN_GAME");
  if (fromId === toId) return err("不能和自己换座");

  const fromSeat = seatOf(room, fromId);
  const toSeat = seatOf(room, toId);
  if (fromSeat < 0) return err("NOT_SEATED");
  if (toSeat < 0) return err("对方不在座位上");
  if (!room.players.get(toId)?.connected) return err("对方掉线了，等他回来");

  expireSwap(room, now);
  // 已经有别的请求在等回应就先排队，避免三个人互相换把座次搅乱
  if (room.pendingSwap) return err("SWAP_TARGET_BUSY");

  room.pendingSwap = { fromPlayerId: fromId, toPlayerId: toId, fromSeat, toSeat, at: now };
  touch(room, now);
  return ok(undefined);
};

/** 回应换座请求。只有被请求的人能回应 */
export const respondSwap = (
  room: Room,
  responderId: string,
  accept: boolean,
  now: number,
): RoomResult => {
  expireSwap(room, now);
  const pending = room.pendingSwap;
  if (!pending) return err("NO_PENDING_SWAP");
  if (pending.toPlayerId !== responderId) return err("NOT_YOUR_TURN");

  room.pendingSwap = null;
  if (!accept) {
    touch(room, now);
    return ok(undefined);
  }

  // 按 playerId 重新定位：请求发出后座次可能已经变过
  const a = seatOf(room, pending.fromPlayerId);
  const b = seatOf(room, pending.toPlayerId);
  if (a < 0 || b < 0) return err("NOT_SEATED");

  const seats = [...room.seats];
  [seats[a], seats[b]] = [seats[b]!, seats[a]!];
  room.seats = seats;
  touch(room, now);
  return ok(undefined);
};

/** 有人离座或掉线时，把牵涉到他的换座请求清掉 */
export const dropSwapInvolving = (room: Room, playerId: string): void => {
  if (
    room.pendingSwap &&
    (room.pendingSwap.fromPlayerId === playerId || room.pendingSwap.toPlayerId === playerId)
  ) {
    room.pendingSwap = null;
  }
};

// ──────────────────────────── 房主操作 ────────────────────────────

export const kick = (room: Room, actorId: string, targetId: string, now: number): RoomResult => {
  if (!isHost(room, actorId)) return err("NOT_HOST");
  if (targetId === actorId) return err("不能踢自己，先移交房主");
  if (isInGame(room) && isSeated(room, targetId)) return err("ROOM_IN_GAME");
  if (!room.players.has(targetId)) return err("ROOM_NOT_FOUND");
  room.seats = room.seats.filter((id) => id !== targetId);
  room.players.delete(targetId);
  touch(room, now);
  return ok(undefined);
};

export const transferHost = (room: Room, actorId: string, targetId: string, now: number): RoomResult => {
  if (!isHost(room, actorId)) return err("NOT_HOST");
  if (!room.players.has(targetId)) return err("ROOM_NOT_FOUND");
  room.hostId = targetId;
  room.hostOfflineSince = null;
  touch(room, now);
  return ok(undefined);
};

export const setSettings = (
  room: Room,
  actorId: string,
  settings: GameSettings,
  now: number,
): RoomResult => {
  if (!isHost(room, actorId)) return err("NOT_HOST");
  if (isInGame(room)) return err("ROOM_IN_GAME");
  room.settings = settings;
  touch(room, now);
  return ok(undefined);
};

export const setOptions = (
  room: Room,
  actorId: string,
  options: {
    name?: string | undefined;
    visibility?: Room["visibility"] | undefined;
    allowSpectators?: boolean | undefined;
  },
  now: number,
): RoomResult => {
  if (!isHost(room, actorId)) return err("NOT_HOST");
  if (options.name !== undefined) room.name = options.name;
  if (options.visibility !== undefined) room.visibility = options.visibility;
  if (options.allowSpectators !== undefined) room.allowSpectators = options.allowSpectators;
  touch(room, now);
  return ok(undefined);
};

// ──────────────────────────── 对局 ────────────────────────────

export const startGame = (room: Room, actorId: string, now: number): RoomResult => {
  if (!isHost(room, actorId)) return err("NOT_HOST");
  if (room.game !== null) return err("ROOM_IN_GAME");
  const blocked = startBlockedReason(room);
  if (blocked) return err(blocked);

  const playerCount = room.seats.length;
  // startBlockedReason 已经查过，这里是给类型收窄用的，顺带兜底
  if (!isValidPlayerCount(playerCount)) return err("CANNOT_START");

  room.game = createGame({ playerCount, settings: room.settings }, cryptoRng);
  touch(room, now);
  return ok(undefined);
};

/** 再来一局：保留座位与设置，重新洗牌。可选把首任队长顺延一位 */
export const restartGame = (
  room: Room,
  actorId: string,
  rotateFirstLeader: boolean,
  now: number,
): RoomResult => {
  if (!isHost(room, actorId)) return err("NOT_HOST");
  if (isInGame(room)) return err("ROOM_IN_GAME");
  const previous = room.game;
  room.game = null;
  const started = startGame(room, actorId, now);
  if (!started.ok) {
    room.game = previous;
    return started;
  }
  if (rotateFirstLeader && previous && room.game) {
    const next = (previous.leaderSeat + 1) % room.seats.length;
    room.game = { ...(room.game as GameState), leaderSeat: next };
  }
  return ok(undefined);
};

/**
 * 只是给人看结果的过渡阶段。这些没有任何人要做决定，
 * 服务端等一小会儿自动往下走 —— 让全场卡在等房主点一下是很糟的体验。
 */
export const AUTO_ADVANCE_PHASES: ReadonlySet<string> = new Set([
  "VOTE_RESULT",
  "MISSION_RESULT",
  "LOYALTY_FLIP",
]);

export const isAutoAdvancePhase = (room: Room): boolean =>
  room.game !== null && AUTO_ADVANCE_PHASES.has(room.game.phase);

/**
 * 阶段指纹。定时器触发时用它确认「这期间没人抢先推进过」，
 * 否则会多推一次，直接跳掉下一个阶段。
 */
export const phaseStamp = (room: Room): string => {
  const g = room.game;
  if (!g) return "none";
  return [g.phase, g.roundIndex, g.attempt, g.missions.length, g.proposals.length,
    g.loyalty?.drawn ?? 0, g.lady?.checks.length ?? 0].join("/");
};

/** 服务端替房主推进。用于自动推进定时器 */
export const advanceAutomatically = (room: Room, now: number): ReduceResult | null => {
  if (!room.game) return null;
  const result = reduce(room.game, { type: "ADVANCE", byHost: true }, cryptoRng);
  if (result.ok) {
    room.game = result.state;
    touch(room, now);
  }
  return result;
};

/**
 * 把客户端动作接到引擎上。
 * **座位号在这里填**，客户端发来的 payload 里根本没有这个字段（见 shared/protocol.ts）。
 */
export const applyAction = (
  room: Room,
  playerId: string,
  action: ClientAction,
  now: number,
): RoomResult<ReduceResult> => {
  if (!room.game) return err("NOT_IN_GAME");

  const seat = seatOf(room, playerId);
  // ADVANCE 是唯一允许非在座者（房主）发的动作
  if (seat < 0 && action.type !== "ADVANCE") return err("NOT_SEATED");

  const engineAction: Action =
    action.type === "ADVANCE"
      ? { type: "ADVANCE", byHost: isHost(room, playerId) }
      : ({ ...action, seat } as Action);

  const result = reduce(room.game, engineAction, cryptoRng);
  if (result.ok) {
    room.game = result.state;
    touch(room, now);
  }
  return ok(result);
};
