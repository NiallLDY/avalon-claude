/**
 * 我的身份卡。点一下翻开，再点一下盖回；切到后台自动盖上。
 *
 * **整张卡必须一屏放得下，任何角色都不用滑。**
 * 这不是排版偏好，是信息安全：如果只有梅林和红方需要往下滑才能看到视野，
 * 那「有没有滑」这个动作本身就把身份说出去了 —— 线下围坐时旁边人一眼就能看出来。
 * 所以插画收成横向缩略图，视野区**对所有角色都恒定存在**（忠臣显示「你什么都不知道」），
 * 整体高度尽量一致。
 */

import { useEffect, useState } from "react";
import { ROLES, type ClientGameView, type PublicPlayer } from "@avalon/shared";
import { loadArtStyle } from "../lib/identity.js";
import { PlayerChip, PlayerChips } from "./PlayerChip.js";

export const RoleCard = ({
  game,
  seated,
  onReveal,
}: {
  game: ClientGameView;
  seated: readonly (PublicPlayer | null)[];
  /** 翻开时回调。发牌阶段用它顶掉「我已看牌」那一步 —— 看了就是确认了 */
  onReveal?: () => void;
}) => {
  const [revealed, setRevealed] = useState(false);

  const flip = (): void => {
    setRevealed((v) => {
      if (!v) onReveal?.();
      return !v;
    });
  };

  // 切到后台/锁屏时自动盖回
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") setRevealed(false);
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  const me = game.me;
  if (!me) {
    return <p className="py-8 text-center text-sm text-ink-mute">你在观战，没有身份牌</p>;
  }

  const meta = ROLES[me.roleId];
  const hasIntel =
    me.vision.evilSeats.length > 0 ||
    me.vision.merlinCandidates.length > 0 ||
    me.vision.counterpartSeat !== null ||
    me.myLadyChecks.length > 0;

  return (
    <div className="flex flex-col gap-2.5 pb-2">
      {/* 横向卡：插画收成缩略图，把纵向空间留给视野 */}
      <button
        type="button"
        onClick={flip}
        className="flex select-none items-stretch gap-3 rounded-2xl border border-line
          bg-surface-2 p-2.5 text-left active:opacity-90"
      >
        <span className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-ground">
          <img
            src={`/art/roles/${loadArtStyle()}/${meta.artId}.webp`}
            alt=""
            draggable={false}
            className={`h-full w-full object-cover transition-all duration-200
              ${revealed ? "blur-0 opacity-100" : "blur-lg opacity-20 scale-110"}`}
          />
          {!revealed ? (
            <span className="absolute inset-0 flex items-center justify-center text-2xl">🂠</span>
          ) : null}
        </span>

        <span className="flex min-w-0 flex-1 flex-col justify-center gap-1">
          {revealed ? (
            <>
              <span
                /*
                 * 给测试一个准星。翻牌后的视野区会写出别人的角色名
                 * （派西维尔看得到「莫甘娜」），拿整张卡的文字去认自己是谁必错。
                 * 只是本人已经看到的信息，标出来不多泄漏什么。
                 */
                data-my-side={meta.side}
                className={`font-display text-2xl leading-none
                  ${meta.side === "RED" ? "text-red" : "text-blue"}`}
              >
                {meta.name}
              </span>
              <span className="text-[0.72rem] leading-snug text-ink-soft">{meta.tagline}</span>
              <span className="text-[0.68rem] text-ink-mute">点一下盖回</span>
            </>
          ) : (
            <>
              <span className="text-base">点击查看身份</span>
              <span className="text-[0.7rem] leading-snug text-ink-mute">
                看完再点一下盖回，切走也会自动盖上
              </span>
            </>
          )}
        </span>
      </button>

      {/* 你的座位号 —— 身份卡是最常打开的面板，顺手钉在这儿 */}
      <div className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2">
        <span className="text-xs text-ink-mute">你的座位</span>
        <PlayerChip player={seated[me.seat]} seat={me.seat} tone="gold" size={22} />
      </div>

      {/*
        视野区。**不管有没有情报都渲染**，高度尽量一致 ——
        只有有情报的人才多出一块内容的话，光看谁的卡更长就能猜身份。
      */}
      <div className="min-h-[6.5rem] space-y-2 rounded-xl bg-surface-2 p-3">
        {!revealed ? (
          <p className="py-6 text-center text-xs text-ink-mute">翻开身份后这里显示你知道的信息</p>
        ) : (
          <>
            {me.vision.evilSeats.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-xs text-red">这些人是红方</p>
                <PlayerChips
                  seated={seated}
                  seats={me.vision.evilSeats}
                  tone="red"
                  showNick={false}
                  markOf={(s) => (me.vision.lancelotSeats.includes(s) ? "兰" : undefined)}
                />
              </div>
            ) : null}

            {me.vision.merlinCandidates.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-xs">
                  一个是<span className="text-blue">梅林</span>，一个是
                  <span className="text-red">莫甘娜</span>
                </p>
                <PlayerChips seated={seated} seats={me.vision.merlinCandidates} tone="gold" />
              </div>
            ) : null}

            {me.vision.counterpartSeat !== null ? (
              <div className="space-y-1.5">
                {/*
                  「另一位兰斯洛特」而不是「他是红方」—— 两人换边是同步的，
                  所以他永远站在你的对面，但这句话说的是关系，不是当下的阵营。
                */}
                <p className="text-xs text-ink-mute">
                  另一位兰斯洛特（永远和你<span className="text-ink">相反</span>）
                </p>
                <PlayerChips
                  seated={seated}
                  seats={[me.vision.counterpartSeat]}
                  tone="gold"
                  showNick={false}
                  markOf={() => "兰"}
                />
              </div>
            ) : null}

            {me.myLadyChecks.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-xs text-ink-mute">你查验过的</p>
                <span className="flex flex-wrap gap-1">
                  {me.myLadyChecks.map((c) => (
                    <PlayerChip
                      key={c.targetSeat}
                      player={seated[c.targetSeat]}
                      seat={c.targetSeat}
                      tone={c.side === "RED" ? "red" : "blue"}
                      mark={c.side === "RED" ? "红" : "蓝"}
                      showNick={false}
                    />
                  ))}
                </span>
              </div>
            ) : null}

            {!hasIntel ? (
              <p className="py-5 text-center text-sm text-ink-mute">你什么都不知道，全靠听和推。</p>
            ) : null}

            {meta.isLancelot ? (
              <p className="text-xs text-gold">
                你现在是{me.side === "RED" ? "红方，只能出失败" : "蓝方，只能出成功"}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
};
