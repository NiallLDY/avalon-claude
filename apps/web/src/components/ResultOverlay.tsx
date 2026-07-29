/**
 * 结果弹窗：投票通过/否决、任务成功/失败、忠诚牌翻牌。
 *
 * 这些结果原本只是主界面上的一行小字，一晃就过去了 ——
 * 而它们恰恰是全场要一起看到、要据此吵起来的东西。
 * 所以做成盖住屏幕的弹窗，**由玩家自己点掉**，
 * 后台该往下走就往下走，不会因为谁没关弹窗卡住全场。
 */

import { REJECT_LIMIT, type PublicPlayer } from "@avalon/shared";
import { PlayerChip, PlayerChips } from "./PlayerChip.js";
import { Button } from "./ui.js";
import { useMemo } from "react";
import { AnimatePresence, m } from "motion/react";
import { useStore, type ResultCard } from "../store.js";

/**
 * selector 里**不能**写 `?? []` —— 那样每次调用都返回一个新数组，
 * zustand 按引用比较就认为状态变了，直接无限重渲染（React error #185）。
 * 兜底值要放在 selector 外面，用一个稳定的常量。
 */
const NO_PLAYERS: readonly (PublicPlayer | null)[] = [];

export const ResultOverlay = () => {
  const card = useStore((s) => s.result);
  const dismiss = useStore((s) => s.dismissResult);
  const seated = useStore((s) => s.state?.room.seats) ?? NO_PLAYERS;

  /*
   * 用 AnimatePresence 是因为**退场只能这么做** ——
   * 点「知道了」直接卸载的话弹窗是啪一下消失的，
   * CSS 动画管不到已经从树上摘掉的元素。
   */
  return (
    <AnimatePresence>
      {card ? (
        <m.div
          key="backdrop"
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <m.div
            key={card.id}
            className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 text-center"
            initial={{ opacity: 0, scale: 0.94, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 6 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
          >
            <Body card={card} seated={seated} />
            <Button className="mt-5 w-full" onClick={dismiss}>
              知道了
            </Button>
          </m.div>
        </m.div>
      ) : null}
    </AnimatePresence>
  );
};

/**
 * 任务牌逐张翻开。
 *
 * **顺序是打乱的，牌面不对应任何人。** 这个动画唯一的作用是把
 * 「几张失败牌」演出来 —— 任何能让人反推出谁出了什么的编排都不能做，
 * 所以既不按座位顺序排，也不在牌上留任何标识。
 */
const MissionCards = ({
  card,
}: {
  card: Extract<ResultCard, { kind: "MISSION" }>;
}) => {
  const faces = useMemo(() => {
    const deck = Array.from({ length: card.team.length }, (_, i) => i < card.failCount);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j]!, deck[i]!];
    }
    return deck;
  }, [card.id, card.failCount, card.team.length]);

  return (
    <div className="mt-3 flex justify-center gap-1.5">
      {faces.map((failed, i) => (
        <span
          key={i}
          className={`card-flip flex h-12 w-9 items-center justify-center rounded-lg
            border text-lg
            ${failed ? "border-red/60 bg-red/20 text-red" : "border-blue/50 bg-blue/15 text-blue"}`}
          style={{ animationDelay: `${0.2 + i * 0.14}s` }}
        >
          {failed ? "✗" : "✓"}
        </span>
      ))}
    </div>
  );
};

const Body = ({
  card,
  seated,
}: {
  card: ResultCard;
  seated: readonly (PublicPlayer | null)[];
}) => {
  if (card.kind === "VOTE") {
    const yes = card.votes.filter(Boolean).length;
    return (
      <>
        {/*
          说「组队成功/失败」而不是「上车/翻车」。
          翻车跟任务失败在字面上分不开，而这两件事完全不同 ——
          一个是这一车没发出去，一个是车发出去了但砸了。
          这里跟任务结果的「任务成功/任务失败」凑成一对，一眼就知道在说哪一步。
        */}
        <p className={`font-display text-3xl ${card.approved ? "text-blue" : "text-red"}`}>
          {card.approved ? "组队成功" : "组队失败"}
        </p>
        <p className="mt-1 text-sm text-ink-soft">
          {yes} 票赞成 · {card.votes.length - yes} 票反对
        </p>

        <div className="rise-in mt-4 space-y-3 text-left" style={{ animationDelay: "0.24s" }}>
          <div>
            <p className="mb-1.5 text-xs text-ink-mute">这一车</p>
            <PlayerChips seated={seated} seats={card.team} tone="gold" />
          </div>
          <div>
            <p className="mb-1.5 text-xs text-ink-mute">谁投了什么</p>
            <div className="flex flex-wrap gap-1">
              {card.votes.map((approve, seat) => (
                <PlayerChip
                  key={seat}
                  player={seated[seat]}
                  seat={seat}
                  tone={approve ? "blue" : "red"}
                  mark={approve ? "✓" : "✗"}
                  showNick={false}
                />
              ))}
            </div>
          </div>
        </div>

        {!card.approved ? (
          <p className="mt-4 text-xs text-ink-mute">
            组队失败就是流局 —— 这一轮第 {card.rejectStreak} 次，满 {REJECT_LIMIT} 次红方直接赢
          </p>
        ) : null}
      </>
    );
  }

  if (card.kind === "MISSION") {
    return (
      <>
        <p className={`slam font-display text-3xl ${card.success ? "text-blue" : "text-red"}`}>
          {card.success ? "任务成功" : "任务失败"}
        </p>
        <MissionCards card={card} />
        <p className="rise-in mt-1 text-sm text-ink-soft" style={{ animationDelay: "0.9s" }}>
          {card.failCount === 0
            ? "没有人放失败牌"
            : `${card.failCount} 张失败牌`}
          {card.failsRequired === 2 ? "（这一轮要 2 张才算失败）" : ""}
        </p>

        <div className="rise-in mt-4 text-left" style={{ animationDelay: "1s" }}>
          <p className="mb-1.5 text-xs text-ink-mute">执行这次任务的是</p>
          <PlayerChips seated={seated} seats={card.team} tone="gold" />
        </div>

        <p className="mt-4 text-xs text-ink-mute">牌是打乱的，谁放的失败牌只有他自己知道</p>
      </>
    );
  }

  return (
    <>
      <p className="slam font-display text-3xl text-gold">忠诚牌</p>
      <p className="mt-3 text-sm text-ink-soft">
        {card.swapped === null
          ? "翻开了一张，内容不公开"
          : card.swapped
            ? "两位兰斯洛特互换了阵营"
            : "阵营不变"}
      </p>
      {card.swapped !== false ? (
        <p className="mt-3 text-xs text-ink-mute">兰斯洛特可以打开身份卡确认自己现在是哪一边</p>
      ) : null}
    </>
  );
};
