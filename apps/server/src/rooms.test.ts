/**
 * 房间逻辑测试。时间靠注入的 `now` 推进，不用 sleep。
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Avatar } from "@avalon/shared";
import { config } from "./config.js";
import {
  abortGame,
  applyAction,
  canReact,
  createRoom,
  isInGame,
  joinRoom,
  kick,
  leaveRoom,
  markDisconnected,
  maybeTransferHost,
  reopenRoom,
  requestSwap,
  respondSwap,
  setReady,
  setSeatCount,
  occupants,
  emptySeats,
  roomView,
  seatOf,
  setSettings,
  shuffleSeats,
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

/** 拉 n 个人进房、坐满 n 个位子。`ready` 决定是否顺便全部准备 */
const seated = (n: number, ready = true): Room => {
  const r = room();
  setSeatCount(r, "p0", n, T0);
  for (let i = 0; i < n; i++) {
    joinRoom(r, { id: `p${i}`, token: `t${i}`, nick: `玩家${i}`, avatar: AVATAR }, T0);
    sit(r, `p${i}`, i, T0);
  }
  if (ready) for (let i = 0; i < n; i++) setReady(r, `p${i}`, true, T0);
  return r;
};

describe("入座与离座", () => {
  it("坐到哪个位子由自己挑，不是按点击先后分配", () => {
    const r = room();
    setSeatCount(r, "p0", 5, T0);
    for (const id of ["a", "b"]) {
      joinRoom(r, { id, token: "t", nick: id, avatar: AVATAR }, T0);
    }
    expect(sit(r, "a", 3, T0).ok).toBe(true);
    expect(sit(r, "b", 0, T0).ok).toBe(true);
    expect(seatOf(r, "a")).toBe(3);
    expect(seatOf(r, "b")).toBe(0);
    expect(emptySeats(r)).toEqual([1, 2, 4]);
  });

  it("有人的位子坐不进去", () => {
    const r = seated(5);
    joinRoom(r, { id: "late", token: "t", nick: "迟到", avatar: AVATAR }, T0);
    expect(sit(r, "late", 2, T0).ok).toBe(false);
  });

  it("越界的位子坐不进去", () => {
    const r = seated(5);
    joinRoom(r, { id: "x", token: "t", nick: "x", avatar: AVATAR }, T0);
    for (const bad of [-1, 5, 99, 1.5]) {
      expect(sit(r, "x", bad, T0), String(bad)).toMatchObject({ ok: false });
    }
  });

  it("已入座的人点别的空位就是换位，不占两个", () => {
    const r = room();
    setSeatCount(r, "p0", 5, T0);
    joinRoom(r, { id: "a", token: "t", nick: "a", avatar: AVATAR }, T0);
    sit(r, "a", 1, T0);
    expect(sit(r, "a", 4, T0).ok).toBe(true);
    expect(occupants(r)).toEqual(["a"]);
    expect(seatOf(r, "a")).toBe(4);
  });

  it("起立后位子变回空位，别人的座位号不受影响", () => {
    const r = seated(5);
    stand(r, "p2", T0);
    expect(seatOf(r, "p2")).toBe(-1);
    expect(seatOf(r, "p3")).toBe(3);
    expect(emptySeats(r)).toEqual([2]);
  });

  it("对局中不能入座或起立", () => {
    const r = seated(5);
    startGame(r, "p0", T0);
    expect(sit(r, "p0", 1, T0)).toMatchObject({ ok: false, error: "ROOM_IN_GAME" });
    expect(stand(r, "p1", T0)).toMatchObject({ ok: false, error: "ROOM_IN_GAME" });
  });
});

describe("几人局", () => {
  it("只有房主能改，且限定 5–10", () => {
    const r = seated(5);
    expect(setSeatCount(r, "p1", 7, T0)).toMatchObject({ ok: false, error: "NOT_HOST" });
    for (const bad of [4, 11, 0]) {
      expect(setSeatCount(r, "p0", bad, T0), String(bad)).toMatchObject({ ok: false });
    }
    expect(setSeatCount(r, "p0", 7, T0).ok).toBe(true);
    expect(r.seatCount).toBe(7);
    expect(r.seats).toHaveLength(7);
  });

  it("缩小时多出来的人回等待区，不是被踢出房间", () => {
    const r = seated(7);
    expect(setSeatCount(r, "p0", 5, T0).ok).toBe(true);
    expect(occupants(r)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
    // 人还在房间里，只是没座位了
    expect(r.players.has("p5")).toBe(true);
    expect(seatOf(r, "p5")).toBe(-1);
  });

  it("改人数会清掉所有人的准备", () => {
    const r = seated(5);
    expect(startBlockedReason(r)).toBeNull();
    setSeatCount(r, "p0", 6, T0);
    expect(startBlockedReason(r)).toContain("空位");
  });
});

describe("准备", () => {
  it("全部准备之前开不了局", () => {
    const r = seated(5, false);
    expect(startBlockedReason(r)).toContain("没准备");
    expect(startGame(r, "p0", T0).ok).toBe(false);

    for (const id of ["p0", "p1", "p2", "p3", "p4"]) setReady(r, id, true, T0);
    expect(startBlockedReason(r)).toBeNull();
    expect(startGame(r, "p0", T0).ok).toBe(true);
  });

  it("没入座的人不用也不能准备", () => {
    const r = seated(5);
    joinRoom(r, { id: "wait", token: "t", nick: "等着", avatar: AVATAR }, T0);
    expect(setReady(r, "wait", true, T0)).toMatchObject({ ok: false, error: "NOT_SEATED" });
    expect(startBlockedReason(r)).toBeNull();
  });

  it("改规则会清掉准备 —— 别让人在不知情的情况下被开进新规则的局", () => {
    const r = seated(7);
    expect(startBlockedReason(r)).toBeNull();
    setSettings(r, "p0", { ...DEFAULT_SETTINGS, mode: "LANCELOT" }, T0);
    expect(startBlockedReason(r)).toContain("没准备");
  });

  it("起立只清自己的准备，别人的不动", () => {
    const r = seated(5);
    stand(r, "p4", T0);
    expect(r.players.get("p4")!.ready).toBe(false);
    for (const id of ["p0", "p1", "p2", "p3"]) {
      expect(r.players.get(id)!.ready).toBe(true);
    }
    // 他坐回来也得自己重新点一次
    sit(r, "p4", 4, T0);
    expect(startBlockedReason(r)).toContain("没准备");
  });

  it("别人换座不该把我的准备清掉", () => {
    const r = seated(5);
    requestSwap(r, "p1", "p2", T0);
    expect(respondSwap(r, "p2", true, T0).ok).toBe(true);

    // 1 号和 2 号对调了位置，我（3 号）什么都没变，凭什么要重点一次准备
    expect(seatOf(r, "p1")).toBe(2);
    expect(seatOf(r, "p2")).toBe(1);
    for (const id of ["p0", "p1", "p2", "p3", "p4"]) {
      expect(r.players.get(id)!.ready).toBe(true);
    }
    expect(startBlockedReason(r)).toBeNull();
  });

  it("打乱座次才清全场 —— 那是所有人都要起来挪凳子", () => {
    const r = seated(5);
    shuffleSeats(r, T0);
    expect(startBlockedReason(r)).toContain("没准备");
  });
});

describe("掉线与重连", () => {
  it("对局中掉线不释放座位", () => {
    const r = seated(5);
    startGame(r, "p0", T0);
    markDisconnected(r, "p3", T0);
    expect(occupants(r)).toContain("p3");
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

  it("刷新一下不该把准备弄没了", () => {
    const r = seated(5);
    expect(startBlockedReason(r)).toBeNull();

    // 刷新页面就是一次掉线重连；锁屏、切后台、换网也都是
    markDisconnected(r, "p2", T0);
    joinRoom(r, { id: "p2", token: "t2", nick: "玩家2", avatar: AVATAR }, T0 + 500);

    expect(r.players.get("p2")!.ready).toBe(true);
    expect(startBlockedReason(r)).toBeNull();
  });

  it("人还没回来时仍然开不了局 —— 拦他的是掉线检查，不是准备", () => {
    const r = seated(5);
    markDisconnected(r, "p2", T0);
    expect(startBlockedReason(r)).toContain("掉线");
    expect(startGame(r, "p0", T0).ok).toBe(false);
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
    expect(occupants(r)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
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

describe("开局条件", () => {
  it("有空位不能开", () => {
    const r = seated(5);
    stand(r, "p4", T0);
    expect(startBlockedReason(r)).toContain("空位");
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

describe("再来一局", () => {
  /** 推到终局。房间层只看 phase，不需要真把一局打完 */
  const finished = (n = 5): Room => {
    const r = seated(n);
    startGame(r, "p0", T0);
    r.game = { ...r.game!, phase: "GAME_OVER" };
    return r;
  };

  it("退回等待页而不是直接发牌，座位和设置都留着", () => {
    const r = finished();
    setSettings(r, "p0", { ...DEFAULT_SETTINGS, ladyOfTheLake: false }, T0);
    expect(reopenRoom(r, "p0", T0).ok).toBe(true);

    expect(r.game).toBeNull();
    expect(isInGame(r)).toBe(false);
    expect(occupants(r)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
    expect(r.hostId).toBe("p0");
    expect(r.settings.ladyOfTheLake).toBe(false);
  });

  it("准备清空，要重新确认一遍才能开", () => {
    const r = finished();
    expect(reopenRoom(r, "p0", T0).ok).toBe(true);

    expect(startBlockedReason(r)).toContain("没准备");
    for (let i = 0; i < 5; i++) setReady(r, `p${i}`, true, T0);
    expect(startBlockedReason(r)).toBeNull();
    expect(startGame(r, "p0", T0).ok).toBe(true);
  });

  it("任何在座玩家都能点，不只是房主", () => {
    const r = finished();
    // 一局刚打完谁都可能是第一个想继续的，卡在房主身上只会让全场干等
    expect(reopenRoom(r, "p3", T0).ok).toBe(true);
    expect(r.game).toBeNull();
  });

  it("观战者不能重开", () => {
    const r = finished();
    joinRoom(r, { id: "spec", token: "t", nick: "围观", avatar: AVATAR }, T0);
    expect(reopenRoom(r, "spec", T0)).toMatchObject({ ok: false, error: "NOT_SEATED" });
    expect(r.game).not.toBeNull();
  });

  it("对局进行中谁都不许把牌局掀了", () => {
    const r = seated(5);
    startGame(r, "p0", T0);
    expect(reopenRoom(r, "p0", T0)).toMatchObject({ ok: false, error: "ROOM_IN_GAME" });
    expect(r.game!.phase).toBe("ROLE_REVEAL");
  });

  it("重开不看 ready —— 中途掉过线的人也点得动", () => {
    const r = finished();
    markDisconnected(r, "p2", T0);
    joinRoom(r, { id: "p2", token: "t2", nick: "玩家2", avatar: AVATAR }, T0);

    expect(reopenRoom(r, "p2", T0).ok).toBe(true);
    expect(r.game).toBeNull();
    // 回到等待页之后大家重新点一次
    expect(startBlockedReason(r)).toContain("没准备");
  });
});

describe("献花砸蛋", () => {
  /** 推到组队阶段：开局 → 全员看牌 */
  const teamBuild = (): Room => {
    const r = seated(5);
    startGame(r, "p0", T0);
    for (let i = 0; i < 5; i++) applyAction(r, `p${i}`, { type: "ACK_ROLE" }, T0);
    return r;
  };

  it("组队阶段可以朝别人扔，座位号由服务端填", () => {
    const r = teamBuild();
    expect(r.game!.phase).toBe("TEAM_BUILD");
    const res = canReact(r, "p3", 1);
    expect(res).toMatchObject({ ok: true, value: 3 });
  });

  it("只在组队阶段开放 —— 投票和出牌时满屏鸡蛋会盖住要看的信息", () => {
    const r = seated(5);
    startGame(r, "p0", T0);
    expect(r.game!.phase).toBe("ROLE_REVEAL");
    expect(canReact(r, "p3", 1)).toMatchObject({ ok: false, error: "WRONG_PHASE" });
  });

  it("扔不到自己、空位和不存在的座位上", () => {
    const r = teamBuild();
    expect(canReact(r, "p3", 3)).toMatchObject({ ok: false, error: "INVALID_SEAT" });
    expect(canReact(r, "p3", 9)).toMatchObject({ ok: false, error: "INVALID_SEAT" });
  });

  it("观战者不能扔", () => {
    const r = teamBuild();
    joinRoom(r, { id: "spec", token: "t", nick: "围观", avatar: AVATAR }, T0);
    expect(canReact(r, "spec", 1)).toMatchObject({ ok: false, error: "NOT_SEATED" });
  });

  it("扔东西不碰任何对局状态", () => {
    const r = teamBuild();
    const before = JSON.stringify(r.game);
    canReact(r, "p3", 1);
    expect(JSON.stringify(r.game)).toBe(before);
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
    expect(view.seatCount).toBe(5);
    expect(view.seats.map((p) => p?.seat)).toEqual([0, 1, 2, 3, 4]);
    expect(view.standing.map((p) => p.id)).toEqual(["spec"]);
    expect(view.seats[0]!.isHost).toBe(true);
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
    expect(occupants(r)).toEqual(["p1", "p2", "p3", "p4"]);
  });
});

describe("中途终止", () => {
  it("只有房主能终止，且必须真的在对局中", () => {
    const r = seated(5);
    expect(abortGame(r, "p0", T0)).toMatchObject({ ok: false, error: "NOT_IN_GAME" });
    startGame(r, "p0", T0);
    expect(abortGame(r, "p1", T0)).toMatchObject({ ok: false, error: "NOT_HOST" });
    expect(abortGame(r, "p0", T0).ok).toBe(true);
  });

  it("终止后退回等待页：座位和设置留着，准备清空", () => {
    const r = seated(7);
    setSettings(r, "p0", { ...DEFAULT_SETTINGS, ladyOfTheLake: true }, T0);
    for (let i = 0; i < 7; i++) setReady(r, `p${i}`, true, T0);
    startGame(r, "p0", T0);

    abortGame(r, "p0", T0);
    expect(r.game).toBeNull();
    expect(occupants(r)).toHaveLength(7);
    expect(r.settings.ladyOfTheLake).toBe(true);
    // 重新准备一遍才能再开 —— 中途散了总有人要离桌
    expect(startBlockedReason(r)).toContain("没准备");
  });

  it("终止的局不该留下任何胜负 —— 没打完就没有结果可归档", () => {
    const r = seated(5);
    startGame(r, "p0", T0);
    abortGame(r, "p0", T0);
    expect(r.game).toBeNull();
  });
});
