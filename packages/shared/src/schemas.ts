/**
 * 入站消息的 Zod schema。**只有服务端 import 这个模块** ——
 * 走 `@avalon/shared/schemas` 子入口，这样 zod 不会被打进前端包。
 *
 * 校验哲学：非法 payload 直接拒绝并计入限流，不试图纠正。
 * 新增 socket 事件必须同时补这里的 schema 与 PLAN.md §5 的协议表。
 */

import { z } from "zod";
import { LOYALTY_SWAP_CHANCES, MAX_PLAYERS, MIN_PLAYERS } from "./tables.js";
import type { GameSettings } from "./game.js";
import {
  CLIENT_EVENT_NAMES,
  NICK_MAX,
  ROOM_CODE_PATTERN,
  ROOM_NAME_MAX,
  sanitizeText,
  type Avatar,
  type ClientAction,
  type ClientEventName,
  type Profile,
  type RoomOptions,
} from "./protocol.js";

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

export const avatarSchema = z.object({
  seed: z.string().min(1).max(64),
  bg: z.string().regex(/^[0-9a-fA-F]{6}$/),
}) satisfies z.ZodType<Avatar>;

export const profileSchema = z.object({
  nick: nickSchema,
  avatar: avatarSchema,
}) satisfies z.ZodType<Profile, unknown>;

export const roomIdSchema = z.string().regex(ROOM_CODE_PATTERN);

const seatSchema = z.number().int().min(0).max(MAX_PLAYERS - 1);
const playerIdSchema = z.string().uuid();

export const gameSettingsSchema = z.object({
  mode: z.enum(["STANDARD", "LANCELOT"]),
  ladyOfTheLake: z.boolean(),
  earlyAssassination: z.boolean(),
  leaderRotation: z.enum(["CLOCKWISE", "RANDOM"]),
  rejectCounting: z.enum(["PER_ROUND", "GLOBAL"]),
  loyaltyFlipTiming: z.enum(["NORMAL", "OPENING"]),
  loyaltySwapChance: z
    .number()
    .refine((v) => (LOYALTY_SWAP_CHANCES as readonly number[]).includes(v), {
      message: "阵营转换概率只能是预设的三档之一",
    }),
  hideLoyaltyFlipResult: z.boolean(),
}) satisfies z.ZodType<GameSettings>;

export const roomOptionsSchema = z.object({
  name: roomNameSchema,
  visibility: z.enum(["PUBLIC", "PRIVATE"]),
  allowSpectators: z.boolean(),
}) satisfies z.ZodType<RoomOptions, unknown>;

/** 对照 protocol.ts 的 `ClientAction`：没有 seat，没有 byHost */
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
]) satisfies z.ZodType<ClientAction, unknown>;

/** 事件名 → 入站 payload schema。socket 层照着这张表挂监听 */
export const CLIENT_EVENTS = {
  "room:join": z.object({ roomId: roomIdSchema, asSpectator: z.boolean().optional() }),
  "room:leave": z.object({}),
  "room:profile": profileSchema,
  "room:sit": z.object({}),
  "room:stand": z.object({}),
  /** 房主调整环形座次，必须是当前落座者的一个排列 */
  "room:reorder": z.object({
    order: z.array(playerIdSchema).min(MIN_PLAYERS).max(MAX_PLAYERS),
  }),
  "room:shuffleSeats": z.object({}),
  "room:settings": z.object({ settings: gameSettingsSchema }),
  "room:options": roomOptionsSchema.partial(),
  "room:kick": z.object({ playerId: playerIdSchema }),
  "room:transferHost": z.object({ playerId: playerIdSchema }),
  "game:start": z.object({}),
  "game:restart": z.object({ rotateFirstLeader: z.boolean().optional() }),
  "game:action": z.object({ action: clientActionSchema }),
} satisfies Record<ClientEventName, z.ZodTypeAny>;

export type ClientPayload<E extends ClientEventName> = z.infer<(typeof CLIENT_EVENTS)[E]>;

/** 防漏：schema 表必须覆盖协议里声明的每个事件名 */
export const assertEventCoverage = (): void => {
  for (const name of CLIENT_EVENT_NAMES) {
    if (!(name in CLIENT_EVENTS)) throw new Error(`事件 ${name} 缺少 schema`);
  }
};
