/**
 * 对局主界面。**竖屏单屏，不滚动**（CLAUDE.md 铁律 4）。
 *
 * 结构固定为四层：顶部进度条 / 两列座位 / 阶段提示 / 操作区。
 * 只有操作区随阶段变化，其余三层始终占据同样的高度 —— 这样切阶段时画面不会跳。
 * 放不下的东西一律进 Sheet。
 */

import { useEffect, useState } from "react";
import {
  REJECT_LIMIT,
  ROLES,
  TEAM_SIZE,
  isProtectedRound,
  type ClientGameView,
  type RoomView,
} from "@avalon/shared";
import { PlayerChips } from "../components/PlayerChip.js";
import { ProfileButton } from "../components/Profile.js";
import { SeatBoard } from "../components/SeatBoard.js";
import { RoleCard } from "../components/RoleCard.js";
import { Button, Latency, Sheet } from "../components/ui.js";
import { Report } from "./Report.js";
import { labeler, seatNo } from "../lib/labels.js";
import { selfId, useStore } from "../store.js";

/** 顶部：5 轮任务进度 + 房间名/码 + 延迟 + 流局 + 我是几号 */
const Progress = ({ game, room }: { game: ClientGameView; room: RoomView }) => {
  const sizes = TEAM_SIZE[game.playerCount as 5] ?? [];
  return (
    // 左右两组固定宽度，中间那组吃掉剩余空间。每组都得 shrink-0 ——
    // 否则「你是1号」会换行，顶栏一高就把座位区挤下去了
    <div className="flex items-center justify-between gap-2 px-3 py-1.5">
      <div className="flex shrink-0 gap-1">
        {sizes.map((size, round) => {
          const done = game.missions[round];
          const current = round === game.roundIndex && !done;
          return (
            <span
              key={round}
              className={`relative flex h-6 w-6 items-center justify-center rounded-full text-[0.7rem]
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

      {/*
        房间名 + 房间码。对局中途要退出再回来全靠这个码，
        以前只藏在「离开这局？」的弹窗里，等你想退出时才看得到，太晚了。
      */}
      <div className="flex min-w-0 flex-1 flex-col items-center leading-none">
        {/*
          延迟挂在房名这行而不是房间码那行：房名可以被截，房间码不行 ——
          少一个字母的房间码是回不来的。流局标出现时中间这块会被压窄，
          能被牺牲的必须是房名。
        */}
        <span className="flex min-w-0 max-w-full items-center gap-1.5">
          <span className="min-w-0 truncate text-[0.62rem] text-ink-mute">{room.name}</span>
          <Latency />
        </span>
        <span className="mt-0.5 font-display text-[0.7rem] tracking-widest whitespace-nowrap text-gold">
          {room.id}
        </span>
      </div>

      {/*
        右边跟中间一样叠成两行。中间那列已经把这一行撑成两行高了，
        第二行是白捡的空间 —— 流局标放这儿就不跟房间名抢宽度。
      */}
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        {/*
          个人中心。原来这里是「你是 3 号」—— 座位区自己那格已经写着号码和「你」，
          顶栏再写一遍是白占位置；换成头像入口，进了房就没法改昵称头像的问题也一并解决。
        */}
        <ProfileButton />
        {game.me === null ? (
          <span className="rounded bg-surface-2 px-1 text-[0.6rem] leading-[0.95rem] whitespace-nowrap text-ink-mute">
            观战
          </span>
        ) : null}

        {/*
          流局。**0 次时整个不显示** —— 常驻 5 个空点是纯噪音，
          而连续 {REJECT_LIMIT} 次红方直接赢，所以一旦开始流局就必须看得见。
        */}
        {game.rejectStreak > 0 ? (
          <span className="rounded bg-red/20 px-1 text-[0.6rem] leading-[0.95rem] whitespace-nowrap text-red tabular-nums">
            流局 {game.rejectStreak}/{REJECT_LIMIT}
          </span>
        ) : null}
      </div>
    </div>
  );
};

/**
 * 「还在等谁」。计数下面直接把号码摊开：绿的动过了，灰的还没。
 *
 * 只有一个 `3/5 已投票` 的话，你知道还差两个，但不知道差**哪**两个 ——
 * 线下就得挨个问「你投了吗」。号码摊开就一眼看到该催谁。
 * 依然只说做没做，不说做了什么。
 */
const ActingStatus = ({ game }: { game: ClientGameView }) => {
  const all = Array.from({ length: game.playerCount }, (_, i) => i);
  const spec =
    game.phase === "ROLE_REVEAL"
      ? { label: "已看牌", seats: all, done: game.ackedSeats }
      : game.phase === "VOTE"
        ? { label: "已投票", seats: all, done: game.votedSeats }
        : { label: "已出牌", seats: [...(game.team ?? [])], done: game.playedSeats };

  return (
    <div>
      <p className="text-lg font-medium tabular-nums">
        {spec.done.length}/{spec.seats.length} {spec.label}
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-1">
        {spec.seats.map((seat) => {
          const done = spec.done.includes(seat);
          return (
            <span
              key={seat}
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[0.65rem]
                font-bold tabular-nums
                ${done ? "bg-green text-white" : "bg-surface-2 text-ink-mute ring-1 ring-line"}`}
            >
              {seat + 1}
            </span>
          );
        })}
      </div>
    </div>
  );
};

/** 从队长开始，按方向绕一圈的座位顺序。线下最常吵的就是「谁先说」 */
const speakOrder = (leaderSeat: number, total: number, dir: "CW" | "CCW"): number[] =>
  Array.from({ length: total }, (_, i) =>
    dir === "CW" ? (leaderSeat + i) % total : (leaderSeat - i + total * total) % total,
  );

const PHASE_HINT: Record<string, string> = {
  ROLE_REVEAL: "翻开身份卡就算确认",
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
  const { state, act, react, leaveRoom } = useStore();
  const [picked, setPicked] = useState<number[]>([]);
  const [sheet, setSheet] = useState<"role" | "report" | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  /** 正要朝谁扔东西。null = 没在扔 */
  const [reactTarget, setReactTarget] = useState<number | null>(null);

  const game = state?.game ?? null;
  const phase = game?.phase;

  // 换阶段就清掉选择，避免上一阶段的选中态漏到下一阶段
  useEffect(() => setPicked([]), [phase, game?.attempt, game?.roundIndex]);

  /*
   * 开局直接把身份卡怼到脸上，不用先去底部找「身份卡」按钮。
   * 只在还没看牌时弹一次：依赖里带上 needsRole，玩家自己关掉之后
   * 依赖没变，不会再弹回来跟他打架。
   */
  const needsRole =
    phase === "ROLE_REVEAL" && game?.me != null && !game.ackedSeats.includes(game.me.seat);
  useEffect(() => {
    if (needsRole) setSheet("role");
  }, [needsRole]);

  if (!state || !game) return null;
  const { room } = state;
  const me = game.me;
  const isHost = room.hostId === selfId;

  // ── 各阶段的可选座位 ──
  const lady = game.lady;
  const selectable: number[] =
    phase === "TEAM_BUILD" && me?.isLeader
      ? room.seats.map((_, i) => i)
      : phase === "LADY_OF_LAKE" && lady && lady.holderSeat === me?.seat
        ? [...lady.validTargets]
        : phase === "ASSASSINATION" && me?.canAssassinate
          ? room.seats.map((_, i) => i).filter((i) => i !== me.seat)
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

  /** 等人的三个阶段由 ActingStatus 接管 —— 它还要摊开号码 */
  const acting = phase === "ROLE_REVEAL" || phase === "VOTE" || phase === "MISSION";

  /*
   * 能朝谁扔花扔蛋。只在组队阶段 —— 那是线下真正在发言互喷的时候，
   * 别的阶段满屏鸡蛋只会盖住要看的东西。自己不扔自己，队长在选人也不扔
   * （selectable 非空时 SeatBoard 让选人优先，这里就整个关掉）。
   */
  const reactable: number[] =
    phase === "TEAM_BUILD" && me && selectable.length === 0
      ? room.seats.flatMap((p, i) => (p && i !== me.seat ? [i] : []))
      : [];

  /** 中心提示：结果类阶段的一行大字 */
  const waitingText = (): string | null => {
    if (phase === "VOTE_RESULT") {
      const last = game.proposals.at(-1);
      // 跟结果弹窗、跟任务结果统一口径：组队成功/失败 → 任务成功/失败
      return last?.approved ? "组队成功" : "组队失败";
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
        <Progress game={game} room={room} />
      </div>

      <SeatBoard
        seats={room.seats}
        game={game}
        selectable={selectable}
        selected={picked}
        onSelect={toggle}
        selfSeat={me?.seat ?? null}
        reactable={reactable}
        onReact={setReactTarget}
      >
        {acting ? (
          <ActingStatus game={game} />
        ) : waitingText() ? (
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
      </SeatBoard>

      {/*
        阶段条。**车队必须在这里明明白白列出来** ——
        投票要判断的就是这一车，只靠头像上一圈金边根本看不见。
      */}
      <div className="shrink-0 px-4 py-1 text-center">
        {game.team && game.team.length > 0 ? (
          <div className="mb-1 space-y-1.5 rounded-xl bg-surface px-3 py-2">
            <p className="text-[0.7rem] text-ink-mute">
              {phase === "MISSION" ? "正在执行任务的是" : "这一车"}
            </p>
            <div className="flex justify-center">
              <PlayerChips seated={room.seats} seats={game.team} tone="gold" />
            </div>

            {/*
              发言顺序。队长选了方向，**全场都要看得到** ——
              只有队长自己知道的话，这个功能等于不存在。
            */}
            {game.speakDirection && phase !== "MISSION" ? (
              <p className="border-t border-line pt-1.5 text-[0.7rem] text-ink-mute">
                发言 {game.speakDirection === "CW" ? "顺时针 ↻" : "逆时针 ↺"} ·{" "}
                <span className="text-ink-soft tabular-nums">
                  {speakOrder(game.leaderSeat, room.seats.length, game.speakDirection)
                    .map((n) => `${n + 1}`)
                    .join(" → ")}
                </span>
              </p>
            ) : null}
          </div>
        ) : null}
        <p className="text-sm text-ink-soft">
          {PHASE_HINT[phase ?? ""] ?? ""}
          {phase === "TEAM_BUILD" ? ` · 挑 ${game.teamSize} 个人` : ""}
        </p>
      </div>

      {/* 操作区 —— 唯一随阶段变化的部分，固定在拇指可达区 */}
      <div className="shrink-0 space-y-2 px-4 pt-1">
        <Actions
          game={game}
          picked={picked}
          isHost={isHost}
          onAct={act}
          onOpenRole={() => setSheet("role")}
          seatCount={room.seatCount}
          who={labeler(room.seats)}
        />

        <nav className="flex gap-2 pt-1">
          <Button tone="ghost" className="flex-1 text-xs" onClick={() => setSheet("role")}>
            身份卡
          </Button>
          <Button tone="ghost" className="flex-1 text-xs" onClick={() => setSheet("report")}>
            战报
          </Button>
          <Button
            tone="ghost"
            className="flex-1 text-xs"
            onClick={() => useStore.getState().setRulesOpen(true)}
          >
            规则
          </Button>
          <Button tone="ghost" className="flex-1 text-xs" onClick={() => setConfirmLeave(true)}>
            退出
          </Button>
        </nav>
      </div>

      <Sheet open={sheet === "role"} onOpenChange={(o) => setSheet(o ? "role" : null)} title="我的身份">
        {/* 发牌阶段翻开就等于确认看牌；其他阶段只是随时翻出来看看，不发动作 */}
        <RoleCard
          game={game}
          seated={room.seats}
          onReveal={() => {
            if (needsRole) act({ type: "ACK_ROLE" });
          }}
        />
      </Sheet>
      <Sheet open={sheet === "report"} onOpenChange={(o) => setSheet(o ? "report" : null)} title="战报">
        <Report game={game} seated={room.seats} />
      </Sheet>

      {/*
        献花 / 砸蛋。发言阶段点别人头像弹出来 ——
        扔完立刻关掉，两下点完，别打断发言。
      */}
      <Sheet
        open={reactTarget !== null}
        onOpenChange={(o) => !o && setReactTarget(null)}
        title={reactTarget === null ? "" : `丢给 ${labeler(room.seats).full(reactTarget)}`}
      >
        <div className="flex gap-3 pb-2">
          {(
            [
              ["FLOWER", "🌹", "献花"],
              ["EGG", "🥚", "砸蛋"],
            ] as const
          ).map(([kind, emoji, label]) => (
            <button
              key={kind}
              type="button"
              onClick={() => {
                if (reactTarget !== null) react(reactTarget, kind);
                setReactTarget(null);
              }}
              className="flex flex-1 flex-col items-center gap-1 rounded-2xl bg-surface-2 py-5
                text-ink active:scale-95"
            >
              <span className="text-4xl">{emoji}</span>
              <span className="text-sm">{label}</span>
            </button>
          ))}
        </div>
      </Sheet>

      {/* 对局中退出座位是保留的 —— 得说清楚怎么回来，不然人会以为把牌局搞砸了 */}
      <Sheet open={confirmLeave} onOpenChange={setConfirmLeave} title="离开这局？">
        <div className="space-y-3 pb-2">
          <p className="text-sm text-ink-soft">
            牌局还没结束。你的座位会一直留着，用房间码
            <span className="mx-1 font-display tracking-widest text-gold">{room.id}</span>
            随时能回来接着打。
          </p>
          <p className="text-xs text-ink-mute">在你回来之前，其他人会看到你的座位是掉线状态。</p>
          <div className="flex gap-2 pt-1">
            <Button tone="ghost" className="flex-1" onClick={() => setConfirmLeave(false)}>
              留下
            </Button>
            <Button tone="red" className="flex-1" onClick={leaveRoom}>
              离开
            </Button>
          </div>
        </div>
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
  onOpenRole,
  seatCount,
  who,
}: {
  game: ClientGameView;
  picked: readonly number[];
  isHost: boolean;
  onAct: ReturnType<typeof useStore.getState>["act"];
  onOpenRole: () => void;
  seatCount: number;
  who: ReturnType<typeof labeler>;
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
          {/*
            没有单独的「我已看牌」了 —— 翻开身份卡本身就是确认。
            以前那个按钮可以不看牌直接点掉，等于确认了个寂寞；
            现在只有真翻开过才算数。这个按钮是给关掉了卡片的人回去用的。
          */}
          {me && !game.ackedSeats.includes(me.seat) ? (
            <Button className="w-full" onClick={onOpenRole}>
              查看身份
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
              {picked.length === 0
                ? `选 ${game.teamSize} 个人`
                : `确认 ${[...picked].sort((a, b) => a - b).map(seatNo).join(" ")} (${picked.length}/${game.teamSize})`}
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
      // 服务端会自动往下走，这里只给房主一个提前的口子
      return isHost ? (
        <Button tone="ghost" className="w-full" onClick={() => onAct({ type: "ADVANCE" })}>
          立即继续
        </Button>
      ) : (
        <p className="py-3 text-center text-sm text-ink-mute">马上继续…</p>
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
          {picked[0] === undefined ? "选一个人查验" : `查验 ${who.full(picked[0])}`}
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
            <p className="text-center text-xs text-red">
              {who.full(target)} 是你已知的红方队友，确定吗？
            </p>
          ) : null}
          <Button
            tone="red"
            className="w-full"
            disabled={target === undefined || seatCount === 0}
            onClick={() => onAct({ type: "ASSASSINATE", targetSeat: target! })}
          >
            刺杀 {target !== undefined ? who.full(target) : ""}
          </Button>
        </div>
      );
    }

    default:
      return null;
  }
};

export const roleName = (id: keyof typeof ROLES): string => ROLES[id].name;
