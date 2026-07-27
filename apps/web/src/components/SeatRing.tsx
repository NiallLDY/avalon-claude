/**
 * 环形座位区 —— 对局页的核心。
 *
 * 座次必须与线下真实落座顺序一致，这样一抬头就能把屏幕上的人和身边的人对上。
 * 座位角标承载全部实时信息：座位号、队长冠、上车勾、投票结果、女神令牌、掉线灰度。
 *
 * 布局：**居中的正方形容器 + 真正的圆**。
 * 之前直接按百分比铺在容器上，容器随视口变形，圆就被拉成高瘦椭圆，
 * 座位散在四角、还会溢出裁掉，完全看不出是围坐一圈。
 */

import { ROLES, type ClientGameView, type PublicPlayer } from "@avalon/shared";
import { Avatar } from "./Avatar.js";

interface Props {
  readonly seated: readonly PublicPlayer[];
  readonly game: ClientGameView | null;
  /** 可点选的座位号；空数组表示当前不能选人 */
  readonly selectable?: readonly number[];
  readonly selected?: readonly number[];
  readonly onSelect?: (seat: number) => void;
  /** 圆环中心的内容 */
  readonly children?: React.ReactNode;
}

/** 座位在圆上的位置。从**正下方**开始顺时针 —— 正下方是「我」的方位，和线下坐姿对得上 */
const seatPosition = (index: number, total: number): { x: number; y: number } => {
  const angle = (Math.PI * 2 * index) / total + Math.PI / 2;
  const R = 39; // 百分比半径。留出边距让 4.5rem 宽的座位块不被裁掉
  return { x: 50 + R * Math.cos(angle), y: 50 + R * Math.sin(angle) };
};

export const SeatRing = ({
  seated,
  game,
  selectable = [],
  selected = [],
  onSelect,
  children,
}: Props) => {
  const total = Math.max(seated.length, 1);

  return (
    <div className="flex min-h-0 w-full flex-1 items-center justify-center px-3 py-1">
      {/*
        正方形容器：宽高取「可用宽度」与「可用高度」的较小值。
        aspect-square + max-h-full 让它在窄屏按宽度、在高屏按高度收敛，
        无论哪种情况圆都是圆。
      */}
      <div className="relative aspect-square h-full max-h-full w-full max-w-full">
        {/* 圆环中心：提示与阶段大字 */}
        <div className="absolute inset-[26%] flex items-center justify-center">
          <div className="text-center leading-snug">{children}</div>
        </div>

        {seated.map((player, seat) => {
          const { x, y } = seatPosition(seat, total);
          const canSelect = selectable.includes(seat);
          const isSelected = selected.includes(seat);
          const isLeader = game?.leaderSeat === seat;
          const onTeam = game?.team?.includes(seat) ?? false;
          const voted = game?.votedSeats.includes(seat) ?? false;
          const played = game?.playedSeats.includes(seat) ?? false;
          const acked = game?.ackedSeats.includes(seat) ?? false;
          const revealed = game?.revealedVotes?.[seat];
          const isLady = game?.lady?.holderSeat === seat;
          const role = game?.reveal?.[seat];

          return (
            <button
              key={player.id}
              type="button"
              disabled={!canSelect}
              onClick={() => onSelect?.(seat)}
              style={{ left: `${x}%`, top: `${y}%` }}
              className={`absolute flex w-[4.6rem] -translate-x-1/2 -translate-y-1/2 flex-col
                items-center gap-0.5 rounded-xl p-1 transition
                ${canSelect ? "active:scale-95" : "pointer-events-none"}
                ${isSelected ? "bg-gold/15 ring-2 ring-gold" : ""}`}
            >
              <span className="relative">
                <Avatar
                  avatar={player.avatar}
                  size={44}
                  dim={!player.connected}
                  className={onTeam ? "ring-2 ring-gold" : ""}
                />

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
                ) : voted || played || acked ? (
                  // 未揭晓时只显示「已操作」，绝不显示操作内容
                  <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-gold ring-2 ring-ground" />
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
                    ${isLeader ? "bg-gold text-ground" : "bg-surface-2 text-ink ring-1 ring-line"}`}
                >
                  {seat + 1}
                </span>
                <span className="min-w-0 truncate text-[0.62rem] leading-tight text-ink-mute">
                  {player.nick}
                </span>
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
