/**
 * 对局主界面。**竖屏单屏，不滚动**（CLAUDE.md 铁律 4）。
 *
 * 结构固定为四层：顶部进度条 / 环形座位 / 阶段提示 / 操作区。
 * 只有操作区随阶段变化，其余三层始终占据同样的高度 —— 这样切阶段时画面不会跳。
 * 放不下的东西一律进 Sheet。
 */

import { useEffect, useState } from "react";
import { ROLES, TEAM_SIZE, isProtectedRound, type ClientGameView } from "@avalon/shared";
import { SeatRing } from "../components/SeatRing.js";
import { RoleCard } from "../components/RoleCard.js";
import { Button, Sheet } from "../components/ui.js";
import { Report } from "./Report.js";
import { selfId, useStore } from "../store.js";

/** 顶部：5 轮任务进度 + 流局计数 */
const Progress = ({ game }: { game: ClientGameView }) => {
  const sizes = TEAM_SIZE[game.playerCount as 5] ?? [];
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2">
      <div className="flex gap-1.5">
        {sizes.map((size, round) => {
          const done = game.missions[round];
          const current = round === game.roundIndex && !done;
          return (
            <span
              key={round}
              className={`relative flex h-7 w-7 items-center justify-center rounded-full text-[0.7rem]
                ${done ? (done.success ? "bg-blue text-white" : "bg-red text-white") : ""}
                ${current ? "ring-2 ring-gold text-gold" : ""}
                ${!done && !current ? "bg-surface-2 text-ink-mute" : ""}`}
            >
              {size}
              {isProtectedRound(game.playerCount as 5, round) ? (
                <span className="absolute -top-1 -right-1 text-[0.55rem]">🛡</span>
              ) : null}
            </span>
          );
        })}
      </div>

      <div className="flex items-center gap-1">
        <span className="text-[0.65rem] text-ink-mute">流局</span>
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={`h-2 w-2 rounded-full ${
              i < game.rejectStreak ? "bg-red" : "bg-surface-2"
            }`}
          />
        ))}
      </div>
    </div>
  );
};

const PHASE_HINT: Record<string, string> = {
  ROLE_REVEAL: "查看身份，确认后开始",
  LOYALTY_FLIP: "翻开忠诚牌",
  TEAM_BUILD: "队长选择队员",
  VOTE: "全体投票",
  VOTE_RESULT: "投票结果",
  MISSION: "队员执行任务",
  MISSION_RESULT: "任务结算",
  LADY_OF_LAKE: "湖中女神查验",
  ASSASSINATION: "刺客选择刺杀目标",
};

export const Game = () => {
  const { state, act, emit } = useStore();
  const [picked, setPicked] = useState<number[]>([]);
  const [sheet, setSheet] = useState<"role" | "report" | null>(null);

  const game = state?.game ?? null;
  const phase = game?.phase;

  // 换阶段就清掉选择，避免上一阶段的选中态漏到下一阶段
  useEffect(() => setPicked([]), [phase, game?.attempt, game?.roundIndex]);

  if (!state || !game) return null;
  const { room } = state;
  const me = game.me;
  const isHost = room.hostId === selfId;

  // ── 各阶段的可选座位 ──
  const lady = game.lady;
  const selectable: number[] =
    phase === "TEAM_BUILD" && me?.isLeader
      ? room.seated.map((_, i) => i)
      : phase === "LADY_OF_LAKE" && lady && lady.holderSeat === me?.seat
        ? [...lady.validTargets]
        : phase === "ASSASSINATION" && me?.canAssassinate
          ? room.seated.map((_, i) => i).filter((i) => i !== me.seat)
          : [];

  const toggle = (seat: number) => {
    if (phase === "TEAM_BUILD") {
      setPicked((prev) =>
        prev.includes(seat)
          ? prev.filter((s) => s !== seat)
          : prev.length >= game.teamSize
            ? prev
            : [...prev, seat],
      );
    } else {
      setPicked([seat]);
    }
  };

  /** 中心提示：等谁 */
  const waitingText = (): string | null => {
    if (phase === "ROLE_REVEAL") return `${game.ackedSeats.length}/${game.playerCount} 已看牌`;
    if (phase === "VOTE") return `${game.votedSeats.length}/${game.playerCount} 已投票`;
    if (phase === "MISSION") return `${game.playedSeats.length}/${game.team?.length ?? 0} 已出牌`;
    if (phase === "VOTE_RESULT") {
      const last = game.proposals.at(-1);
      return last?.approved ? "队伍通过" : "队伍被否决";
    }
    if (phase === "MISSION_RESULT") {
      const last = game.missions.at(-1);
      if (!last) return null;
      return last.success
        ? `任务成功${last.failCount > 0 ? `（${last.failCount} 张失败牌，未达 ${last.failsRequired} 张）` : ""}`
        : `任务失败 · ${last.failCount} 张失败牌`;
    }
    if (phase === "LOYALTY_FLIP") {
      const flip = game.loyalty?.flips.at(-1);
      if (!flip) return null;
      if (flip.swapped === null) return "翻开了一张忠诚牌";
      return flip.swapped ? "阵营转换！" : "阵营不变";
    }
    return null;
  };

  return (
    <div className="flex h-full min-h-0 flex-col safe-top safe-bottom">
      <div className="shrink-0">
        <Progress game={game} />
      </div>

      <SeatRing
        seated={room.seated}
        game={game}
        selectable={selectable}
        selected={picked}
        onSelect={toggle}
      >
        {waitingText() ? (
          <p
            className={`text-lg font-medium ${
              phase === "MISSION_RESULT"
                ? game.missions.at(-1)?.success
                  ? "text-blue"
                  : "text-red"
                : ""
            }`}
          >
            {waitingText()}
          </p>
        ) : null}
      </SeatRing>

      <p className="shrink-0 px-4 py-1 text-center text-sm text-ink-soft">
        {PHASE_HINT[phase ?? ""] ?? ""}
        {phase === "TEAM_BUILD" ? ` · 需要 ${game.teamSize} 人` : ""}
      </p>

      {/* 操作区 —— 唯一随阶段变化的部分，固定在拇指可达区 */}
      <div className="shrink-0 space-y-2 px-4 pt-1">
        <Actions
          game={game}
          picked={picked}
          isHost={isHost}
          onAct={act}
          seatCount={room.seated.length}
        />

        <nav className="flex gap-2 pt-1">
          <Button tone="ghost" className="flex-1 text-xs" onClick={() => setSheet("role")}>
            身份卡
          </Button>
          <Button tone="ghost" className="flex-1 text-xs" onClick={() => setSheet("report")}>
            战报
          </Button>
          <Button tone="ghost" className="flex-1 text-xs" onClick={() => emit("room:leave")}>
            退出
          </Button>
        </nav>
      </div>

      <Sheet open={sheet === "role"} onOpenChange={(o) => setSheet(o ? "role" : null)} title="我的身份">
        <RoleCard game={game} seated={room.seated} />
      </Sheet>
      <Sheet open={sheet === "report"} onOpenChange={(o) => setSheet(o ? "report" : null)} title="战报">
        <Report game={game} seated={room.seated} />
      </Sheet>
    </div>
  );
};

/** 操作按钮区。无权限的按钮**直接不渲染**，而不是禁用 —— 少一份误触和困惑 */
const Actions = ({
  game,
  picked,
  isHost,
  onAct,
  seatCount,
}: {
  game: ClientGameView;
  picked: readonly number[];
  isHost: boolean;
  onAct: ReturnType<typeof useStore.getState>["act"];
  seatCount: number;
}) => {
  const me = game.me;
  const [direction, setDirection] = useState<"CW" | "CCW">("CW");

  const early =
    me?.canEarlyAssassinate && game.phase !== "ASSASSINATION" ? (
      <Button tone="red" className="w-full text-sm" onClick={() => onAct({ type: "EARLY_ASSASSINATE" })}>
        发起提前刺杀
      </Button>
    ) : null;

  switch (game.phase) {
    case "ROLE_REVEAL":
      return (
        <div className="space-y-2">
          {me && !game.ackedSeats.includes(me.seat) ? (
            <Button className="w-full" onClick={() => onAct({ type: "ACK_ROLE" })}>
              我已看牌
            </Button>
          ) : (
            <p className="py-3 text-center text-sm text-ink-mute">等其他人看牌</p>
          )}
          {isHost ? (
            <Button tone="ghost" className="w-full text-xs" onClick={() => onAct({ type: "ADVANCE" })}>
              强制开始（跳过未确认的人）
            </Button>
          ) : null}
        </div>
      );

    case "TEAM_BUILD":
      if (!me?.isLeader) {
        return (
          <div className="space-y-2">
            <p className="py-3 text-center text-sm text-ink-mute">等队长选人</p>
            {early}
          </div>
        );
      }
      return (
        <div className="space-y-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDirection(direction === "CW" ? "CCW" : "CW")}
              className="min-h-12 shrink-0 rounded-xl border border-line px-3 text-xs text-ink-soft"
            >
              发言 {direction === "CW" ? "顺时针 ↻" : "逆时针 ↺"}
            </button>
            <Button
              className="flex-1"
              disabled={picked.length !== game.teamSize}
              onClick={() => onAct({ type: "PROPOSE_TEAM", team: [...picked], speakDirection: direction })}
            >
              确认队伍 ({picked.length}/{game.teamSize})
            </Button>
          </div>
          {early}
        </div>
      );

    case "VOTE":
      if (!me || me.myVote !== null) {
        return <p className="py-3 text-center text-sm text-ink-mute">已投票，等其他人</p>;
      }
      return (
        <div className="flex gap-2">
          <Button tone="blue" className="flex-1" onClick={() => onAct({ type: "VOTE", approve: true })}>
            赞成
          </Button>
          <Button tone="red" className="flex-1" onClick={() => onAct({ type: "VOTE", approve: false })}>
            反对
          </Button>
        </div>
      );

    case "MISSION": {
      if (!me?.isOnTeam) {
        return (
          <div className="space-y-2">
            <p className="py-3 text-center text-sm text-ink-mute">等队员出牌</p>
            {early}
          </div>
        );
      }
      if (me.myCard !== null) {
        return <p className="py-3 text-center text-sm text-ink-mute">已出牌，等其他队员</p>;
      }
      const canSucceed = me.missionCardRule !== "FAIL_ONLY";
      const canFail = me.missionCardRule !== "SUCCESS_ONLY";
      return (
        <div className="flex gap-2">
          {canSucceed ? (
            <Button tone="blue" className="flex-1" onClick={() => onAct({ type: "PLAY_CARD", success: true })}>
              任务成功
            </Button>
          ) : null}
          {canFail ? (
            <Button tone="red" className="flex-1" onClick={() => onAct({ type: "PLAY_CARD", success: false })}>
              任务失败
            </Button>
          ) : null}
        </div>
      );
    }

    case "VOTE_RESULT":
    case "MISSION_RESULT":
    case "LOYALTY_FLIP":
      return isHost ? (
        <Button className="w-full" onClick={() => onAct({ type: "ADVANCE" })}>
          继续
        </Button>
      ) : (
        <p className="py-3 text-center text-sm text-ink-mute">等房主继续</p>
      );

    case "LADY_OF_LAKE":
      if (game.lady?.holderSeat !== me?.seat) {
        return <p className="py-3 text-center text-sm text-ink-mute">等湖中女神查验</p>;
      }
      return (
        <Button
          className="w-full"
          disabled={picked.length !== 1}
          onClick={() => onAct({ type: "LADY_CHECK", targetSeat: picked[0]! })}
        >
          查验这个人
        </Button>
      );

    case "ASSASSINATION": {
      if (!me?.canAssassinate) {
        return <p className="py-3 text-center text-sm text-ink-mute">刺客正在选择目标</p>;
      }
      const target = picked[0];
      // 已知队友做灰度提示，但不禁用 —— 兰斯洛特模式下队友可能已经变成蓝方了
      const knownAlly = target !== undefined && me.vision.evilSeats.includes(target);
      return (
        <div className="space-y-1">
          {knownAlly ? (
            <p className="text-center text-xs text-red">这是你已知的红方队友，确定吗？</p>
          ) : null}
          <Button
            tone="red"
            className="w-full"
            disabled={target === undefined || seatCount === 0}
            onClick={() => onAct({ type: "ASSASSINATE", targetSeat: target! })}
          >
            刺杀 {target !== undefined ? `${target + 1} 号` : ""}
          </Button>
        </div>
      );
    }

    default:
      return null;
  }
};

export const roleName = (id: keyof typeof ROLES): string => ROLES[id].name;
