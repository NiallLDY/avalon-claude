/**
 * 陪玩机器人。**开发/试玩工具，不属于应用本身。**
 *
 * 一个人想在手机上试完整流程时，对局要 5–10 个人 —— 这个脚本把剩下的座位填上。
 * 机器人只做最笨的决策（一律赞成、能出成功就出成功），目的是让流程跑起来，不是当对手。
 *
 *   node scripts/bots.mjs <房间码> [数量] [--url http://127.0.0.1:8787]
 */

import { io } from "socket.io-client";
import { randomUUID, randomBytes } from "node:crypto";

const args = process.argv.slice(2);
const roomId = args[0]?.toUpperCase();
const count = Number(args[1] ?? 4);
const urlFlag = args.indexOf("--url");
const BASE = urlFlag >= 0 ? args[urlFlag + 1] : "http://127.0.0.1:8787";

if (!roomId || !/^[A-HJ-NP-Z2-9]{6}$/.test(roomId)) {
  console.error("用法: node scripts/bots.mjs <房间码> [数量] [--url http://host:port]");
  process.exit(1);
}

const NAMES = ["机器人甲", "机器人乙", "机器人丙", "机器人丁", "机器人戊", "机器人己", "机器人庚", "机器人辛", "机器人壬"];
const BG = ["2a3145", "3b4a6b", "4a3a5e", "5e3a3a", "3a5e4a", "5e523a", "3a4f5e", "50395e", "5e4433"];

/** 随机挑一个，避免每个机器人都做一样的选择 */
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const makeBot = (index) => {
  const nick = NAMES[index % NAMES.length];
  const socket = io(BASE, {
    path: "/ws",
    transports: ["websocket"],
    auth: {
      playerId: randomUUID(),
      token: randomBytes(16).toString("hex"),
      profile: { nick, avatar: { seed: randomBytes(4).toString("hex"), bg: BG[index % BG.length] } },
    },
  });

  // 同一个阶段只动一次，否则服务端会一直回 ALREADY_ACTED
  let lastKey = "";

  socket.on("connect", () => {
    console.log(`[${nick}] 已连接`);
    socket.emit("room:join", { roomId });
  });

  socket.on("error", ({ code }) => {
    // ALREADY_ACTED / NOT_YOUR_TURN 是正常的竞态，不用刷屏
    if (!["ALREADY_ACTED", "NOT_YOUR_TURN", "WRONG_PHASE"].includes(code)) {
      console.log(`[${nick}] 服务端拒绝: ${code}`);
    }
  });

  socket.on("state", ({ room, game }) => {
    if (!game) return;
    const me = game.me;
    if (!me) return;

    // 阶段 + 轮次 + 提名次数 唯一确定「现在该做什么」，用它去重
    const key = `${game.phase}/${game.roundIndex}/${game.attempt}/${game.missions.length}`;
    if (key === lastKey) return;

    const act = (action, delayMs = 300 + Math.random() * 700) => {
      lastKey = key;
      // 加点延迟，让人在手机上看得到过程，不然一瞬间就跳完了
      setTimeout(() => socket.emit("game:action", { action }), delayMs);
    };

    switch (game.phase) {
      case "ROLE_REVEAL":
        if (!game.ackedSeats.includes(me.seat)) act({ type: "ACK_ROLE" });
        break;

      case "TEAM_BUILD": {
        if (!me.isLeader) break;
        // 随便选够人数，但优先带上自己
        const seats = Array.from({ length: game.playerCount }, (_, i) => i)
          .sort((a) => (a === me.seat ? -1 : Math.random() - 0.5))
          .slice(0, game.teamSize);
        act({ type: "PROPOSE_TEAM", team: seats, speakDirection: "CW" }, 900);
        break;
      }

      case "VOTE":
        if (me.myVote === null) act({ type: "VOTE", approve: true });
        break;

      case "MISSION":
        if (me.isOnTeam && me.myCard === null) {
          // 只能出什么就出什么；能选的时候一律出成功，让流程往前走
          act({ type: "PLAY_CARD", success: me.missionCardRule !== "FAIL_ONLY" });
        }
        break;

      case "LADY_OF_LAKE":
        if (game.lady?.holderSeat === me.seat && game.lady.validTargets.length > 0) {
          act({ type: "LADY_CHECK", targetSeat: pick(game.lady.validTargets) }, 900);
        }
        break;

      case "ASSASSINATION":
        if (me.canAssassinate) {
          const targets = Array.from({ length: game.playerCount }, (_, i) => i).filter(
            (i) => i !== me.seat,
          );
          act({ type: "ASSASSINATE", targetSeat: pick(targets) }, 1500);
        }
        break;

      case "VOTE_RESULT":
      case "MISSION_RESULT":
      case "LOYALTY_FLIP":
        // 推进交给房主（也就是你）。机器人只在没有真人房主时兜底
        if (room.hostId === me.seat) act({ type: "ADVANCE" }, 1200);
        break;

      default:
        break;
    }
  });

  return socket;
};

console.log(`往房间 ${roomId} 放 ${count} 个机器人（${BASE}）`);
const bots = Array.from({ length: count }, (_, i) => makeBot(i));

const bye = () => {
  for (const b of bots) b.close();
  process.exit(0);
};
process.on("SIGINT", bye);
process.on("SIGTERM", bye);
