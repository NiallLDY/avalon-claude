/**
 * 角色卡画风注册表。见 PLAN.md §9.2。
 *
 * 加一套新画风的完整步骤：
 *   1. 写 scripts/art/styles/<id>.json
 *   2. python3 scripts/art/gen-art.py <id> && python3 scripts/art/optimize-art.py <id>
 *   3. 在下面数组里加一项
 * 组件代码一行都不用改 —— 图片路径全部由 roleArtUrl() 拼出来。
 */

import { ROLES, type RoleId } from "./roles.js";

export interface ArtStyle {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

export const ART_STYLES = [
  {
    id: "painterly",
    name: "油画立绘",
    description: "厚涂半身像，暗色调，正统中世纪奇幻",
  },
] as const satisfies readonly ArtStyle[];

export type ArtStyleId = (typeof ART_STYLES)[number]["id"];

export const DEFAULT_ART_STYLE: ArtStyleId = "painterly";

/**
 * 角色卡图片地址。画风是纯前端的个人偏好（存 localStorage），
 * 不进房间状态，也不影响服务端。
 */
export const roleArtUrl = (styleId: ArtStyleId, roleId: RoleId): string =>
  `/art/roles/${styleId}/${ROLES[roleId].artId}.webp`;

export const isArtStyleId = (v: string): v is ArtStyleId =>
  ART_STYLES.some((s) => s.id === v);
