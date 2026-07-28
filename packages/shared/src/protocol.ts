/**
 * 线上协议的**纯类型与常量**。前后端共用。
 *
 * Zod schema 在 `@avalon/shared/schemas`，**只有服务端会 import** ——
 * 浏览器不需要校验入站 payload（那是服务端的职责），
 * 把 zod 打进前端包白白多 265 KB。
 */

import type { GameEvent, GameSettings } from "./game.js";
import type { ClientGameView } from "./view.js";

// ──────────────────────────── 文本清洗 ────────────────────────────

/**
 * 不可见字符：控制字符、零宽空格/连接符、双向文本覆盖符、字形连接符、BOM。
 * 这些是「看起来是空昵称」「和别人同名」「把后面的文字反转」的常见手法，直接剔掉。
 * 用显式 \uXXXX 转义写，不用字面量 —— 字面量在编辑器和 diff 里会被悄悄吃掉。
 */
const INVISIBLE =
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

/** 昵称/房间名清洗。前端也调它做实时预览，保证两边结果一致 */
export const sanitizeText = (raw: string, maxLength: number): string =>
  raw.replace(INVISIBLE, "").replace(/\s+/g, " ").trim().slice(0, maxLength);

export const NICK_MAX = 12;
export const ROOM_NAME_MAX = 20;

/** 房间码字母表，已去掉形近的 0/O/1/I，方便口头念给同桌的人 */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

// ──────────────────────────── 身份 ────────────────────────────

/**
 * 头像。用 DiceBear `micah`（与 vue-color-avatar 同源美术，CC BY 4.0）。
 * 只存 seed 和背景色几十个字节，SVG 由前端本地生成，零网络请求。
 */
export interface Avatar {
  readonly seed: string;
  /** 背景色，六位十六进制不带 # */
  readonly bg: string;
}

export interface Profile {
  readonly nick: string;
  readonly avatar: Avatar;
}

export interface RoomOptions {
  readonly name: string;
  readonly visibility: "PUBLIC" | "PRIVATE";
  readonly allowSpectators: boolean;
}

// ──────────────────────────── 客户端 → 服务端 ────────────────────────────

/**
 * 对局动作。对照 `@avalon/engine` 的 `Action`，**故意不含 `seat`** ——
 * 座位由服务端按连接身份填入。让客户端自报座位，
 * 等于把「你是不是队长」「这是不是你的票」全部校验送出去。
 * `ADVANCE` 同理不含 `byHost`：是不是房主由服务端认定。
 */
export type ClientAction =
  | { readonly type: "ACK_ROLE" }
  | {
      readonly type: "PROPOSE_TEAM";
      readonly team: readonly number[];
      readonly speakDirection: "CW" | "CCW" | null;
    }
  | { readonly type: "VOTE"; readonly approve: boolean }
  | { readonly type: "PLAY_CARD"; readonly success: boolean }
  | { readonly type: "LADY_CHECK"; readonly targetSeat: number }
  | { readonly type: "EARLY_ASSASSINATE" }
  | { readonly type: "ASSASSINATE"; readonly targetSeat: number }
  | { readonly type: "ADVANCE" };

/** 事件名列表。schema 表在 @avalon/shared/schemas，两边必须对齐 */
export const CLIENT_EVENT_NAMES = [
  "room:join",
  "room:leave",
  "room:profile",
  "room:sit",
  "room:stand",
  "room:ready",
  "room:seatCount",
  "room:dissolve",
  "room:reorder",
  "room:shuffleSeats",
  "room:requestSwap",
  "room:respondSwap",
  "room:settings",
  "room:options",
  "room:kick",
  "room:transferHost",
  "game:start",
  "game:restart",
  "game:action",
] as const;

export type ClientEventName = (typeof CLIENT_EVENT_NAMES)[number];

// ──────────────────────────── 服务端 → 客户端 ────────────────────────────


export interface PublicPlayer {
  readonly id: string;
  readonly nick: string;
  readonly avatar: Avatar;
  /** null = 还没入座（开局前在等待区，开局后就是观战） */
  readonly seat: number | null;
  readonly connected: boolean;
  readonly isHost: boolean;
  /** 已准备。只有在座玩家有意义 */
  readonly ready: boolean;
}

/** 一次待处理的换座请求。线下常常临时挪位置，得让玩家自己能换 */
export interface PendingSwap {
  readonly fromPlayerId: string;
  readonly toPlayerId: string;
  readonly fromSeat: number;
  readonly toSeat: number;
}

export interface RoomView {
  readonly id: string;
  readonly name: string;
  readonly visibility: "PUBLIC" | "PRIVATE";
  readonly allowSpectators: boolean;
  readonly hostId: string;
  readonly settings: GameSettings;
  /** 房主设定的座位数，也就是「几人局」 */
  readonly seatCount: number;
  /**
   * 环形座位，索引即 seatIndex，长度恒为 seatCount。
   * `null` 表示空位 —— 玩家点空位入座。开局后不会有 null。
   */
  readonly seats: readonly (PublicPlayer | null)[];
  /** 没入座的人：开局前是等待区，开局后是观战席 */
  readonly standing: readonly PublicPlayer[];
  readonly inGame: boolean;
  /** 当前配置下能否开局；不能开时 `startBlockedReason` 说明原因 */
  readonly canStart: boolean;
  readonly startBlockedReason: string | null;
  /** 当前待处理的换座请求，同一时刻只允许有一个 */
  readonly pendingSwap: PendingSwap | null;
}

/** 大厅列表条目。刻意不含玩家身份、不含 IP */
export interface RoomSummary {
  readonly id: string;
  readonly name: string;
  readonly playerCount: number;
  readonly inGame: boolean;
  readonly allowSpectators: boolean;
}

/** 每次状态变更都下发全量（裁剪后）。状态才几 KB，简单胜过增量 diff，且天然解决重连一致性 */
export interface StatePayload {
  readonly room: RoomView;
  /** 未开局为 null */
  readonly game: ClientGameView | null;
  /** 我是谁。观战者也有，用来认自己 */
  readonly selfId: string;
}

export type ServerErrorCode =
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "ROOM_IN_GAME"
  | "NOT_HOST"
  | "NOT_SEATED"
  | "ALREADY_SEATED"
  | "SPECTATORS_DISABLED"
  | "INVALID_PAYLOAD"
  | "RATE_LIMITED"
  | "CANNOT_START"
  | "NOT_IN_GAME"
  | "SWAP_TARGET_BUSY"
  | "NO_PENDING_SWAP";

export interface ServerEvents {
  state: (payload: StatePayload) => void;
  /** 一次性提示，用来播动画和音效 */
  event: (payload: GameEvent) => void;
  error: (payload: { code: ServerErrorCode | string; message: string }) => void;
  "room:list": (payload: { rooms: readonly RoomSummary[] }) => void;
  /** 被踢或房间解散 */
  kicked: (payload: { reason: string }) => void;
}
