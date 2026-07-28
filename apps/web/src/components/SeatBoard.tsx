/**
 * 座位区 —— 对局页的核心。
 *
 * 布局：**两列，靠左右两侧排布，中间留给阶段提示。**
 * 顺序固定，**从上往下、从左往右** —— 左列排满再排右列（10 人局是左 1–5、右 6–10），
 * **不按「自己」旋转**。旋转过的圈每个人看到的位置都不一样，
 * 线下喊「左边第二个」时对不上；固定顺序则人人一致，
 * 号码在屏幕上的位置也不会因为换座而跳。自己那格单独标出来就够了。
 *
 * 座位角标承载全部实时信息：座位号、队长冠、上车勾、投票结果、女神令牌、掉线灰度。
 */

import { ROLES, type ClientGameView, type PublicPlayer } from "@avalon/shared";
import { Avatar } from "./Avatar.js";
import { useStore } from "../store.js";

const REACTION_EMOJI = { FLOWER: "🌹", EGG: "🥚" } as const;

interface Props {
  /** 按座次排好的座位，null 是空位 */
  readonly seats: readonly (PublicPlayer | null)[];
  readonly game: ClientGameView | null;
  /** 可点选的座位号；空数组表示当前不能选人 */
  readonly selectable?: readonly number[];
  readonly selected?: readonly number[];
  readonly onSelect?: (seat: number) => void;
  /** 我的座位号；没入座时为 null。只用来标注，不影响排布顺序 */
  readonly selfSeat?: number | null;
  /** 空位是否可点（等待页选座用） */
  readonly emptySelectable?: boolean;
  /**
   * 可以朝他扔东西的座位。**跟 selectable 互斥**：
   * 队长在组队阶段点头像是选人，非队长点才是扔东西 ——
   * 同一个手势不能有两个意思。
   */
  readonly reactable?: readonly number[];
  readonly onReact?: (seat: number) => void;
  /** 两列中间的内容 */
  readonly children?: React.ReactNode;
}

/**
 * 头像尺寸随行数收缩。10 人局要塞 5 行，一屏不滚动（铁律 4）就得让每行矮一点。
 */
const avatarSize = (rows: number): number => (rows <= 3 ? 48 : rows === 4 ? 42 : 36);

/**
 * 当前阶段这个座位该不该动、动了没。null = 这一阶段轮不到他。
 *
 * 只回答「做没做」，**绝不回答「做了什么」** —— 投了赞成还是反对、
 * 出的成功还是失败，在揭晓前谁都不能从这里看出来（铁律 2、3）。
 * 用到的三个数组本来就在裁剪后的视图里，不含任何机密。
 */
const actState = (game: ClientGameView | null, seat: number): "done" | "waiting" | null => {
  if (!game) return null;
  if (game.phase === "ROLE_REVEAL") return game.ackedSeats.includes(seat) ? "done" : "waiting";
  if (game.phase === "VOTE") return game.votedSeats.includes(seat) ? "done" : "waiting";
  if (game.phase === "MISSION") {
    // 没上车的人这一阶段没事做，不该被标成「还在等他」
    if (!game.team?.includes(seat)) return null;
    return game.playedSeats.includes(seat) ? "done" : "waiting";
  }
  return null;
};

export const SeatBoard = ({
  seats,
  game,
  selectable = [],
  selected = [],
  onSelect,
  selfSeat = null,
  emptySelectable = false,
  reactable = [],
  onReact,
  children,
}: Props) => {
  const rows = Math.max(Math.ceil(seats.length / 2), 1);
  const size = avatarSize(rows);
  const reactions = useStore((s) => s.reactions);

  /**
   * **从上往下、从左往右**：左列先从上排到底，排满了再从右列顶上继续。
   * 10 人局就是左列 1–5、右列 6–10。
   */
  const cell = (seat: number): React.CSSProperties =>
    seat < rows
      ? { gridColumn: 1, gridRow: seat + 1 }
      : { gridColumn: 3, gridRow: seat - rows + 1 };

  return (
    <div className="flex min-h-0 w-full flex-1 items-stretch px-2 py-1">
      <div
        className="grid min-h-0 w-full flex-1 gap-x-1"
        style={{
          gridTemplateColumns: "auto minmax(0, 1fr) auto",
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        }}
      >
        {/* 中间一列：阶段提示与大字，纵向贯穿所有行 */}
        <div
          className="flex min-w-0 items-center justify-center px-1"
          style={{ gridColumn: 2, gridRow: `1 / span ${rows}` }}
        >
          <div className="text-center leading-snug">{children}</div>
        </div>

        {seats.map((player, seat) => {
          const isSelf = seat === selfSeat;
          const canSelect = player === null ? emptySelectable : selectable.includes(seat);
          const isSelected = selected.includes(seat);
          const isLeader = game?.leaderSeat === seat;
          const onTeam = game?.team?.includes(seat) ?? false;
          const act = actState(game, seat);
          // 选人优先：队长点头像是选队员，轮不到扔东西
          const canReact = !canSelect && reactable.includes(seat);
          const hits = reactions.filter((r) => r.targetSeat === seat);
          const revealed = game?.revealedVotes?.[seat];
          const isLady = game?.lady?.holderSeat === seat;
          const role = game?.reveal?.[seat];

          if (player === null) {
            // 空位。点一下就坐进去 —— 这是「挑一个和线下真实位置对应的号」的入口
            return (
              <button
                key={`empty-${seat}`}
                type="button"
                data-seat={seat}
                disabled={!canSelect}
                onClick={() => onSelect?.(seat)}
                style={cell(seat)}
                className={`flex min-h-0 w-[5rem] flex-col items-center justify-center gap-0.5
                  self-center rounded-xl p-1 transition
                  ${canSelect ? "active:scale-95" : "pointer-events-none opacity-60"}`}
              >
                <span
                  style={{ width: size, height: size }}
                  className={`flex items-center justify-center rounded-full
                    border border-dashed text-[0.7rem]
                    ${canSelect ? "border-gold/70 text-gold" : "border-line text-ink-mute"}`}
                >
                  {canSelect ? "坐这" : "空"}
                </span>
                <span className="flex w-full items-center justify-center gap-1">
                  <span className="flex h-[1.15rem] min-w-[1.15rem] items-center justify-center
                    rounded bg-surface-2 px-1 text-[0.72rem] font-bold leading-none tabular-nums
                    text-ink-mute ring-1 ring-line">
                    {seat + 1}
                  </span>
                </span>
              </button>
            );
          }

          return (
            <button
              key={player.id}
              type="button"
              /* e2e 用它选座位按钮。别再用布局类当选择器 —— 换个排布就全断 */
              data-seat={seat}
              disabled={!canSelect && !canReact}
              onClick={() => (canSelect ? onSelect?.(seat) : onReact?.(seat))}
              style={cell(seat)}
              className={`flex min-h-0 w-[5rem] flex-col items-center justify-center gap-0.5
                self-center rounded-xl p-1 transition
                ${canSelect || canReact ? "active:scale-95" : "pointer-events-none"}
                ${isSelected ? "bg-gold/15 ring-2 ring-gold" : ""}
                ${isSelf && !isSelected ? "bg-ink/10 ring-1 ring-ink/40" : ""}`}
            >
              <span className="relative">
                <Avatar
                  avatar={player.avatar}
                  size={size}
                  dim={!player.connected}
                  className={`${onTeam ? "ring-2 ring-gold" : isSelf ? "ring-2 ring-ink/70" : ""}
                    ${hits.length > 0 ? "reaction-shake" : ""}`}
                />

                {/*
                  飞出来的花和蛋。同时来好几个就横向岔开一点，免得叠成一坨。
                  纯装饰，pointer-events-none，别挡住底下的按钮。
                */}
                {hits.map((r, i) => (
                  <span
                    key={r.id}
                    className="reaction-fly pointer-events-none absolute -top-1 left-1/2 z-20 text-2xl drop-shadow"
                    style={{ marginLeft: `${(i % 3) - 1}rem` }}
                  >
                    {REACTION_EMOJI[r.kind]}
                  </span>
                ))}

                {isLeader ? (
                  <span className="absolute -top-2 -left-1.5 text-sm drop-shadow">👑</span>
                ) : null}
                {isLady ? (
                  <span className="absolute -top-2 -right-1.5 text-sm drop-shadow">🔮</span>
                ) : null}

                {/* 投票揭晓：同时公开所有人的票 */}
                {revealed !== undefined ? (
                  <span
                    className={`absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center
                      rounded-full text-[0.7rem] font-bold text-white ring-2 ring-ground
                      ${revealed ? "bg-blue" : "bg-red"}`}
                  >
                    {revealed ? "✓" : "✗"}
                  </span>
                ) : act !== null ? (
                  /*
                    「他动了没」。以前是个 12px 的金点，三个阶段还长得一模一样，
                    等于没有 —— 桌上根本看不出还在等谁。
                    现在做成和揭票角标同样大的实心/空心二态：
                    金色 ✓ = 已操作，虚线 ⋯ = 还在等他。
                    **只说做没做，不说做了什么。**
                  */
                  <span
                    className={`absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center
                      rounded-full text-[0.7rem] leading-none font-bold ring-2 ring-ground
                      ${act === "done"
                        ? "bg-green text-white"
                        : "border border-dashed border-ink-mute bg-surface-2 text-ink-mute"}`}
                  >
                    {act === "done" ? "✓" : "⋯"}
                  </span>
                ) : null}

                {/* 准备好了打个勾。开局前用，开局后 game 非空就不显示了 */}
                {game === null && player.ready ? (
                  <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center
                    justify-center rounded-full bg-blue text-[0.6rem] text-white ring-2 ring-ground">
                    ✓
                  </span>
                ) : null}

                {!player.connected ? (
                  <span className="absolute inset-0 flex items-center justify-center rounded-full bg-ground/60 text-[0.6rem]">
                    掉线
                  </span>
                ) : null}
              </span>

              {/*
                座位号 + 昵称。线下全靠座位号沟通 ——「3 号出的失败牌」「不上 5 号的车」，
                所以号码要比昵称更显眼，做成一块号牌。
              */}
              <span className="flex w-full items-center justify-center gap-1">
                <span
                  className={`flex h-[1.15rem] min-w-[1.15rem] shrink-0 items-center justify-center
                    rounded px-1 text-[0.72rem] font-bold leading-none tabular-nums
                    ${isLeader
                      ? "bg-gold text-ground"
                      : isSelf
                        ? "bg-ink text-ground"
                        : "bg-surface-2 text-ink ring-1 ring-line"}`}
                >
                  {seat + 1}
                </span>
                {/*
                  座位不再按自己旋转，所以「哪个是我」全靠这块标注 ——
                  自己那格把昵称换成实心的「你」，扫一眼就能定位。
                */}
                {isSelf ? (
                  <span className="shrink-0 rounded bg-ink px-1 text-[0.62rem] font-bold leading-[1.15rem] text-ground">
                    你
                  </span>
                ) : (
                  <span className="min-w-0 truncate text-[0.62rem] leading-tight text-ink-mute">
                    {player.nick}
                  </span>
                )}
              </span>

              {/* 终局才揭晓身份 */}
              {role ? (
                <span
                  className={`w-full truncate text-[0.6rem] leading-tight
                    ${ROLES[role].side === "RED" ? "text-red" : "text-blue"}`}
                >
                  {ROLES[role].name}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
};
