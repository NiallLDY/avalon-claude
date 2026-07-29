/**
 * 点头像弹出来的小浮层。
 *
 * **不用 Bottom Sheet。** 抽屉从屏幕底下升起来、盖住半个界面、还要等动画，
 * 对「随手扔个蛋」这种动作太重了 —— 而且扔完还得再点一下关掉。
 * 小浮层贴着头像出现，扔完立刻消失，两下点完，不打断发言。
 *
 * 两种内容：
 *   点**别人** → 扔东西（花/蛋/番茄/水），带连发开关
 *   点**自己** → 发表情包
 */

import { useEffect, useRef } from "react";
import { m } from "motion/react";
import { EMOTES, REACTIONS, REACTION_META, type Reaction } from "@avalon/shared";

interface Anchor {
  /** 相对棋盘容器的位置（头像中心） */
  readonly x: number;
  readonly y: number;
  /** 座位在左列还是右列 —— 浮层朝中间弹，别飞出屏幕 */
  readonly side: "left" | "right";
}

const Panel = ({
  anchor,
  onClose,
  children,
}: {
  anchor: Anchor;
  onClose: () => void;
  children: React.ReactNode;
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  useOutsideClose(ref, onClose);
  return (
    <m.div
      ref={ref}
      className="pointer-events-auto absolute z-40"
      initial={{ opacity: 0, scale: 0.86 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 28 }}
      style={{
        top: anchor.y,
        ...(anchor.side === "left"
          ? { left: anchor.x + 26 }
          : { right: `calc(100% - ${anchor.x - 26}px)` }),
        transform: "translateY(-50%)",
      }}
    >
      <div className="rounded-2xl border border-line bg-surface-2 p-1.5 shadow-xl">{children}</div>
    </m.div>
  );
};

/** 朝别人扔东西 */
export const ThrowMenu = ({
  anchor,
  burst,
  onBurstChange,
  onPick,
  onClose,
}: {
  anchor: Anchor;
  burst: boolean;
  onBurstChange: (v: boolean) => void;
  onPick: (kind: Reaction) => void;
  onClose: () => void;
}) => (
  <Panel anchor={anchor} onClose={onClose}>
      <div className="flex items-center gap-1">
        {REACTIONS.map((kind) => (
          <button
            key={kind}
            type="button"
            /* 按钮里只有 emoji，没有 aria-label 的话读屏念的是「鸡蛋」不是「砸蛋」 */
            aria-label={REACTION_META[kind].label}
            title={REACTION_META[kind].label}
            onClick={() => onPick(kind)}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-2xl
              transition active:scale-90 active:bg-ink/10"
          >
            {REACTION_META[kind].emoji}
          </button>
        ))}
      </div>
      {/*
        连发做成开关而不是长按：长按在手机上容易和滚动、选中打架，
        而且没法先看清自己要扔什么。开着就一次扔十个。
      */}
      <button
        type="button"
        onClick={() => onBurstChange(!burst)}
        className={`mt-1 flex w-full items-center justify-center gap-1 rounded-lg py-1.5
          text-[0.7rem] transition
          ${burst ? "bg-gold text-ground font-semibold" : "text-ink-mute active:bg-ink/10"}`}
      >
        {burst ? "十连发 已开" : "十连发"}
      </button>
  </Panel>
);

/** 点自己头像发表情包 */
export const EmoteMenu = ({
  anchor,
  onPick,
  onClose,
}: {
  anchor: Anchor;
  onPick: (emoteId: string) => void;
  onClose: () => void;
}) => (
  <Panel anchor={anchor} onClose={onClose}>
      {/* items-start：每格从顶上排起，图标在同一条水平线上 */}
      <div className="grid max-w-[14.5rem] grid-cols-4 items-start gap-1">
        {EMOTES.map((e) => (
          <button
            key={e.id}
            type="button"
            aria-label={e.text}
            title={e.text}
            onClick={() => onPick(e.id)}
            className="flex flex-col items-center gap-1 rounded-xl p-1 transition
              active:scale-90 active:bg-ink/10"
          >
            <img
              src={`/art/roles/emotes/${e.art}.webp`}
              alt=""
              loading="lazy"
              className="h-11 w-11 rounded-lg object-cover"
              onError={(ev) => {
                // 图还没生成好时不至于裂开
                ev.currentTarget.style.visibility = "hidden";
              }}
            />
            {/*
              文字放两行，不截断 —— 「刺客你看我干嘛」截成「刺客你看…」就没梗了。
              高度写死成两行：短文案也占两行的位置，
              否则一行的和两行的挤在一起，图标会上下交错。
            */}
            <span
              className="flex h-[1.9rem] w-full items-start justify-center text-center
                text-[0.55rem] leading-[0.95rem] text-ink-mute"
            >
              {e.text}
            </span>
          </button>
        ))}
      </div>
  </Panel>
);

/**
 * 点浮层**外面**才关。
 *
 * 之前没判断点在哪儿：在捕获阶段收到 pointerdown 就关，
 * 于是点浮层自己的按钮时，浮层先被卸载，那个按钮的 onClick 永远轮不到 ——
 * 扔东西和发表情整个是哑的。
 */
const useOutsideClose = (
  ref: React.RefObject<HTMLElement | null>,
  onClose: () => void,
): void => {
  const armed = useRef(false);
  useEffect(() => {
    // 打开浮层的这一下点击还没走完，跳过一拍再开始监听
    const t = setTimeout(() => (armed.current = true), 0);
    const close = (e: PointerEvent) => {
      if (!armed.current) return;
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener("pointerdown", close, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", close, true);
    };
  }, [ref, onClose]);
};
