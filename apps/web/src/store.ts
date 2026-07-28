/**
 * 全局状态。服务端每次变更都下发全量裁剪视图，前端只负责存下来渲染 ——
 * 这里**不做任何规则推导**，任何"我猜现在该谁操作"的逻辑都属于服务端。
 */

import { create } from "zustand";
import { io, type Socket } from "socket.io-client";
import type {
  ClientAction,
  ClientGameView,
  GameEvent,
  GameSettings,
  Profile,
  Reaction,
  RoomSummary,
  StatePayload,
} from "@avalon/shared";
import {
  clearLastRoom,
  hasProfile,
  loadIdentity,
  loadLastRoom,
  loadProfile,
  saveLastRoom,
  saveProfile,
} from "./lib/identity.js";

/**
 * 一张待玩家点掉的结果卡。事件到达时就把当时的状态快照进去 ——
 * 服务端会自动往下走，等玩家点的时候原状态已经没了。
 */
export type ResultCard =
  | {
      readonly kind: "VOTE";
      readonly id: number;
      readonly approved: boolean;
      readonly rejectStreak: number;
      readonly votes: readonly boolean[];
      readonly team: readonly number[];
    }
  | {
      readonly kind: "MISSION";
      readonly id: number;
      readonly success: boolean;
      readonly failCount: number;
      readonly failsRequired: 1 | 2;
      readonly team: readonly number[];
    }
  | { readonly kind: "LOYALTY"; readonly id: number; readonly swapped: boolean | null };

interface Toast {
  readonly id: number;
  readonly text: string;
  readonly tone: "info" | "error";
}

/**
 * 连接状态要分三态而不是布尔值。
 * 只有 `connected` 一个布尔的话，页面刚加载时它必然是 false，
 * 于是每次刷新都会闪一下"连接断开" —— 那是首次连接中，不是断线。
 */
export type ConnStatus = "connecting" | "connected" | "reconnecting";

/** 飞在屏幕上的一朵花 / 一颗蛋。动画放完就删掉 */
export interface FlyingReaction {
  readonly id: number;
  readonly fromSeat: number;
  readonly targetSeat: number;
  readonly kind: Reaction;
}

/** 动画时长。和 styles.css 里的 reaction-fly 关键帧对齐 */
const REACTION_MS = 1_200;

/** 心跳间隔。线下发牌器的流量可以忽略不计，快一点让卡顿早点被看见 */
const PING_INTERVAL_MS = 4_000;

interface AppState {
  socket: Socket | null;
  conn: ConnStatus;
  /** 最近一次往返延迟（毫秒）。null = 还没量到，或当前断着 */
  rtt: number | null;
  profile: Profile;
  rooms: readonly RoomSummary[];
  state: StatePayload | null;
  /**
   * 刚打完那一局的快照，**由本人点掉**。
   *
   * 「再来一局」是全房间一起回等待页的，谁先点大家一起走 ——
   * 于是还在看身份揭晓和战报的人被当场拽走，结果一闪而过。
   * 所以终局画面在本地留一份：房间已经回等待页了也照样显示，
   * 直到你自己点「再来一局」。新的一局开始时会被顶掉（那时必须跟上）。
   */
  finishedGame: ClientGameView | null;
  /** 正在自动回房（刷新后恢复），此时不该把用户甩回大厅 */
  restoring: boolean;
  /** 还没设过昵称头像，先挡一道首次设置 */
  needsOnboarding: boolean;
  /** 规则页开着没。任何页面都能开，所以放全局 */
  rulesOpen: boolean;
  lastEvent: GameEvent | null;
  /** 正在飞的花和蛋 */
  reactions: readonly FlyingReaction[];
  /** 当前盖在屏幕上的结果卡，玩家点掉为止 */
  result: ResultCard | null;
  toasts: readonly Toast[];

  connect: () => void;
  setProfile: (profile: Profile) => void;
  completeOnboarding: () => void;
  setRulesOpen: (open: boolean) => void;
  createRoom: (opts: {
    name: string;
    visibility: "PUBLIC" | "PRIVATE";
    allowSpectators: boolean;
  }) => Promise<string | null>;
  joinRoom: (roomId: string, asSpectator?: boolean) => void;
  leaveRoom: () => void;
  refreshRooms: (query?: string) => Promise<void>;
  emit: (event: string, payload?: unknown) => void;
  act: (action: ClientAction) => void;
  react: (targetSeat: number, kind: Reaction) => void;
  setSettings: (settings: GameSettings) => void;
  toast: (text: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: number) => void;
  dismissResult: () => void;
  /** 看完终局了，回等待页。房间还没重开的话顺手把它重开 */
  leaveFinished: () => void;
}

const identity = loadIdentity();
let toastSeq = 0;
let resultSeq = 0;
let reactionSeq = 0;

/** 错误码 → 给人看的话。服务端回的是机器码，别直接甩给用户 */
const ERROR_TEXT: Record<string, string> = {
  ROOM_NOT_FOUND: "房间不存在或已解散",
  ROOM_FULL: "房间满了",
  ROOM_IN_GAME: "牌局进行中，现在改不了",
  NOT_HOST: "只有房主能这么做",
  NOT_SEATED: "你不在座位上",
  ALREADY_SEATED: "你已经入座了",
  SPECTATORS_DISABLED: "这个房间不允许观战",
  INVALID_PAYLOAD: "这个操作没生效，再试一次",
  RATE_LIMITED: "操作太快了，慢一点",
  NOT_IN_GAME: "这局还没开始",
  WRONG_PHASE: "现在还轮不到做这个",
  NOT_YOUR_TURN: "还没轮到你",
  INVALID_SEAT: "这个人选不了",
  INVALID_TEAM_SIZE: "上车人数不对",
  DUPLICATE_TEAM_MEMBER: "同一个人只能选一次",
  NOT_ON_TEAM: "你不在这一车上",
  ALREADY_ACTED: "你已经操作过了",
  ILLEGAL_CARD: "你不能打这张牌",
  INVALID_LADY_TARGET: "这个人不能被查验",
  EARLY_ASSASSINATION_UNAVAILABLE: "提前刺杀还没解锁",
  GAME_OVER: "这局已经结束",
  SWAP_TARGET_BUSY: "对方正在处理别的换座请求",
  NO_PENDING_SWAP: "这个换座请求已经失效了",
};

export const useStore = create<AppState>((set, get) => ({
  socket: null,
  conn: "connecting",
  rtt: null,
  profile: loadProfile(),
  rooms: [],
  state: null,
  finishedGame: null,
  restoring: loadLastRoom() !== null,
  needsOnboarding: !hasProfile(),
  rulesOpen: false,
  lastEvent: null,
  reactions: [],
  result: null,
  toasts: [],

  connect: () => {
    if (get().socket) return;
    const socket = io({
      path: "/ws",
      transports: ["websocket", "polling"],
      auth: { ...identity, profile: get().profile },
      // 手机锁屏/切后台/换网都会断，重连必须够积极
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4_000,
    });

    // 心跳：发出去的是自己的时间戳，服务端原样回声，差值就是 RTT。
    // 只在真连着的时候发 —— 断线期间 socket.io 会把 emit 排队缓存，
    // 等重连上一次性冲出去，那批回声算出来的「延迟」是掉线时长，不是网络延迟。
    const ping = (): void => {
      if (socket.connected) socket.emit("net:ping", { t: Date.now() });
    };
    const pingTimer = setInterval(ping, PING_INTERVAL_MS);
    window.addEventListener("beforeunload", () => clearInterval(pingTimer));

    socket.on("net:pong", ({ t }: { t: number }) => {
      set({ rtt: Math.max(0, Date.now() - t) });
    });

    socket.on("connect", () => {
      set({ conn: "connected" });
      ping(); // 别让用户等满一个心跳周期才看到数字

      // 刷新或断线重连后自动回到原房间。
      // 服务端凭 playerId 认人，座位和房主身份都还在，这里只要把「我在哪个房间」补回去。
      //
      // **每次连上都要发，不能因为 state 还在就跳过。**
      // 断线重连建的是一条全新的连接，服务端那边 socket.data.roomId 是空的；
      // 只有刷新才会让 state 变 null。所以「state 还在」恰恰是重连的情形 ——
      // 跳过 join 的话玩家屏幕上一切正常（旧状态还挂着），实际已经是个幽灵：
      // 收不到任何推送，操作也全被当成「不在房间里」丢掉。
      // 服务端的 joinRoom 对已在房间的玩家是幂等的，重复发没有副作用。
      const roomId = loadLastRoom();
      if (roomId) socket.emit("room:join", { roomId });
      else set({ restoring: false });
    });

    // 断了就把 rtt 清掉 —— 留着最后一次的读数会显示成绿灯，比不显示还误导人
    socket.on("disconnect", () => set({ conn: "reconnecting", rtt: null }));

    socket.on("state", (payload: StatePayload) => {
      saveLastRoom(payload.room.id);
      set({ state: payload, restoring: false });

      // 终局画面留一份在本地，等本人点掉；新的一局开始就顶掉它
      if (payload.game?.phase === "GAME_OVER") set({ finishedGame: payload.game });
      else if (payload.game !== null) set({ finishedGame: null });
    });

    socket.on("room:list", ({ rooms }: { rooms: RoomSummary[] }) => set({ rooms }));

    socket.on("reaction", (r: Omit<FlyingReaction, "id">) => {
      const id = ++reactionSeq;
      set((s) => ({ reactions: [...s.reactions, { ...r, id }] }));
      setTimeout(
        () => set((s) => ({ reactions: s.reactions.filter((x) => x.id !== id) })),
        REACTION_MS,
      );
    });

    socket.on("event", (event: GameEvent) => {
      set({ lastEvent: event });
      // 服务端先推 state 再推 event，所以这里读到的正是结果那一刻的状态。
      // 必须当场快照下来 —— 过几秒它就自动进下一阶段，投票明细就没了。
      const game = get().state?.game;
      if (!game) return;

      if (event.type === "VOTE_REVEALED" && game.revealedVotes) {
        set({
          result: {
            kind: "VOTE",
            id: ++resultSeq,
            approved: event.approved,
            rejectStreak: event.rejectStreak,
            votes: [...game.revealedVotes],
            team: [...(game.team ?? [])],
          },
        });
      } else if (event.type === "MISSION_RESOLVED") {
        const mission = game.missions.at(-1);
        if (!mission) return;
        set({
          result: {
            kind: "MISSION",
            id: ++resultSeq,
            success: event.success,
            failCount: event.failCount,
            failsRequired: mission.failsRequired,
            team: [...mission.team],
          },
        });
      } else if (event.type === "LOYALTY_FLIPPED") {
        set({
          result: {
            kind: "LOYALTY",
            id: ++resultSeq,
            swapped: event.hidden ? null : event.swapped,
          },
        });
      }
    });

    socket.on("error", ({ code, message }: { code: string; message: string }) => {
      // 自动回房失败（房间已解散等）不该弹错，安静回大厅就行
      if (get().restoring && code === "ROOM_NOT_FOUND") {
        clearLastRoom();
        set({ restoring: false });
        return;
      }
      get().toast(ERROR_TEXT[code] ?? message ?? "出了点问题，再试一次", "error");
    });

    socket.on("kicked", ({ reason }: { reason: string }) => {
      clearLastRoom();
      set({ state: null, finishedGame: null, restoring: false });
      get().toast(reason, "error");
    });

    set({ socket });
  },

  setProfile: (profile) => {
    saveProfile(profile);
    set({ profile });
    // **不管在不在房间里都要发。**
    // socket 是应用挂载时就握手的，auth 里带的是那一刻的 profile；
    // 之后改的昵称如果不同步，进房时服务端用的还是握手时那个旧名字。
    get().socket?.emit("room:profile", profile);
  },

  completeOnboarding: () => set({ needsOnboarding: false }),
  setRulesOpen: (rulesOpen) => set({ rulesOpen }),

  createRoom: async (opts) => {
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json", "x-player-id": identity.playerId },
      body: JSON.stringify(opts),
    });
    const body = (await res.json()) as { room?: RoomSummary; message?: string };
    if (!res.ok || !body.room) {
      get().toast(body.message ?? "建房失败", "error");
      return null;
    }
    get().joinRoom(body.room.id);
    return body.room.id;
  },

  joinRoom: (roomId, asSpectator) => {
    get().socket?.emit("room:join", { roomId, asSpectator: asSpectator ?? false });
  },

  leaveRoom: () => {
    get().socket?.emit("room:leave", {});
    clearLastRoom();
    set({ state: null, finishedGame: null, restoring: false });
  },

  leaveFinished: () => {
    // 房间还停在终局就由我来把它退回等待页；已经有人先点过就只清自己这份
    if (get().state?.game !== null) get().socket?.emit("game:restart", {});
    set({ finishedGame: null });
  },

  refreshRooms: async (query) => {
    const url = query ? `/api/rooms?q=${encodeURIComponent(query)}` : "/api/rooms";
    const res = await fetch(url);
    if (!res.ok) return;
    const body = (await res.json()) as { rooms: RoomSummary[] };
    set({ rooms: body.rooms });
  },

  emit: (event, payload) => get().socket?.emit(event, payload ?? {}),
  act: (action) => get().socket?.emit("game:action", { action }),
  react: (targetSeat, kind) => get().socket?.emit("game:react", { targetSeat, kind }),
  setSettings: (settings) => get().socket?.emit("room:settings", { settings }),

  toast: (text, tone = "info") => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }));
    setTimeout(() => get().dismissToast(id), 2600);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  dismissResult: () => set({ result: null }),
}));

export const selfId = identity.playerId;
