/**
 * 头像的取材规则 —— 从 seed 决定 micah 能用哪些部件。
 *
 * 单独拎出来是为了能单测：`Avatar.tsx` 只负责把这里算出来的选项塞给 dicebear。
 * 纯函数、只吃 seed，同一个头像在任何一屏渲染出来都一样。
 */

import type { micah } from "@dicebear/collection";

/** 肤色档位。micah 自带浅/中/深三档，这里只用浅、中两档 */
export const BASE_COLORS = ["f9c9b6", "ac6651"];

/**
 * 从 seed 定男女。
 *
 * micah 本身没有性别概念，耳环、睫毛、胡子各自独立随机 ——
 * 于是会掉出「有睫毛还留胡子」「男生戴圈耳环」这种组合。
 * 先用 seed 定死一个性别，再按性别裁掉不搭的部件。
 *
 * FNV-1a，不是为了散列质量，是为了**跨端一致且永远不变** ——
 * 换成别的算法，所有人的头像会在下一次部署时集体变脸。
 */
export const isMasculine = (seed: string): boolean => {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 2 === 0;
};

/** 传给 `createAvatar` 的部件约束。背景色和尺寸不在这儿，那是渲染方的事 */
export const avatarOptions = (
  seed: string,
): Pick<
  micah.Options,
  "baseColor" | "eyebrows" | "earringsProbability" | "facialHairProbability"
> => ({
  baseColor: BASE_COLORS,
  ...(isMasculine(seed)
    ? {
        // 男生不戴耳环。概率归零，dicebear 整个不画这一层
        earringsProbability: 0,
        eyebrows: ["up", "down"],
      }
    : {
        earringsProbability: 45,
        eyebrows: ["eyelashesUp", "eyelashesDown"],
        // 睫毛配大胡子太出戏
        facialHairProbability: 0,
      }),
});
