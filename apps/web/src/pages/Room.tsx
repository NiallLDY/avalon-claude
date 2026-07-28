/**
 * 房间等待页。选座 → 准备 → 房主开始。
 *
 * 选座是主动的：进房先在等待区，自己点一个和线下真实位置对应的号坐下。
 * 全部坐满且全部准备，房主才能开局。
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
  type PublicPlayer,
  type RoleId,
} from "@avalon/shared";
import { Avatar } from "../components/Avatar.js";
import { ProfileButton } from "../components/Profile.js";
import { SeatBoard } from "../components/SeatBoard.js";
import { Button, Latency, Segmented, Sheet, Toggle } from "../components/ui.js";
import { labeler } from "../lib/labels.js";
import { selfId, useStore } from "../store.js";

/** 当前人数会发到什么角色。「几人局」由房主设定，这里把牌面摊开给大家看 */
const RoleComposition = ({ count, mode }: { count: number; mode: GameSettings["mode"] }) => {
  const deck: readonly RoleId[] | undefined = !isValidPlayerCount(count)
    ? undefined
    : mode === "LANCELOT"
      ? SETUP_LANCELOT[count]
      : SETUP_STANDARD[count];

  if (!deck) {
    return (
      <p className="text-xs text-red">
        {mode === "LANCELOT" ? `兰斯洛特模式至少 ${LANCELOT_MIN_PLAYERS} 人` : "人数不对"}
      </p>
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
  const [sheet, setSheet] = useState<"settings" | "manage" | null>(null);
  const [swapMode, setSwapMode] = useState(false);
  const [manageTarget, setManageTarget] = useState<PublicPlayer | null>(null);
  const [confirmDissolve, setConfirmDissolve] = useState(false);
  if (!state) return null;

  const { room } = state;
  const host = room.hostId === selfId;
  const me = [...room.seats, ...room.standing].find((p) => p?.id === selfId) ?? null;
  const mySeat = me?.seat ?? null;
  const seated = mySeat !== null;
  const occupied = room.seats.filter((p): p is PublicPlayer => p !== null);
  const s = room.settings;
  const patch = (over: Partial<GameSettings>) => setSettings({ ...s, ...over });
  const who = labeler(room.seats);

  const swap = room.pendingSwap;
  const incomingSwap = swap?.toPlayerId === selfId ? swap : null;
  const outgoingSwap = swap?.fromPlayerId === selfId ? swap : null;
  const labelOf = (id: string) => {
    const seat = room.seats.findIndex((p) => p?.id === id);
    return seat >= 0 ? who.full(seat) : "某人";
  };

  const onSeatTap = (seat: number) => {
    const occupant = room.seats[seat];
    if (swapMode && occupant && occupant.id !== selfId) {
      emit("room:requestSwap", { targetPlayerId: occupant.id });
      setSwapMode(false);
      toast(`已向 ${who.full(seat)} 发出换座请求`);
      return;
    }
    if (host && occupant && occupant.id !== selfId) {
      setManageTarget(occupant);
      setSheet("manage");
      return;
    }
    if (!occupant) emit("room:sit", { seatIndex: seat });
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
          <div className="flex min-w-0 items-center justify-center gap-1.5">
            <p className="truncate text-sm">{room.name}</p>
            <Latency />
          </div>
          <p className="font-display text-lg tracking-[0.3em] text-gold">{room.id}</p>
        </div>
        <button
          type="button"
          onClick={() => useStore.getState().setRulesOpen(true)}
          className="rounded-lg px-2 py-1 text-sm text-ink-mute active:bg-surface"
        >
          规则
        </button>
        <button
          type="button"
          onClick={() => setSheet("settings")}
          className="rounded-lg px-2 py-1 text-sm text-ink-mute active:bg-surface"
        >
          设置
        </button>
        {/* 进了房就回不到大厅，改昵称头像的入口得在这儿也有一个 */}
        <ProfileButton />
      </header>

      <SeatBoard
        seats={room.seats}
        game={null}
        selfSeat={mySeat}
        emptySelectable={!swapMode}
        selectable={room.seats.flatMap((p, i) => (p && p.id !== selfId && (swapMode || host) ? [i] : []))}
        onSelect={onSeatTap}
      >
        {swapMode ? (
          <p className="text-sm text-gold">点一个人跟他换座</p>
        ) : seated ? (
          <>
            <p className="text-3xl font-bold tabular-nums text-gold">{mySeat + 1}号</p>
            <p className="mt-1 text-sm text-ink-soft">你的座位</p>
          </>
        ) : (
          <>
            <p className="text-lg font-medium">点一个空位坐下</p>
            <p className="mt-1 text-xs text-ink-mute">挑跟你线下位置对应的号</p>
          </>
        )}
      </SeatBoard>

      <footer className="shrink-0 space-y-2 px-4 pb-2">
        {incomingSwap ? (
          <div className="rounded-xl border border-gold/50 bg-gold/10 p-3">
            <p className="text-sm">
              <span className="text-gold">{labelOf(incomingSwap.fromPlayerId)}</span> 想和你换座位
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                tone="ghost"
                className="flex-1"
                onClick={() => emit("room:respondSwap", { accept: false })}
              >
                拒绝
              </Button>
              <Button className="flex-1" onClick={() => emit("room:respondSwap", { accept: true })}>
                同意换座
              </Button>
            </div>
          </div>
        ) : outgoingSwap ? (
          <p className="text-center text-xs text-gold">
            等 {labelOf(outgoingSwap.toPlayerId)} 回应换座请求…
          </p>
        ) : null}

        {room.standing.length > 0 ? (
          <div className="flex items-center gap-2 overflow-x-auto rounded-xl bg-surface px-3 py-2">
            <span className="shrink-0 text-[0.7rem] text-ink-mute">等待区</span>
            {room.standing.map((p) => (
              <span key={p.id} className="flex shrink-0 items-center gap-1">
                <Avatar avatar={p.avatar} size={22} dim={!p.connected} />
                <span className="text-[0.7rem] text-ink-mute">{p.nick}</span>
              </span>
            ))}
          </div>
        ) : null}

        <p className="text-center text-xs text-ink-mute">
          {room.startBlockedReason ?? `${occupied.length}/${room.seatCount} 就位，可以开始了`}
        </p>

        <div className="flex gap-2">
          {seated ? (
            <>
              <Button tone="ghost" className="flex-1" onClick={() => emit("room:stand")}>
                离座
              </Button>
              <Button
                tone={swapMode ? "gold" : "ghost"}
                className="flex-1"
                onClick={() => setSwapMode((v) => !v)}
              >
                {swapMode ? "取消" : "换座"}
              </Button>
              <Button
                tone={me?.ready ? "gold" : "blue"}
                className="flex-[1.4]"
                onClick={() => emit("room:ready", { ready: !me?.ready })}
              >
                {me?.ready ? "已准备" : "准备"}
              </Button>
            </>
          ) : (
            <p className="flex-1 self-center text-center text-sm text-ink-mute">点上面的空位入座</p>
          )}
        </div>

        {host ? (
          <Button className="w-full" disabled={!room.canStart} onClick={() => emit("game:start")}>
            开始游戏
          </Button>
        ) : null}
      </footer>

      <Sheet
        open={sheet === "manage"}
        onOpenChange={(o) => setSheet(o ? "manage" : null)}
        title={manageTarget ? `管理 ${manageTarget.nick}` : "管理"}
      >
        {manageTarget ? (
          <div className="space-y-2 pb-2">
            <Button
              tone="ghost"
              className="w-full"
              onClick={() => {
                emit("room:transferHost", { playerId: manageTarget.id });
                setSheet(null);
              }}
            >
              把房主给他
            </Button>
            <Button
              tone="red"
              className="w-full"
              onClick={() => {
                emit("room:kick", { playerId: manageTarget.id });
                setSheet(null);
              }}
            >
              请出房间
            </Button>
          </div>
        ) : null}
      </Sheet>

      <Sheet
        open={sheet === "settings"}
        onOpenChange={(o) => setSheet(o ? "settings" : null)}
        title="房间设置"
      >
        <div className="flex flex-col gap-4 pt-1 pb-2">
          <section className="rounded-xl bg-surface-2 p-3">
            <p className="mb-2 text-xs text-ink-mute">几人局</p>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => MIN_PLAYERS + i).map(
                (n) => (
                  <button
                    key={n}
                    type="button"
                    disabled={!host}
                    onClick={() => emit("room:seatCount", { seatCount: n })}
                    className={`min-h-9 w-9 rounded-lg text-sm tabular-nums transition
                      disabled:opacity-40
                      ${n === room.seatCount ? "bg-gold font-bold text-ground" : "bg-surface text-ink-soft"}`}
                  >
                    {n}
                  </button>
                ),
              )}
            </div>
            <RoleComposition count={room.seatCount} mode={s.mode} />
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
                room.seatCount < LADY_MIN_PLAYERS
                  ? `官方规则限 ${LADY_MIN_PLAYERS} 人及以上，现在 ${room.seatCount} 人`
                  : "第 2、3、4 轮任务后各查一个人的阵营"
              }
              checked={s.ladyOfTheLake}
              disabled={!host || (room.seatCount < LADY_MIN_PLAYERS && !s.ladyOfTheLake)}
              onChange={(ladyOfTheLake) => patch({ ladyOfTheLake })}
            />
            <Toggle
              label="提前刺杀"
              hint="打完 2 次任务后，刺客可以随时动手；刺错人红方当场输"
              checked={s.earlyAssassination}
              disabled={!host}
              onChange={(earlyAssassination) => patch({ earlyAssassination })}
            />
          </div>

          {s.mode === "LANCELOT" ? (
            <div className="space-y-3 rounded-xl bg-surface-2 p-3">
              <div>
                <p className="mb-2 text-xs text-ink-mute">忠诚牌什么时候翻</p>
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
                <p className="mb-2 text-xs text-ink-mute">换边的概率</p>
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
                label="不公开翻牌结果"
                hint="别人只知道翻了一张牌，兰斯洛特自己仍能看到现在站哪边"
                checked={s.hideLoyaltyFlipResult}
                disabled={!host}
                onChange={(hideLoyaltyFlipResult) => patch({ hideLoyaltyFlipResult })}
              />
            </div>
          ) : null}

          <div>
            <p className="mb-2 text-xs text-ink-mute">流局怎么算</p>
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
            <p className="mb-2 text-xs text-ink-mute">队长怎么轮</p>
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
            <div className="space-y-2 pt-2">
              <Button tone="ghost" className="w-full" onClick={() => emit("room:shuffleSeats")}>
                随机打乱座次
              </Button>
              {confirmDissolve ? (
                <div className="rounded-xl border border-red/50 bg-red/10 p-3">
                  <p className="mb-2 text-sm">解散之后房间就没了，所有人回大厅。</p>
                  <div className="flex gap-2">
                    <Button tone="ghost" className="flex-1" onClick={() => setConfirmDissolve(false)}>
                      算了
                    </Button>
                    <Button
                      tone="red"
                      className="flex-1"
                      onClick={() => {
                        emit("room:dissolve");
                        setConfirmDissolve(false);
                        setSheet(null);
                      }}
                    >
                      确认解散
                    </Button>
                  </div>
                </div>
              ) : (
                <Button tone="red" className="w-full" onClick={() => setConfirmDissolve(true)}>
                  解散房间
                </Button>
              )}
            </div>
          ) : null}
        </div>
      </Sheet>
    </div>
  );
};
