/**
 * 房间逻辑测试。时间靠注入的 `now` 推进，不用 sleep。
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Avatar } from "@avalon/shared";
import { config } from "./config.js";
import {
  applyAction,
  createRoom,
  isInGame,
  joinRoom,
  kick,
  leaveRoom,
  markDisconnected,
  maybeTransferHost,
  reorderSeats,
  roomView,
  seatOf,
  setSettings,
  sit,
  stand,
  startBlockedReason,
  startGame,
  stateFor,
  transferHost,
  type Room,
} from "./rooms.js";

const AVATAR: Avatar = { seed: "x", bg: "112233" };
const T0 = 1_700_000_000_000;

const room = (): Room =>
  createRoom({
    name: "测试房",
    visibility: "PUBLIC",
    allowSpectators: true,
    hostId: "p0",
    ownerIp: "1.2.3.4",
    now: T0,
    existingIds: new Set(),
  });

/** 拉 n 个人进房并全部落座 */
const seated = (n: number): Room => {
  const r = room();
  for (let i = 0; i < n; i++) {
    joinRoom(r, { id: `p${i}`, token: `t${i}`, nick: `玩家${i}`, avatar: AVATAR }, T0);
    sit(r, `p${i}`, T0);
  }
  return r;
};

describe("入座与离座", () => {
  it("入座按顺序排进环形座次，索引即引擎座位号", () => {
    const r = seated(3);
    expect(r.seats).toEqual(["p0", "p1", "p2"]);
    expect(seatOf(r, "p1")).toBe(1);
  });

  it("不能重复入座", () => {
    const r = seated(1);
    expect(sit(r, "p0", T0)).toMatchObject({ ok: false, error: "ALREADY_SEATED" });
  });

  it("满 10 人后不能再入座", () => {
    const r = seated(10);
    joinRoom(r, { id: "p10", token: "t", nick: "迟到", avatar: AVATAR }, T0);
    expect(sit(r, "p10", T0)).toMatchObject({ ok: false, error: "ROOM_FULL" });
  });

  it("起立后座位号会整体前移", () => {
    const r = seated(3);
    stand(r, "p0", T0);
    expect(r.seats).toEqual(["p1", "p2"]);
    expect(seatOf(r, "p2")).toBe(1);
  });

  it("对局中不能入座或起立", () => {
    const r = seated(5);
    startGame(r, "p0", T0);
    expect(sit(r, "p0", T0)).toMatchObject({ ok: false, error: "ROOM_IN_GAME" });
    expect(stand(r, "p1", T0)).toMatchObject({ ok: false, error: "ROOM_IN_GAME" });
  });
});

describe("掉线与重连", () => {
  it("对局中掉线不释放座位", () => {
    const r = seated(5);
    startGame(r, "p0", T0);
    markDisconnected(r, "p3", T0);
    expect(r.seats).toContain("p3");
    expect(seatOf(r, "p3")).toBe(3);
    expect(r.players.get("p3")!.connected).toBe(false);
  });

  it("重连恢复原座位与房主身份", () => {
    const r = seated(5);
    startGame(r, "p0", T0);
    markDisconnected(r, "p0", T0);
    joinRoom(r, { id: "p0", token: "t0", nick: "房主", avatar: AVATAR }, T0 + 1000);
    expect(seatOf(r, "p0")).toBe(0);
    expect(r.hostId).toBe("p0");
    expect(r.hostOfflineSince).toBeNull();
  });

  it("未开局的观战者掉线直接清出，免得列表越积越长", () => {
    const r = seated(2);
    joinRoom(r, { id: "spec", token: "t", nick: "围观", avatar: AVATAR }, T0);
    markDisconnected(r, "spec", T0);
    expect(r.players.has("spec")).toBe(false);
  });

  it("对局中「离开」只当掉线处理 —— 真移走座位会让后面所有人的座位号整体前移", () => {
    const r = seated(5);
    startGame(r, "p0", T0);
    leaveRoom(r, "p3", T0);
    expect(r.seats).toEqual(["p0", "p1", "p2", "p3", "p4"]);
    expect(r.players.get("p3")!.connected).toBe(false);
  });
});

describe("房主自动移交", () => {
  const AFTER = config.hostTransferAfterMs;

  it("房主掉线不足 60 秒不移交", () => {
    const r = seated(5);
    markDisconnected(r, "p0", T0);
    expect(maybeTransferHost(r, T0 + AFTER - 1)).toBeNull();
    expect(r.hostId).toBe("p0");
  });

  it("超时后移交给座位号最小的在线玩家", () => {
    const r = seated(5);
    markDisconnected(r, "p0", T0);
    markDisconnected(r, "p1", T0); // p1 也掉线了，应该跳过他
    expect(maybeTransferHost(r, T0 + AFTER)).toBe("p2");
    expect(r.hostId).toBe("p2");
  });

  it("原房主回来不自动收回 —— 免得房主反复闪断把控制权抖来抖去", () => {
    const r = seated(5);
    markDisconnected(r, "p0", T0);
    expect(maybeTransferHost(r, T0 + AFTER)).toBe("p1");

    joinRoom(r, { id: "p0", token: "t0", nick: "前房主", avatar: AVATAR }, T0 + AFTER + 1);
    expect(r.hostId).toBe("p1");
    // 再怎么等也不会还回去
    expect(maybeTransferHost(r, T0 + AFTER * 10)).toBeNull();
    expect(r.hostId).toBe("p1");
  });

  it("房主回来得够快就不会被移交", () => {
    const r = seated(5);
    markDisconnected(r, "p0", T0);
    joinRoom(r, { id: "p0", token: "t0", nick: "房主", avatar: AVATAR }, T0 + 1000);
    expect(maybeTransferHost(r, T0 + AFTER * 10)).toBeNull();
    expect(r.hostId).toBe("p0");
  });

  it("没人在线就不移交，等 GC 收掉整个房间", () => {
    const r = seated(3);
    for (const id of ["p0", "p1", "p2"]) markDisconnected(r, id, T0);
    expect(maybeTransferHost(r, T0 + AFTER)).toBeNull();
  });
});

describe("座次调整", () => {
  it("新顺序必须是当前落座者的一个排列", () => {
    const r = seated(5);
    expect(reorderSeats(r, ["p4", "p3", "p2", "p1", "p0"], T0).ok).toBe(true);
    expect(r.seats).toEqual(["p4", "p3", "p2", "p1", "p0"]);
  });

  it("不能借调座位之名塞人、踢人或复制人", () => {
    const r = seated(5);
    expect(reorderSeats(r, ["p0", "p1", "p2", "p3"], T0).ok).toBe(false);
    expect(reorderSeats(r, ["p0", "p1", "p2", "p3", "外人"], T0).ok).toBe(false);
    expect(reorderSeats(r, ["p0", "p0", "p1", "p2", "p3"], T0).ok).toBe(false);
    expect(r.seats).toEqual(["p0", "p1", "p2", "p3", "p4"]);
  });
});

describe("开局条件", () => {
  it("不足 5 人不能开", () => {
    const r = seated(4);
    expect(startBlockedReason(r)).toContain("还差 1 人");
    expect(startGame(r, "p0", T0).ok).toBe(false);
  });

  it("兰斯洛特模式至少 7 人", () => {
    const r = seated(6);
    setSettings(r, "p0", { ...DEFAULT_SETTINGS, mode: "LANCELOT" }, T0);
    expect(startBlockedReason(r)).toContain("兰斯洛特");
    expect(startGame(r, "p0", T0).ok).toBe(false);
  });

  it("有人掉线时不给开局", () => {
    const r = seated(5);
    markDisconnected(r, "p2", T0);
    expect(startBlockedReason(r)).toContain("掉线");
  });

  it("只有房主能开局、改设置、踢人", () => {
    const r = seated(5);
    expect(startGame(r, "p1", T0)).toMatchObject({ ok: false, error: "NOT_HOST" });
    expect(setSettings(r, "p1", DEFAULT_SETTINGS, T0)).toMatchObject({ ok: false, error: "NOT_HOST" });
    expect(kick(r, "p1", "p2", T0)).toMatchObject({ ok: false, error: "NOT_HOST" });
  });

  it("开局后房间进入对局状态", () => {
    const r = seated(7);
    expect(startGame(r, "p0", T0).ok).toBe(true);
    expect(isInGame(r)).toBe(true);
    expect(r.game!.playerCount).toBe(7);
    expect(r.game!.phase).toBe("ROLE_REVEAL");
  });
});

describe("动作接入引擎", () => {
  it("座位号由服务端填 —— 客户端 payload 里根本没有这个字段", () => {
    const r = seated(5);
    startGame(r, "p0", T0);
    const res = applyAction(r, "p3", { type: "ACK_ROLE" }, T0);
    expect(res.ok).toBe(true);
    // p3 坐在 3 号位，引擎应当只把 3 号位标记为已看牌
    expect(r.game!.roleAcked).toEqual([false, false, false, true, false]);
  });

  it("不在座的人发不了对局动作", () => {
    const r = seated(5);
    joinRoom(r, { id: "spec", token: "t", nick: "围观", avatar: AVATAR }, T0);
    startGame(r, "p0", T0);
    expect(applyAction(r, "spec", { type: "ACK_ROLE" }, T0)).toMatchObject({
      ok: false, error: "NOT_SEATED",
    });
  });

  it("引擎拒绝的动作原样回传 error code，房间状态不变", () => {
    const r = seated(5);
    startGame(r, "p0", T0);
    applyAction(r, "p3", { type: "ACK_ROLE" }, T0);
    const again = applyAction(r, "p3", { type: "ACK_ROLE" }, T0);
    expect(again).toMatchObject({ ok: true });
    if (again.ok) expect(again.value).toMatchObject({ ok: false, error: "ALREADY_ACTED" });
  });

  it("只有房主发的 ADVANCE 才带 byHost", () => {
    const r = seated(5);
    startGame(r, "p0", T0);
    // 非房主强推发牌阶段应被引擎拒绝
    const byGuest = applyAction(r, "p1", { type: "ADVANCE" }, T0);
    expect(byGuest.ok && !byGuest.value.ok && byGuest.value.error).toBe("NOT_YOUR_TURN");
    const byHost = applyAction(r, "p0", { type: "ADVANCE" }, T0);
    expect(byHost.ok && byHost.value.ok).toBe(true);
    expect(r.game!.phase).toBe("TEAM_BUILD");
  });
});

describe("下发视图", () => {
  it("在座玩家拿到自己的身份，观战者什么都拿不到", () => {
    const r = seated(5);
    joinRoom(r, { id: "spec", token: "t", nick: "围观", avatar: AVATAR }, T0);
    startGame(r, "p0", T0);

    const mine = stateFor(r, "p2");
    expect(mine.game!.me!.seat).toBe(2);
    expect(mine.game!.me!.roleId).toBe(r.game!.roles[2]);

    const spectator = stateFor(r, "spec");
    expect(spectator.game!.me).toBeNull();
    expect(JSON.stringify(spectator.game)).not.toContain("MERLIN");
  });

  it("房间视图里有座次、观战者、能否开局", () => {
    const r = seated(5);
    joinRoom(r, { id: "spec", token: "t", nick: "围观", avatar: AVATAR }, T0);
    const view = roomView(r);
    expect(view.seated.map((p) => p.seat)).toEqual([0, 1, 2, 3, 4]);
    expect(view.spectators.map((p) => p.id)).toEqual(["spec"]);
    expect(view.seated[0]!.isHost).toBe(true);
    expect(view.canStart).toBe(true);
  });

  it("房间视图里不含 token 与 IP", () => {
    const r = seated(5);
    const json = JSON.stringify(roomView(r));
    expect(json).not.toContain("t0");
    expect(json).not.toContain("1.2.3.4");
  });
});

describe("踢人与移交", () => {
  it("房主不能踢自己", () => {
    const r = seated(5);
    expect(kick(r, "p0", "p0", T0).ok).toBe(false);
  });

  it("对局中不能踢在座玩家", () => {
    const r = seated(5);
    startGame(r, "p0", T0);
    expect(kick(r, "p0", "p2", T0)).toMatchObject({ ok: false, error: "ROOM_IN_GAME" });
  });

  it("手动移交房主立即生效", () => {
    const r = seated(5);
    expect(transferHost(r, "p0", "p3", T0).ok).toBe(true);
    expect(r.hostId).toBe("p3");
  });

  it("房主主动离开时房主顺延给在线的人", () => {
    const r = seated(5);
    leaveRoom(r, "p0", T0);
    expect(r.hostId).toBe("p1");
    expect(r.seats).toEqual(["p1", "p2", "p3", "p4"]);
  });
});
