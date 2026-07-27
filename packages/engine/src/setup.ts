/**
 * 发牌。GAME.md §3
 *
 * 座位是环形的，`seatIndex` 从 0 开始顺时针递增，与线下真实落座顺序一致。
 * 发牌结果 `roles[seatIndex]` 一旦生成就不再变化（兰斯洛特换的是阵营，不是角色牌）。
 */

import {
  LANCELOT_MIN_PLAYERS,
  ROLES,
  SETUP_LANCELOT,
  SETUP_STANDARD,
  isValidPlayerCount,
  type PlayerCount,
  type RoleId,
  type GameMode,
  type Side,
} from "@avalon/shared";
import { shuffle, type Rng } from "./rng.js";

/** 取该人数 / 模式下的角色牌堆（未洗牌，顺序固定，便于测试） */
export const roleDeck = (
  playerCount: PlayerCount,
  mode: GameMode,
): readonly RoleId[] => {
  if (mode === "LANCELOT") {
    const deck = SETUP_LANCELOT[playerCount];
    if (!deck) {
      throw new Error(
        `兰斯洛特模式需要 ${LANCELOT_MIN_PLAYERS}–10 人，当前 ${playerCount} 人`,
      );
    }
    return deck;
  }
  return SETUP_STANDARD[playerCount];
};

/** 某人数 / 模式组合是否可开局 */
export const canStart = (playerCount: number, mode: GameMode): boolean =>
  isValidPlayerCount(playerCount) &&
  (mode !== "LANCELOT" || playerCount >= LANCELOT_MIN_PLAYERS);

/**
 * 洗牌发牌。返回 `roles[seatIndex]`。
 * 随机源由调用方注入 —— 服务端用 crypto，测试用 seededRng。
 */
export const dealRoles = (
  playerCount: PlayerCount,
  mode: GameMode,
  rng: Rng,
): readonly RoleId[] => shuffle(roleDeck(playerCount, mode), rng);

/** 由角色牌推出初始阵营。兰斯洛特之后可能改变，见 lancelot.ts */
export const initialSides = (roles: readonly RoleId[]): readonly Side[] =>
  roles.map((r) => ROLES[r].side);

/** 找到担任某角色的座位；找不到返回 -1 */
export const seatOfRole = (roles: readonly RoleId[], role: RoleId): number =>
  roles.indexOf(role);
