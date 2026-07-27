/**
 * 我的身份卡。
 *
 * **点一下翻开，再点一下盖回。** 视野里的人用头像 + 号码展示 ——
 * 纯文字名单在手机上很难和座位环对上。
 *
 * 盖回的时机除了手动，还有一处自动：页面切到后台时立刻盖上。
 * 线下是围坐的，把手机递给别人看别的东西之前不该还开着身份。
 */

import { useEffect, useState } from "react";
import { ROLES, type ClientGameView, type PublicPlayer } from "@avalon/shared";
import { loadArtStyle } from "../lib/identity.js";
import { PlayerChip, PlayerChips } from "./PlayerChip.js";

export const RoleCard = ({
  game,
  seated,
}: {
  game: ClientGameView;
  seated: readonly PublicPlayer[];
}) => {
  const [revealed, setRevealed] = useState(false);

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
    me.myLadyChecks.length > 0;

  return (
    <div className="flex flex-col gap-3 pb-2">
      {/* 我是几号 —— 身份卡是最常打开的面板，顺手把号码钉在这儿 */}
      <div className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2">
        <span className="text-xs text-ink-mute">你的座位</span>
        <PlayerChip player={seated[me.seat]} seat={me.seat} tone="gold" size={24} />
      </div>

      <button
        type="button"
        onClick={() => setRevealed((v) => !v)}
        className="relative aspect-square w-full overflow-hidden rounded-2xl border border-line
          bg-surface-2 select-none active:opacity-90"
      >
        <img
          src={`/art/roles/${loadArtStyle()}/${meta.artId}.webp`}
          alt=""
          draggable={false}
          className={`h-full w-full object-cover transition-all duration-200
            ${revealed ? "blur-0 opacity-100" : "blur-2xl opacity-20 scale-110"}`}
        />

        {!revealed ? (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <span className="text-4xl">🂠</span>
            <span className="text-sm text-ink-soft">点击查看身份</span>
            <span className="px-8 text-center text-[0.7rem] text-ink-mute">
              看完再点一下盖回，切走也会自动盖上
            </span>
          </span>
        ) : (
          <>
            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ground via-ground/85 to-transparent p-4 pt-10 text-left">
              <span
                className={`block font-display text-2xl ${meta.side === "RED" ? "text-red" : "text-blue"}`}
              >
                {meta.name}
              </span>
              <span className="mt-1 block text-xs text-ink-soft">{meta.tagline}</span>
            </span>
            <span className="absolute right-2 top-2 rounded-full bg-ground/70 px-2 py-1 text-[0.65rem] text-ink-soft">
              点击盖回
            </span>
          </>
        )}
      </button>

      {/* 视野。盖住时一并隐藏，否则等于白做了上面那层遮盖 */}
      {revealed ? (
        <div className="space-y-3 rounded-xl bg-surface-2 p-3">
          <p className="text-xs text-ink-mute">你知道的</p>

          {me.vision.evilSeats.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-xs text-red">这些人是红方</p>
              <PlayerChips
                seated={seated}
                seats={me.vision.evilSeats}
                tone="red"
                markOf={(s) => (me.vision.lancelotSeats.includes(s) ? "兰" : undefined)}
              />
              {me.vision.lancelotSeats.length > 0 ? (
                <p className="text-[0.68rem] text-ink-mute">带「兰」的是兰斯洛特，翻忠诚牌时可能换边</p>
              ) : null}
            </div>
          ) : null}

          {me.vision.merlinCandidates.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-xs">
                这两人里，一个是<span className="text-blue">梅林</span>，一个是
                <span className="text-red">莫甘娜</span>
              </p>
              <PlayerChips seated={seated} seats={me.vision.merlinCandidates} tone="gold" />
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
                  />
                ))}
              </span>
            </div>
          ) : null}

          {!hasIntel ? <p className="text-sm text-ink-mute">你什么都不知道，全靠听和推。</p> : null}

          {meta.isLancelot ? (
            <p className="text-sm text-gold">
              当前阵营：{me.side === "RED" ? "红方（只能出失败）" : "蓝方（只能出成功）"}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
