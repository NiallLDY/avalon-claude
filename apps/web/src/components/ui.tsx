/**
 * 手写的几个 UI 原语。没上完整组件库，是因为这个应用只需要
 * 按钮 / 底部抽屉 / 轻提示三样，而「单屏不滚动」的约束需要对布局有完全控制。
 */

import { Drawer } from "vaul";
import type { ReactNode } from "react";
import { useStore } from "../store.js";

type ButtonTone = "primary" | "blue" | "red" | "ghost" | "gold";

const TONE: Record<ButtonTone, string> = {
  primary: "bg-gold text-ground font-semibold active:bg-gold/85",
  blue: "bg-blue text-white font-semibold active:bg-blue/85",
  red: "bg-red text-white font-semibold active:bg-red/85",
  gold: "border border-gold/60 text-gold active:bg-gold/10",
  ghost: "border border-line text-ink-soft active:bg-surface-2",
};

export const Button = ({
  children,
  onClick,
  tone = "primary",
  disabled,
  className = "",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: ButtonTone;
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
}) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled}
    // 最小高度 3rem：拇指可达区，手机上低于 44px 的按钮很难点准
    className={`min-h-12 rounded-xl px-4 text-[0.95rem] transition
      disabled:opacity-40 disabled:pointer-events-none ${TONE[tone]} ${className}`}
  >
    {children}
  </button>
);

/**
 * 底部抽屉。铁律 4 的配套设施 —— 主界面放不下的东西全塞这里，
 * 而不是让主界面滚动。
 */
export const Sheet = ({
  trigger,
  title,
  children,
  open,
  onOpenChange,
}: {
  trigger?: ReactNode;
  title: string;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) => (
  // 受控/非受控都支持：没传 open 就不能显式传 undefined 进去（exactOptionalPropertyTypes）
  <Drawer.Root
    {...(open === undefined ? {} : { open })}
    {...(onOpenChange === undefined ? {} : { onOpenChange })}
  >
    {trigger ? <Drawer.Trigger asChild>{trigger}</Drawer.Trigger> : null}
    <Drawer.Portal>
      <Drawer.Overlay className="fixed inset-0 z-40 bg-black/60" />
      <Drawer.Content
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col
          rounded-t-2xl border-t border-line bg-surface outline-none"
      >
        <div className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-line" />
        <Drawer.Title className="px-5 pt-3 pb-2 text-base font-semibold">{title}</Drawer.Title>
        {/* 抽屉内部允许滚动 —— 铁律 4 管的是主界面 */}
        <div className="safe-bottom min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
      </Drawer.Content>
    </Drawer.Portal>
  </Drawer.Root>
);

export const Toasts = () => {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] safe-top flex flex-col items-center gap-2 p-3">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`max-w-[90vw] rounded-lg px-4 py-2 text-sm shadow-lg backdrop-blur
            ${t.tone === "error" ? "bg-red/90 text-white" : "bg-surface-2/95 text-ink"}`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
};

/**
 * 断线横幅。只在**曾经连上过又断了**时显示。
 * 首次连接中不显示 —— 否则每次刷新页面都会闪一下"连接断开"，那是误报。
 */
export const ConnectionBanner = () => {
  const conn = useStore((s) => s.conn);
  if (conn !== "reconnecting") return null;
  return (
    <div className="shrink-0 bg-red/20 py-1 text-center text-xs text-red">
      连接断开，正在重连…
    </div>
  );
};

/**
 * 延迟指示。一个小圆点 + 毫秒数，常驻在房间和对局的右上角。
 *
 * 三档阈值取自「线下发牌器」这个场景：所有人围着一张桌子，
 * 掉一张牌的延迟差几百毫秒没人察觉，真正要暴露的是「点了没反应」那一档。
 * 没有绿色就用蓝 —— 调色板里蓝本来就是正方阵营色。
 */
export const Latency = ({ className = "" }: { className?: string }) => {
  const rtt = useStore((s) => s.rtt);
  const conn = useStore((s) => s.conn);
  const dead = conn !== "connected" || rtt === null;

  const tone = dead ? "bg-ink-mute" : rtt <= 150 ? "bg-blue" : rtt <= 400 ? "bg-gold" : "bg-red";
  // 上限封死在三位数。四位数会把顶栏那一行挤换行，而且「1247 还是 2100」
  // 对玩家没有任何区别 —— 都是「卡到不能玩」
  const text = dead ? "--" : rtt >= 1000 ? "1s+" : `${rtt}ms`;

  return (
    <span
      className={`flex shrink-0 items-center gap-1 text-[0.6rem] leading-none whitespace-nowrap
        text-ink-mute tabular-nums ${className}`}
      aria-label="网络延迟"
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone}`} />
      {text}
    </span>
  );
};

export const Segmented = <T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { readonly value: T; readonly label: string }[];
  onChange: (value: T) => void;
}) => (
  <div className="flex gap-1 rounded-lg bg-surface-2 p-1">
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        onClick={() => onChange(o.value)}
        className={`min-h-9 flex-1 rounded-md px-2 text-sm transition
          ${o.value === value ? "bg-gold text-ground font-medium" : "text-ink-soft"}`}
      >
        {o.label}
      </button>
    ))}
  </div>
);

export const Toggle = ({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) => (
  <button
    type="button"
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className="flex w-full items-center justify-between gap-3 py-3 text-left disabled:opacity-40"
  >
    <span className="min-w-0">
      <span className="block text-sm">{label}</span>
      {hint ? <span className="block text-xs text-ink-mute">{hint}</span> : null}
    </span>
    <span
      className={`relative h-6 w-11 shrink-0 rounded-full transition
        ${checked ? "bg-gold" : "bg-line"}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all
          ${checked ? "left-[1.375rem]" : "left-0.5"}`}
      />
    </span>
  </button>
);
