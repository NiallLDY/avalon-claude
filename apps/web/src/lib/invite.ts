/**
 * 邀请链接。`https://<站点>/j/123456`
 *
 * 线下开桌时最麻烦的一步是"把房间码念给七个人听" —— 发条链接点进来就行。
 * 没设过昵称的人会先被首次设置挡一道，设完自动进房（见 store 里的 pendingInvite）。
 *
 * 服务端对非 /api 路径一律回 index.html（`apps/server/src/index.ts` 的 SPA 兜底），
 * 所以 `/j/123456` 直接刷新也进得来。
 */

import { ROOM_CODE_PATTERN } from "@avalon/shared";

const PREFIX = "/j/";

export const inviteUrl = (roomId: string): string =>
  `${window.location.origin}${PREFIX}${roomId}`;

/**
 * 从路径里解析邀请码，不是合法房间码就当没有。
 *
 * 拆成纯函数是为了能单测 —— 它要挡住的正是「链接被聊天软件改过」这类输入：
 * 尾部多个斜杠、被截断、带上莫名其妙的后缀。宁可当作没邀请，也不要拿一个
 * 半截的码去 join，那只会换来一句「房间不存在」。
 */
export const parseInviteCode = (pathname: string): string | null => {
  if (!pathname.startsWith(PREFIX)) return null;
  const code = pathname.slice(PREFIX.length).replace(/\/+$/, "");
  return ROOM_CODE_PATTERN.test(code) ? code : null;
};

/**
 * 从当前地址里取邀请码。
 *
 * **纯读，不清地址栏** —— 清了之后在首次设置那一步刷新一下邀请就没了。
 * 真正进了房再由 `clearInviteUrl` 擦干净。
 */
export const readInviteCode = (): string | null => parseInviteCode(window.location.pathname);

/** 进房成功（或确认进不去）之后把地址栏收回根路径，别让邀请码一直挂着 */
export const clearInviteUrl = (): void => {
  if (window.location.pathname === "/") return;
  window.history.replaceState(null, "", "/");
};

export type ShareResult = "shared" | "copied" | "cancelled" | "failed";

/**
 * 分享邀请链接。优先调系统分享面板（手机上能直接发微信），
 * 不支持就退回复制到剪贴板。
 *
 * **不要再传 `text`。** 同时给 `text` 和 `url` 时，很多分享目标只取 `text`
 * 就把 `url` 丢了 —— 系统面板里的「拷贝」尤其明显：复制出来是一句
 * 「来玩阿瓦隆 · 某某房」，链接根本不在里面，粘出去谁也进不来。
 * 房间名挪进 `title`，让 `url` 单独当主体，各个目标才都拿得到链接。
 */
export const shareInvite = async (roomId: string, roomName: string): Promise<ShareResult> => {
  const url = inviteUrl(roomId);
  const data = { title: `阿瓦隆 · ${roomName}`, url };

  if (navigator.share && (navigator.canShare?.(data) ?? true)) {
    try {
      await navigator.share(data);
      return "shared";
    } catch (e) {
      // 用户自己点了取消不算失败，别再退回复制、也别弹错
      if (e instanceof Error && e.name === "AbortError") return "cancelled";
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    // clipboard API 要安全上下文。局域网上用 http 直连 IP 调试时走这条老路子
    return legacyCopy(url) ? "copied" : "failed";
  }
};

/**
 * 分享 + 提示，一步到位。房间等待页和对局中都用它，两处反馈保持一致。
 *
 * `shared` 系统面板自己有反馈，`cancelled` 是用户自己收的手 —— 都不再弹。
 */
export const shareRoom = async (
  roomId: string,
  roomName: string,
  toast: (text: string, tone?: "info" | "error") => void,
): Promise<void> => {
  const result = await shareInvite(roomId, roomName);
  if (result === "copied") toast("邀请链接已复制，发给他们就行");
  else if (result === "failed") toast(`复制不了，把房间码 ${roomId} 报给他们`, "error");
};

const legacyCopy = (text: string): boolean => {
  const ta = document.createElement("textarea");
  ta.value = text;
  // 放在视口外，别让页面跳一下
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    ta.remove();
  }
};
