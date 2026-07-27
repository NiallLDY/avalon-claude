/**
 * Socket.IO 线上协议。前后端共用，新增事件必须同时补 schema 与 PLAN.md §5 的协议表。
 *
 * 两条设计约束：
 *
 * 1. **客户端动作里没有 `seat` 字段。** 座位由服务端按连接身份填入。
 *    让客户端自报座位，等于把「你是不是队长」「这是不是你的票」全部校验送出去。
 * 2. **所有入站消息过 Zod。** 校验失败直接丢弃并计入限流，不试图纠正。
 */

import { z } from "zod";
import {
  LOYALTY_SWAP_CHANCES,
  MAX_PLAYERS,
  MIN_PLAYERS,
} from "./tables.js";
import type { ClientGameView } from "./view.js";
import type { GameEvent, GameSettings } from "./game.js";

// ──────────────────────────── 基础字段 ────────────────────────────

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

export const nickSchema = z
  .string()
  .max(NICK_MAX * 4) // 先挡住超长 payload，再清洗
  .transform((v) => sanitizeText(v, NICK_MAX))
  .refine((v) => v.length > 0, { message: "昵称不能为空" });

export const roomNameSchema = z
  .string()
  .max(ROOM_NAME_MAX * 4)
  .transform((v) => sanitizeText(v, ROOM_NAME_MAX))
  .refine((v) => v.length > 0, { message: "房间名不能为空" });

/**
 * 头像。用 DiceBear `micah`（与 vue-color-avatar 同源美术，CC BY 4.0）。
 * 只存 seed 和背景色几十个字节，SVG 由前端本地生成，零网络请求。
 */
export const avatarSchema = z.object({
  seed: z.string().min(1).max(64),
  /** 背景色，六位十六进制不带 # */
  bg: z.string().regex(/^[0-9a-fA-F]{6}$/),
});
export type Avatar = z.infer<typeof avatarSchema>;

export const profileSchema = z.object({
  nick: nickSchema,
  avatar: avatarSchema,
});
export type Profile = z.infer<typeof profileSchema>;

/** 房间码：6 位大写字母数字，去掉了形近的 0/O/1/I */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const roomIdSchema = z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/);

const seatSchema = z.number().int().min(0).max(MAX_PLAYERS - 1);
const playerIdSchema = z.string().uuid();

// ──────────────────────────── 房间设置 ────────────────────────────

export const gameSettingsSchema = z.object({
  mode: z.enum(["STANDARD", "LANCELOT"]),
  ladyOfTheLake: z.boolean(),
  earlyAssassination: z.boolean(),
  leaderRotation: z.enum(["CLOCKWISE", "RANDOM"]),
  rejectCounting: z.enum(["PER_ROUND", "GLOBAL"]),
  loyaltyFlipTiming: z.enum(["NORMAL", "OPENING"]),
  loyaltySwapChance: z.number().refine(
    (v) => (LOYALTY_SWAP_CHANCES as readonly number[]).includes(v),
    { message: "阵营转换概率只能是预设的三档之一" },
  ),
  hideLoyaltyFlipResult: z.boolean(),
}) satisfies z.ZodType<GameSettings>;

export const roomOptionsSchema = z.object({
  name: roomNameSchema,
  visibility: z.enum(["PUBLIC", "PRIVATE"]),
  allowSpectators: z.boolean(),
});
export type RoomOptions = z.infer<typeof roomOptionsSchema>;

// ──────────────────────────── 客户端 → 服务端 ────────────────────────────

/**
 * 对局动作。对照 `@avalon/engine` 的 `Action`，**故意不含 `seat`**。
 * `ADVANCE` 也不含 `byHost` —— 是不是房主由服务端认定。
 */
export const clientActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ACK_ROLE") }),
  z.object({
    type: z.literal("PROPOSE_TEAM"),
    team: z.array(seatSchema).min(2).max(5),
    speakDirection: z.enum(["CW", "CCW"]).nullable(),
  }),
  z.object({ type: z.literal("VOTE"), approve: z.boolean() }),
  z.object({ type: z.literal("PLAY_CARD"), success: z.boolean() }),
  z.object({ type: z.literal("LADY_CHECK"), targetSeat: seatSchema }),
  z.object({ type: z.literal("EARLY_ASSASSINATE") }),
  z.object({ type: z.literal("ASSASSINATE"), targetSeat: seatSchema }),
  z.object({ type: z.literal("ADVANCE") }),
]);
export type ClientAction = z.infer<typeof clientActionSchema>;

/** 事件名 → 入站 payload schema。socket 层照着这张表挂监听，漏挂会被类型检查抓到 */
export const CLIENT_EVENTS = {
  "room:join": z.object({ roomId: roomIdSchema, asSpectator: z.boolean().optional() }),
  "room:leave": z.object({}),
  "room:profile": profileSchema,
  "room:sit": z.object({}),
  "room:stand": z.object({}),
  /** 房主调整环形座次，必须是当前落座者的一个排列 */
  "room:reorder": z.object({ order: z.array(playerIdSchema).min(MIN_PLAYERS).max(MAX_PLAYERS) }),
  "room:shuffleSeats": z.object({}),
  "room:settings": z.object({ settings: gameSettingsSchema }),
  "room:options": roomOptionsSchema.partial(),
  "room:kick": z.object({ playerId: playerIdSchema }),
  "room:transferHost": z.object({ playerId: playerIdSchema }),
  "game:start": z.object({}),
  "game:restart": z.object({ rotateFirstLeader: z.boolean().optional() }),
  "game:action": z.object({ action: clientActionSchema }),
} as const;

export type ClientEventName = keyof typeof CLIENT_EVENTS;
export type ClientPayload<E extends ClientEventName> = z.infer<(typeof CLIENT_EVENTS)[E]>;

// ──────────────────────────── 服务端 → 客户端 ────────────────────────────

export interface PublicPlayer {
  readonly id: string;
  readonly nick: string;
  readonly avatar: Avatar;
  /** null = 观战 */
  readonly seat: number | null;
  readonly connected: boolean;
  readonly isHost: boolean;
}

export interface RoomView {
  readonly id: string;
  readonly name: string;
  readonly visibility: "PUBLIC" | "PRIVATE";
  readonly allowSpectators: boolean;
  readonly hostId: string;
  readonly settings: GameSettings;
  /** 按座次顺序排列，索引即 seatIndex */
  readonly seated: readonly PublicPlayer[];
  readonly spectators: readonly PublicPlayer[];
  readonly inGame: boolean;
  /** 当前配置下能否开局；不能开时 `startBlockedReason` 说明原因 */
  readonly canStart: boolean;
  readonly startBlockedReason: string | null;
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
  | "NOT_IN_GAME";

export interface ServerEvents {
  state: (payload: StatePayload) => void;
  /** 一次性提示，用来播动画和音效 */
  event: (payload: GameEvent) => void;
  error: (payload: { code: ServerErrorCode | string; message: string }) => void;
  "room:list": (payload: { rooms: readonly RoomSummary[] }) => void;
  /** 被踢或房间解散 */
  kicked: (payload: { reason: string }) => void;
}
