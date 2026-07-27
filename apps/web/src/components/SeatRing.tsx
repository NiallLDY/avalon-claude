/**
 * 环形座位区 —— 对局页的核心。
 *
 * 座次必须与线下真实落座顺序一致，这样一抬头就能把屏幕上的人和身边的人对上。
 * 座位角标承载全部实时信息：队长冠、上车勾、投票结果、女神令牌、掉线灰度。
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

/** 把 n 个座位均匀铺在椭圆上。从正下方开始顺时针 —— 正下方是"我"的方位 */
const seatPosition = (index: number, total: number): { x: number; y: number } => {
  const angle = (Math.PI * 2 * index) / total + Math.PI / 2;
  return { x: 50 + 42 * Math.cos(angle), y: 50 + 44 * Math.sin(angle) };
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
    <div className="relative min-h-0 w-full flex-1">
      {/* 中心信息区 */}
      <div className="absolute inset-0 flex items-center justify-center px-16">
        <div className="text-center">{children}</div>
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
            className={`absolute -translate-x-1/2 -translate-y-1/2 flex w-[4.5rem] flex-col items-center gap-1
              rounded-xl p-1 transition
              ${canSelect ? "active:scale-95" : "pointer-events-none"}
              ${isSelected ? "bg-gold/15 ring-2 ring-gold" : ""}`}
          >
            <span className="relative">
              <Avatar
                avatar={player.avatar}
                size={46}
                dim={!player.connected}
                className={onTeam ? "ring-2 ring-gold" : ""}
              />

              {isLeader ? (
                <span className="absolute -top-1.5 -left-1.5 text-sm drop-shadow">👑</span>
              ) : null}
              {isLady ? (
                <span className="absolute -top-1.5 -right-1.5 text-sm drop-shadow">🔮</span>
              ) : null}

              {/* 投票揭晓：同时公开所有人的票 */}
              {revealed !== undefined ? (
                <span
                  className={`absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center
                    rounded-full text-[0.7rem] font-bold text-white
                    ${revealed ? "bg-blue" : "bg-red"}`}
                >
                  {revealed ? "✓" : "✗"}
                </span>
              ) : voted || played || acked ? (
                // 未揭晓时只显示「已操作」，绝不显示操作内容
                <span className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full bg-gold ring-2 ring-ground" />
              ) : null}

              {!player.connected ? (
                <span className="absolute inset-0 flex items-center justify-center rounded-full bg-ground/50 text-[0.6rem]">
                  掉线
                </span>
              ) : null}
            </span>

            <span className="w-full truncate text-[0.68rem] leading-tight text-ink-soft">
              {player.nick}
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
  );
};
