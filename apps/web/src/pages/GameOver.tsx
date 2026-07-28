/**
 * 终局页。揭晓全员身份 + 战报 + 再来一局。
 */

import { useState } from "react";
import { ROLES, type ClientGameView } from "@avalon/shared";
import { SeatBoard } from "../components/SeatBoard.js";
import { Button, Sheet } from "../components/ui.js";
import { Report } from "./Report.js";
import { labeler } from "../lib/labels.js";
import { selfId, useStore } from "../store.js";

const REASON: Record<string, string> = {
  MISSIONS_SUCCEEDED: "三次任务成功，且梅林未被刺中",
  MISSIONS_FAILED: "三次任务失败",
  REJECT_LIMIT: "连续五次流局",
  ASSASSINATION_HIT: "刺客命中梅林",
  ASSASSINATION_MISS: "提前刺杀落空，红方判负",
};

export const GameOver = ({ game }: { game: ClientGameView }) => {
  const { state, leaveFinished, leaveRoom } = useStore();
  const [reportOpen, setReportOpen] = useState(false);
  if (!state?.room) return null;

  const { room } = state;
  const outcome = game.outcome!;
  // 观战者没资格重开 —— 桌上打牌的人才决定还打不打
  const seated = room.seats.some((p) => p?.id === selfId);
  const blueWon = outcome.winner === "BLUE";
  const myRole = game.me ? ROLES[game.me.roleId] : null;
  // 兰斯洛特可能中途换过阵营，以终局时的阵营算胜负
  const iWon = game.me ? game.me.side === outcome.winner : null;

  return (
    <div className="flex h-full min-h-0 flex-col safe-top safe-bottom">
      <header className="shrink-0 px-4 pt-3 text-center">
        <p
          className={`font-display text-3xl tracking-widest ${blueWon ? "text-blue" : "text-red"}`}
        >
          {blueWon ? "正义获胜" : "邪恶获胜"}
        </p>
        <p className="mt-1 text-xs text-ink-mute">{REASON[outcome.reason] ?? ""}</p>
        {outcome.assassinatedSeat !== null ? (
          <p className="mt-0.5 text-xs text-ink-mute">
            刺客选择了 {labeler(room.seats).full(outcome.assassinatedSeat)}
          </p>
        ) : null}
      </header>

      <SeatBoard seats={room.seats} game={game} selfSeat={game.me?.seat ?? null}>
        {myRole ? (
          <div>
            <p className="text-xs text-ink-mute">{game.me!.seat + 1}号 · 你是</p>
            <p className={`text-xl ${myRole.side === "RED" ? "text-red" : "text-blue"}`}>
              {myRole.name}
            </p>
            {iWon !== null ? (
              <p className={`mt-1 text-sm ${iWon ? "text-gold" : "text-ink-mute"}`}>
                {iWon ? "你赢了" : "你输了"}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-ink-mute">观战结束</p>
        )}
      </SeatBoard>

      <div className="shrink-0 space-y-2 px-4 pt-1">
        <div className="flex gap-2">
          <Button tone="ghost" className="flex-1" onClick={() => setReportOpen(true)}>
            看战报
          </Button>
          {/*
            **谁都能点，不只是房主，而且各点各的。**
            点了自己回等待页 —— 别人还在看身份揭晓和战报的不会被一起拽走
            （终局画面在 store 里留了一份，见 finishedGame）。
            回的是等待页不是新一局：座位和设置都留着，大家重新准备，房主再开。
            打完一局总有人要去倒水，准备那一步就是用来等他们的。
          */}
          {seated ? (
            <Button className="flex-[2]" onClick={leaveFinished}>
              再来一局
            </Button>
          ) : (
            <div className="flex-[2] self-center text-center text-sm text-ink-mute">
              等他们开下一局
            </div>
          )}
        </div>
        <Button tone="ghost" className="w-full text-xs" onClick={leaveRoom}>
          退出房间
        </Button>
      </div>

      <Sheet open={reportOpen} onOpenChange={setReportOpen} title="战报">
        <Report game={game} seated={room.seats} />
      </Sheet>
    </div>
  );
};
