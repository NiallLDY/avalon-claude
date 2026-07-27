/**
 * 无账号身份。PLAN.md §6
 *
 * 身份 = localStorage 里的 playerId + token，没有登录、没有邮箱、没有密码。
 * 换手机 = 新身份，重新设昵称头像 —— 这是产品决定，不是妥协。
 */

import type { Avatar, Profile } from "@avalon/shared";

const KEY_ID = "avalon.playerId";
const KEY_TOKEN = "avalon.token";
const KEY_PROFILE = "avalon.profile";
const KEY_ART_STYLE = "avalon.artStyle";
const KEY_LAST_ROOM = "avalon.lastRoom";

const randomHex = (bytes: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/** 头像背景色候选。都压过暗，保证白色描边和深色底都压得住 */
export const AVATAR_BACKGROUNDS = [
  "2a3145", "3b4a6b", "4a3a5e", "5e3a3a", "3a5e4a",
  "5e523a", "3a4f5e", "50395e", "5e4433", "34495e",
] as const;

export const randomAvatar = (): Avatar => ({
  seed: randomHex(6),
  bg: AVATAR_BACKGROUNDS[Math.floor(Math.random() * AVATAR_BACKGROUNDS.length)]!,
});

const DEFAULT_NICKS = ["圆桌骑士", "湖畔来客", "卡美洛", "游侠", "吟游诗人", "无名氏"];

export const loadIdentity = (): { playerId: string; token: string } => {
  let playerId = localStorage.getItem(KEY_ID);
  let token = localStorage.getItem(KEY_TOKEN);
  if (!playerId || !token) {
    playerId = crypto.randomUUID();
    token = randomHex(32);
    localStorage.setItem(KEY_ID, playerId);
    localStorage.setItem(KEY_TOKEN, token);
  }
  return { playerId, token };
};

export const loadProfile = (): Profile => {
  const raw = localStorage.getItem(KEY_PROFILE);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Profile;
      if (parsed?.nick && parsed?.avatar?.seed) return parsed;
    } catch {
      // 存坏了就当没有，重新生成
    }
  }
  return {
    nick: DEFAULT_NICKS[Math.floor(Math.random() * DEFAULT_NICKS.length)]!,
    avatar: randomAvatar(),
  };
};

export const saveProfile = (profile: Profile): void => {
  localStorage.setItem(KEY_PROFILE, JSON.stringify(profile));
};

/** 角色卡画风是个人偏好，不进房间状态，也不影响服务端 */
export const loadArtStyle = (): string => localStorage.getItem(KEY_ART_STYLE) ?? "painterly";
export const saveArtStyle = (id: string): void => localStorage.setItem(KEY_ART_STYLE, id);

/**
 * 记住「我在哪个房间」。刷新页面时 socket 是全新的连接，
 * 服务端虽然凭 playerId 还认得人、座位也留着，但它不知道该把状态推给哪个 socket ——
 * 得由客户端把房间号补回去，否则一刷新就掉回大厅。
 */
export const saveLastRoom = (roomId: string): void =>
  localStorage.setItem(KEY_LAST_ROOM, roomId);
export const loadLastRoom = (): string | null => localStorage.getItem(KEY_LAST_ROOM);
export const clearLastRoom = (): void => localStorage.removeItem(KEY_LAST_ROOM);
