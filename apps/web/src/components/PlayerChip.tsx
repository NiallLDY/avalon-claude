/**
 * 玩家标签：头像 + 座位号 + 昵称。
 *
 * 凡是「列出一组玩家」的地方都用它 —— 视野、队伍、投票明细、女神查验。
 * 纯文字的名单在手机上很难和座位环对上；带头像就能扫一眼认出来，
 * 号码则是线下沟通的主语。
 */

import type { PublicPlayer } from "@avalon/shared";
import { Avatar } from "./Avatar.js";

type Tone = "neutral" | "blue" | "red" | "gold";

const TONE: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-soft",
  blue: "bg-blue/20 text-blue",
  red: "bg-red/20 text-red",
  gold: "bg-gold/20 text-gold",
};

export const PlayerChip = ({
  player,
  seat,
  tone = "neutral",
  mark,
  showNick = true,
  size = 20,
}: {
  player: PublicPlayer | null | undefined;
  seat: number;
  tone?: Tone;
  /** 右侧角标，比如投票的 ✓ / ✗ */
  mark?: string;
  showNick?: boolean;
  size?: number;
}) => (
  <span
    className={`inline-flex max-w-full items-center gap-1 rounded-full py-0.5 pl-0.5 pr-2
      ${TONE[tone]}`}
  >
    {player ? (
      <Avatar avatar={player.avatar} size={size} className="shrink-0" />
    ) : (
      <span className="shrink-0 rounded-full bg-line" style={{ width: size, height: size }} />
    )}
    <span className="shrink-0 text-[0.72rem] font-bold leading-none tabular-nums">{seat + 1}</span>
    {showNick && player ? (
      <span className="min-w-0 max-w-[4.5rem] truncate text-[0.65rem] leading-none opacity-80">
        {player.nick}
      </span>
    ) : null}
    {mark ? <span className="shrink-0 text-[0.72rem] font-bold leading-none">{mark}</span> : null}
  </span>
);

/** 一组玩家。座位号排序后展示 —— 和座位环对得上 */
export const PlayerChips = ({
  seated,
  seats,
  tone,
  markOf,
  showNick,
  size,
}: {
  seated: readonly (PublicPlayer | null)[];
  seats: readonly number[];
  tone?: Tone;
  markOf?: (seat: number) => string | undefined;
  showNick?: boolean;
  size?: number;
}) => (
  <span className="flex flex-wrap gap-1">
    {[...seats]
      .sort((a, b) => a - b)
      .map((seat) => (
        <PlayerChip
          key={seat}
          player={seated[seat]}
          seat={seat}
          {...(tone ? { tone } : {})}
          {...(markOf?.(seat) ? { mark: markOf(seat)! } : {})}
          {...(showNick === undefined ? {} : { showNick })}
          {...(size === undefined ? {} : { size })}
        />
      ))}
  </span>
);
