/**
 * 快照还原。这里要防的是**跨版本**的坑：
 * 快照是上个版本写的，新加的设置项在里面根本不存在。
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@avalon/shared";
import { gameSettingsSchema } from "@avalon/shared/schemas";
import { fromSnapshot, type RoomSnapshot } from "./store.js";

/** 一份「上个版本」写下的快照：settings 里没有后来新增的开关 */
const legacySnapshot = (): RoomSnapshot => {
  const { evilKnowRoles: _drop, ...legacySettings } = DEFAULT_SETTINGS;
  return {
    id: "123456",
    name: "老房间",
    visibility: "PUBLIC",
    allowSpectators: true,
    hostId: "p0",
    players: [],
    seatCount: 5,
    seats: [null, null, null, null, null],
    settings: legacySettings as RoomSnapshot["settings"],
    game: null,
    createdAt: 1,
    updatedAt: 2,
    ownerIp: "1.2.3.4",
  };
};

describe("fromSnapshot", () => {
  it("补上快照里没有的设置项", () => {
    const room = fromSnapshot(legacySnapshot());
    // 断言「补成了默认值」而不是某个具体的 true/false ——
    // 默认值本来就会改，这条测的是「补没补」，不是那一档开关怎么设
    expect(room.settings.evilKnowRoles).toBe(DEFAULT_SETTINGS.evilKnowRoles);
  });

  /**
   * 这条才是真正要防的事故。
   *
   * 少一个键不会当场报错，坏在后面：房主随手改个别的设置，客户端把整份
   * settings 发回来，那个 undefined 被 JSON.stringify 丢掉，Zod 的
   * z.boolean() 拒掉**整个** payload —— 表现是「改设置没反应」，
   * 而且只在跨版本存活的房间里出现。
   */
  it("还原出来的设置能过 Zod —— 不然房主改任何设置都会被拒", () => {
    const legacy = legacySnapshot();
    // 先证明这份快照原样发回去确实过不了，别让下面那句变成空跑
    expect(gameSettingsSchema.safeParse(legacy.settings).success).toBe(false);
    expect(gameSettingsSchema.safeParse(fromSnapshot(legacy).settings).success).toBe(true);
  });

  it("快照里有的值不会被默认值盖掉", () => {
    const snap = legacySnapshot();
    const room = fromSnapshot({
      ...snap,
      settings: { ...snap.settings, mode: "LANCELOT", ladyOfTheLake: true },
    });
    expect(room.settings.mode).toBe("LANCELOT");
    expect(room.settings.ladyOfTheLake).toBe(true);
  });
});
