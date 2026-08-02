/**
 * 标识符生成。全部走 node:crypto —— 房间码、token、发牌随机数都不能用 Math.random。
 */

import { randomInt, randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "@avalon/shared";
import type { Rng } from "@avalon/engine";

/** 6 位纯数字房间码，念给同桌的人听没有歧义。取值范围见 ROOM_CODE_ALPHABET 那条注释 */
export const newRoomCode = (): string =>
  Array.from(
    { length: ROOM_CODE_LENGTH },
    () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)],
  ).join("");

export const newPlayerId = (): string => randomUUID();

export const newToken = (): string => randomBytes(32).toString("base64url");

/** 定长比较，避免用 === 比 token 时泄漏前缀信息 */
export const tokenEquals = (a: string, b: string): boolean => {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
};

/**
 * 引擎用的随机源。引擎自己不许调随机数（CLAUDE.md 铁律 7），
 * 由这里注入 —— 发牌和翻忠诚牌都得是密码学随机，不能让人预测。
 */
export const cryptoRng: Rng = {
  int: (maxExclusive: number): number => (maxExclusive <= 0 ? 0 : randomInt(maxExclusive)),
};
