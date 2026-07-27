/**
 * 房间等待页。环形座位 + 换座位 + 房主设置面板 + 开始按钮。
 */

import { useState } from "react";
import {
  LADY_MIN_PLAYERS,
  LANCELOT_MIN_PLAYERS,
  LOYALTY_SWAP_CHANCES,
  MAX_PLAYERS,
  MIN_PLAYERS,
  ROLES,
  SETUP_LANCELOT,
  SETUP_STANDARD,
  isValidPlayerCount,
  type GameSettings,
  type RoleId,
} from "@avalon/shared";
import { SeatRing } from "../components/SeatRing.js";
import { Button, Segmented, Sheet, Toggle } from "../components/ui.js";
import { selfId, useStore } from "../store.js";

/**
 * 当前人数会发到什么角色。
 * 「人数」本身不是一个可配置项 —— 阿瓦隆的人数就等于实际上桌的人数，
 * 但玩家需要知道这个人数对应什么牌面，所以把配置表直接摊开给他看。
 */
const RoleComposition = ({ count, mode }: { count: number; mode: GameSettings["mode"] }) => {
  if (!isValidPlayerCount(count)) {
    return (
      <p className="text-xs text-ink-mute">
        {count < MIN_PLAYERS
          ? `还差 ${MIN_PLAYERS - count} 人才能开局（${MIN_PLAYERS}–${MAX_PLAYERS} 人）`
          : `最多 ${MAX_PLAYERS} 人`}
      </p>
    );
  }
  const deck: readonly RoleId[] | undefined =
    mode === "LANCELOT" ? SETUP_LANCELOT[count] : SETUP_STANDARD[count];
  if (!deck) {
    return (
      <p className="text-xs text-red">兰斯洛特模式至少 {LANCELOT_MIN_PLAYERS} 人</p>
    );
  }

  const tally = (side: "BLUE" | "RED") => {
    const counts = new Map<string, number>();
    for (const id of deck) {
      if (ROLES[id].side !== side) continue;
      counts.set(ROLES[id].name, (counts.get(ROLES[id].name) ?? 0) + 1);
    }
    return [...counts].map(([name, n]) => (n > 1 ? `${name}×${n}` : name)).join("、");
  };

  return (
    <div className="space-y-1 text-xs">
      <p>
        <span className="text-blue">蓝方 {deck.filter((r) => ROLES[r].side === "BLUE").length}</span>
        <span className="text-ink-mute"> · {tally("BLUE")}</span>
      </p>
      <p>
        <span className="text-red">红方 {deck.filter((r) => ROLES[r].side === "RED").length}</span>
        <span className="text-ink-mute"> · {tally("RED")}</span>
      </p>
    </div>
  );
};

export const Room = () => {
  const { state, emit, setSettings, leaveRoom, toast } = useStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [swapMode, setSwapMode] = useState(false);
  if (!state) return null;

  const { room } = state;
  const host = room.hostId === selfId;
  const mySeat = room.seated.findIndex((p) => p.id === selfId);
  const seated = mySeat >= 0;
  const count = room.seated.length;
  const s = room.settings;
  const patch = (over: Partial<GameSettings>) => setSettings({ ...s, ...over });

  const swap = room.pendingSwap;
  const incomingSwap = swap?.toPlayerId === selfId ? swap : null;
  const outgoingSwap = swap?.fromPlayerId === selfId ? swap : null;
  const nickOf = (id: string) => room.seated.find((p) => p.id === id)?.nick ?? "某人";

  const requestSwap = (seat: number) => {
    const target = room.seated[seat];
    if (!target || target.id === selfId) return;
    emit("room:requestSwap", { targetPlayerId: target.id });
    setSwapMode(false);
    toast(`已向 ${target.nick} 发出换座请求`);
  };

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

      <SeatRing
        seated={room.seated}
        game={null}
        selectable={
          swapMode ? room.seated.map((_, i) => i).filter((i) => i !== mySeat) : []
        }
        onSelect={requestSwap}
      >
        {swapMode ? (
          <p className="text-sm text-gold">点一个人跟他换座</p>
        ) : (
          <>
            <p className="text-2xl font-medium">{count} 人</p>
            <p className="mt-1 text-xs text-ink-mute">
              {s.mode === "LANCELOT" ? "兰斯洛特" : "标准"}
              {s.ladyOfTheLake ? " · 湖中女神" : ""}
              {s.earlyAssassination ? " · 提前刺杀" : ""}
            </p>
          </>
        )}
      </SeatRing>

      <footer className="shrink-0 space-y-2 px-4 pb-2">
        {/* 换座请求：收到的要能一眼看到并处理 */}
        {incomingSwap ? (
          <div className="rounded-xl border border-gold/50 bg-gold/10 p-3">
            <p className="text-sm">
              <span className="text-gold">{nickOf(incomingSwap.fromPlayerId)}</span>
              （{incomingSwap.fromSeat + 1} 号）想和你换座位
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                tone="ghost"
                className="flex-1"
                onClick={() => emit("room:respondSwap", { accept: false })}
              >
                拒绝
              </Button>
              <Button
                className="flex-1"
                onClick={() => emit("room:respondSwap", { accept: true })}
              >
                同意换座
              </Button>
            </div>
          </div>
        ) : outgoingSwap ? (
          <p className="text-center text-xs text-gold">
            等 {nickOf(outgoingSwap.toPlayerId)} 回应换座请求…
          </p>
        ) : null}

        {room.spectators.length > 0 ? (
          <p className="text-center text-xs text-ink-mute">{room.spectators.length} 人观战</p>
        ) : null}

        {room.startBlockedReason ? (
          <p className="text-center text-xs text-ink-mute">{room.startBlockedReason}</p>
        ) : null}

        <div className="flex gap-2">
          {seated ? (
            <Button
              tone={swapMode ? "gold" : "ghost"}
              className="flex-1"
              onClick={() => setSwapMode((v) => !v)}
            >
              {swapMode ? "取消" : "换座位"}
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
        <div className="flex flex-col gap-4 pt-1 pb-2">
          {/* 人数不是配置项，但要让人看清当前人数发什么牌 */}
          <section className="rounded-xl bg-surface-2 p-3">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-sm font-medium">{count} 人局</span>
              <span className="text-[0.7rem] text-ink-mute">人数 = 实际入座人数</span>
            </div>
            <RoleComposition count={count} mode={s.mode} />
          </section>

          {!host ? (
            <p className="text-xs text-ink-mute">只有房主能改设置，以下是当前配置。</p>
          ) : null}

          <div>
            <p className="mb-2 text-xs text-ink-mute">模式</p>
            <Segmented
              value={s.mode}
              onChange={(mode) => host && patch({ mode })}
              options={[
                { value: "STANDARD", label: "标准" },
                { value: "LANCELOT", label: `兰斯洛特（${LANCELOT_MIN_PLAYERS}人+）` },
              ]}
            />
          </div>

          <div className="divide-y divide-line">
            <Toggle
              label="湖中女神"
              hint={
                count < LADY_MIN_PLAYERS
                  ? `官方规则限 ${LADY_MIN_PLAYERS} 人及以上，当前 ${count} 人`
                  : "第 2、3、4 轮任务后各查验一次阵营"
              }
              checked={s.ladyOfTheLake}
              // 人数不足时不许开，但**已开启的必须还能关** ——
              // 否则有人离座后房间会卡在「开不了局又关不掉」
              disabled={!host || (count < LADY_MIN_PLAYERS && !s.ladyOfTheLake)}
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
            <Button tone="ghost" onClick={() => emit("room:shuffleSeats")}>
              打乱座次
            </Button>
          ) : null}
        </div>
      </Sheet>
    </div>
  );
};
