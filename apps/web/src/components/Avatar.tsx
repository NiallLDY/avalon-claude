/**
 * 玩家头像。DiceBear `micah` —— 与 vue-color-avatar 同源美术
 * （"Avatar Illustration System" by Micah Lanier, CC BY 4.0）。
 *
 * SVG 在前端本地生成，零网络请求；服务端只存 seed 和背景色几十个字节。
 */

import { useMemo } from "react";
import { createAvatar } from "@dicebear/core";
import { micah } from "@dicebear/collection";
import type { Avatar as AvatarSpec } from "@avalon/shared";
import { avatarOptions } from "../lib/avatar.js";

interface Props {
  readonly avatar: AvatarSpec;
  readonly size?: number;
  readonly className?: string;
  readonly dim?: boolean;
}

export const Avatar = ({ avatar, size = 40, className = "", dim = false }: Props) => {
  const uri = useMemo(
    () =>
      createAvatar(micah, {
        seed: avatar.seed,
        backgroundColor: [avatar.bg],
        radius: 50,
        size: 128,
        ...avatarOptions(avatar.seed),
      }).toDataUri(),
    [avatar.seed, avatar.bg],
  );

  return (
    <img
      src={uri}
      alt=""
      width={size}
      height={size}
      draggable={false}
      className={`rounded-full bg-surface-2 transition-opacity ${dim ? "opacity-35" : ""} ${className}`}
      style={{ width: size, height: size }}
    />
  );
};
