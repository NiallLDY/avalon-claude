/**
 * 房间等待页。环形座位 + 房主设置面板 + 开始按钮。
 */

import { useState } from "react";
import { LOYALTY_SWAP_CHANCES, type GameSettings } from "@avalon/shared";
import { SeatRing } from "../components/SeatRing.js";
import { Button, Segmented, Sheet, Toggle } from "../components/ui.js";
import { selfId, useStore } from "../store.js";

export const Room = () => {
  const { state, emit, setSettings, leaveRoom } = useStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  if (!state) return null;

  const { room } = state;
  const host = room.hostId === selfId;
  const seated = room.seated.some((p) => p.id === selfId);
  const s = room.settings;
  const patch = (over: Partial<GameSettings>) => setSettings({ ...s, ...over });

  return (
    <div className="flex h-full min-h-0 flex-col safe-top safe-bottom">
      <header className="flex shrink-0 items-center gap-2 px-4 py-2">
        <button
          type="button"
          onClick={leaveRoom}
          className="rounded-lg px-2 py-1 text-sm text-ink-mute active:bg-surface"
        >
          ← 退出
        </button>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-sm">{room.name}</p>
          <p className="font-display text-lg tracking-[0.3em] text-gold">{room.id}</p>
        </div>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="rounded-lg px-2 py-1 text-sm text-ink-mute active:bg-surface"
        >
          设置
        </button>
      </header>

      <SeatRing seated={room.seated} game={null}>
        <p className="text-sm text-ink-mute">{room.seated.length} 人已入座</p>
        <p className="mt-1 text-xs text-ink-mute">
          {s.mode === "LANCELOT" ? "兰斯洛特" : "标准"}
          {s.ladyOfTheLake ? " · 湖中女神" : ""}
          {s.earlyAssassination ? " · 提前刺杀" : ""}
        </p>
      </SeatRing>

      <footer className="shrink-0 space-y-2 px-4 pb-2">
        {room.spectators.length > 0 ? (
          <p className="text-center text-xs text-ink-mute">
            {room.spectators.length} 人观战
          </p>
        ) : null}

        {room.startBlockedReason ? (
          <p className="text-center text-xs text-ink-mute">{room.startBlockedReason}</p>
        ) : null}

        <div className="flex gap-2">
          {seated ? (
            <Button tone="ghost" className="flex-1" onClick={() => emit("room:stand")}>
              离座旁观
            </Button>
          ) : (
            <Button tone="ghost" className="flex-1" onClick={() => emit("room:sit")}>
              入座
            </Button>
          )}
          {host ? (
            <Button
              className="flex-[2]"
              disabled={!room.canStart}
              onClick={() => emit("game:start")}
            >
              开始游戏
            </Button>
          ) : (
            <div className="flex-[2] self-center text-center text-sm text-ink-mute">
              等房主开始
            </div>
          )}
        </div>
      </footer>

      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen} title="房间设置">
        {!host ? (
          <p className="pb-4 text-sm text-ink-mute">只有房主能改设置。当前配置：</p>
        ) : null}

        <div className="flex flex-col gap-4 pt-1">
          <div>
            <p className="mb-2 text-xs text-ink-mute">模式</p>
            <Segmented
              value={s.mode}
              onChange={(mode) => host && patch({ mode })}
              options={[
                { value: "STANDARD", label: "标准" },
                { value: "LANCELOT", label: "兰斯洛特（7人+）" },
              ]}
            />
          </div>

          <div className="divide-y divide-line">
            <Toggle
              label="湖中女神"
              hint="第 2、3、4 轮任务后各查验一次阵营"
              checked={s.ladyOfTheLake}
              disabled={!host}
              onChange={(ladyOfTheLake) => patch({ ladyOfTheLake })}
            />
            <Toggle
              label="提前刺杀"
              hint="完成 2 次任务后，刺客可主动发起刺杀；失败红方立即判负"
              checked={s.earlyAssassination}
              disabled={!host}
              onChange={(earlyAssassination) => patch({ earlyAssassination })}
            />
          </div>

          {s.mode === "LANCELOT" ? (
            <div className="space-y-3 rounded-xl bg-surface-2 p-3">
              <div>
                <p className="mb-2 text-xs text-ink-mute">忠诚牌翻牌时机</p>
                <Segmented
                  value={s.loyaltyFlipTiming}
                  onChange={(loyaltyFlipTiming) => host && patch({ loyaltyFlipTiming })}
                  options={[
                    { value: "NORMAL", label: "常规（3 张）" },
                    { value: "OPENING", label: "开局（5 张）" },
                  ]}
                />
              </div>
              <div>
                <p className="mb-2 text-xs text-ink-mute">阵营转换牌概率</p>
                <Segmented
                  value={String(s.loyaltySwapChance)}
                  onChange={(v) => host && patch({ loyaltySwapChance: Number(v) })}
                  options={LOYALTY_SWAP_CHANCES.map((c) => ({
                    value: String(c),
                    label: `${Math.round(c * 100)}%`,
                  }))}
                />
              </div>
              <Toggle
                label="隐藏翻牌结果"
                hint="全体只知道翻了一张；兰斯洛特本人始终能看到自己的当前阵营"
                checked={s.hideLoyaltyFlipResult}
                disabled={!host}
                onChange={(hideLoyaltyFlipResult) => patch({ hideLoyaltyFlipResult })}
              />
            </div>
          ) : null}

          <div>
            <p className="mb-2 text-xs text-ink-mute">流局计数</p>
            <Segmented
              value={s.rejectCounting}
              onChange={(rejectCounting) => host && patch({ rejectCounting })}
              options={[
                { value: "PER_ROUND", label: "轮内连续（官方）" },
                { value: "GLOBAL", label: "全局累计" },
              ]}
            />
          </div>

          <div>
            <p className="mb-2 text-xs text-ink-mute">队长轮转</p>
            <Segmented
              value={s.leaderRotation}
              onChange={(leaderRotation) => host && patch({ leaderRotation })}
              options={[
                { value: "CLOCKWISE", label: "顺位" },
                { value: "RANDOM", label: "全随机" },
              ]}
            />
          </div>

          {host ? (
            <div className="flex gap-2 pt-2">
              <Button tone="ghost" className="flex-1" onClick={() => emit("room:shuffleSeats")}>
                打乱座次
              </Button>
            </div>
          ) : null}
        </div>
      </Sheet>
    </div>
  );
};
