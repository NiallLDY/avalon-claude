/**
 * 我的身份卡。
 *
 * 默认**盖住**，长按 1.2 秒才显形，松手立刻盖回 ——
 * 线下是围坐的，旁边的人一瞥就看见了。这个交互不是花哨，是必需品。
 */

import { useEffect, useRef, useState } from "react";
import { ROLES, type ClientGameView, type PublicPlayer } from "@avalon/shared";
import { loadArtStyle } from "../lib/identity.js";

const HOLD_MS = 1200;

export const RoleCard = ({
  game,
  seated,
}: {
  game: ClientGameView;
  seated: readonly PublicPlayer[];
}) => {
  const [revealed, setRevealed] = useState(false);
  const [progress, setProgress] = useState(0);
  const timer = useRef<number | null>(null);
  const start = useRef(0);

  const me = game.me;
  useEffect(() => () => { if (timer.current) cancelAnimationFrame(timer.current); }, []);

  if (!me) {
    return <p className="py-8 text-center text-sm text-ink-mute">你在观战，没有身份牌</p>;
  }

  const meta = ROLES[me.roleId];
  const nickOf = (seat: number) => seated[seat]?.nick ?? `${seat + 1} 号`;

  const beginHold = () => {
    start.current = performance.now();
    const tick = () => {
      const elapsed = performance.now() - start.current;
      setProgress(Math.min(1, elapsed / HOLD_MS));
      if (elapsed >= HOLD_MS) {
        setRevealed(true);
        return;
      }
      timer.current = requestAnimationFrame(tick);
    };
    timer.current = requestAnimationFrame(tick);
  };

  const endHold = () => {
    if (timer.current) cancelAnimationFrame(timer.current);
    timer.current = null;
    setRevealed(false);
    setProgress(0);
  };

  return (
    <div className="flex flex-col gap-3 pb-2">
      <div
        onPointerDown={beginHold}
        onPointerUp={endHold}
        onPointerLeave={endHold}
        onPointerCancel={endHold}
        onContextMenu={(e) => e.preventDefault()}
        className="relative aspect-square w-full overflow-hidden rounded-2xl border border-line
          bg-surface-2 select-none"
      >
        <img
          src={`/art/roles/${loadArtStyle()}/${meta.artId}.webp`}
          alt=""
          draggable={false}
          className={`h-full w-full object-cover transition-all duration-200
            ${revealed ? "blur-0 opacity-100" : "blur-2xl opacity-25 scale-110"}`}
        />

        {!revealed ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <span className="text-4xl">🂠</span>
            <span className="text-sm text-ink-soft">长按查看身份</span>
            <span className="h-1 w-32 overflow-hidden rounded-full bg-line">
              <span
                className="block h-full bg-gold transition-none"
                style={{ width: `${progress * 100}%` }}
              />
            </span>
            <span className="px-8 text-center text-[0.7rem] text-ink-mute">
              松手立刻盖回，旁边的人瞄不到
            </span>
          </div>
        ) : (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ground via-ground/85 to-transparent p-4 pt-10">
            <p
              className={`font-display text-2xl ${meta.side === "RED" ? "text-red" : "text-blue"}`}
            >
              {meta.name}
            </p>
            <p className="mt-1 text-xs text-ink-soft">{meta.tagline}</p>
          </div>
        )}
      </div>

      {/* 视野信息。盖住时也不显示，否则等于白做了上面那个长按 */}
      {revealed ? (
        <div className="space-y-2 rounded-xl bg-surface-2 p-3 text-sm">
          <p className="text-xs text-ink-mute">你知道的</p>

          {me.vision.evilSeats.length > 0 ? (
            <p>
              <span className="text-red">红方</span>：
              {me.vision.evilSeats
                .map((s) => nickOf(s) + (me.vision.lancelotSeats.includes(s) ? "（兰斯洛特）" : ""))
                .join("、")}
            </p>
          ) : null}

          {me.vision.merlinCandidates.length > 0 ? (
            <p>
              这两人里一个是<span className="text-blue">梅林</span>，一个是
              <span className="text-red">莫甘娜</span>：
              {me.vision.merlinCandidates.map(nickOf).join("、")}
            </p>
          ) : null}

          {me.myLadyChecks.length > 0 ? (
            <p>
              女神查验：
              {me.myLadyChecks
                .map((c) => `${nickOf(c.targetSeat)} 是${c.side === "RED" ? "红方" : "蓝方"}`)
                .join("、")}
            </p>
          ) : null}

          {me.vision.evilSeats.length === 0 &&
          me.vision.merlinCandidates.length === 0 &&
          me.myLadyChecks.length === 0 ? (
            <p className="text-ink-mute">你没有任何情报，全靠推理。</p>
          ) : null}

          {meta.isLancelot ? (
            <p className="text-gold">
              当前阵营：{me.side === "RED" ? "红方（只能出失败）" : "蓝方（只能出成功）"}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
