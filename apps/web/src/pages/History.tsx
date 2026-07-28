/**
 * 战绩页。**数据全在这台手机上**（见 `lib/history.ts`）——
 * 没有账号系统就没有跨设备战绩，换手机等于从零开始，这一点页面上要写清楚，
 * 不然玩家会以为是数据丢了。
 *
 * 和规则页一样是全屏浮层，**只有它自己允许滚动**（铁律 4 的例外）。
 *
 * 点某一局能拉出那局的完整战报：服务端存着，但只留 7 天，
 * 过期就只剩本地这条摘要。
 */

import { useEffect, useState } from "react";
import { ROLES, type ClientGameView, type PublicPlayer, type WinReason } from "@avalon/shared";
import { Button } from "../components/ui.js";
import { Report } from "./Report.js";
import { clearHistory, loadHistory, summarize, winRate, type GameRecord } from "../lib/history.js";

const REASON: Record<WinReason, string> = {
  MISSIONS_SUCCEEDED: "三次任务成功",
  MISSIONS_FAILED: "三次任务失败",
  REJECT_LIMIT: "连续五次流局",
  ASSASSINATION_HIT: "刺客命中梅林",
  ASSASSINATION_MISS: "提前刺杀落空",
};

const day = (t: number): string => {
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** 一格统计。没打过时显示「—」而不是 0% */
const Stat = ({ label, total, won }: { label: string; total: number; won: number }) => {
  const rate = winRate(total, won);
  return (
    <div className="flex-1 rounded-xl bg-surface-2 px-2 py-2 text-center">
      <p className="text-[0.65rem] text-ink-mute">{label}</p>
      <p className="font-display text-xl leading-tight text-gold tabular-nums">
        {rate === null ? "—" : `${rate}%`}
      </p>
      <p className="text-[0.6rem] text-ink-mute tabular-nums">
        {total === 0 ? "没打过" : `${won}/${total}`}
      </p>
    </div>
  );
};

/** 某一局的完整战报。服务端只留 7 天，过期就没了 */
const OneReport = ({ record, onBack }: { record: GameRecord; onBack: () => void }) => {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "gone" }
    | { kind: "ok"; game: ClientGameView; seated: readonly (PublicPlayer | null)[] }
  >({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`/api/reports/${record.roomId}`);
        if (!res.ok) throw new Error("gone");
        const body = (await res.json()) as {
          game: ClientGameView | null;
          room?: { seats?: readonly (PublicPlayer | null)[] };
        };
        if (!alive) return;
        if (!body.game) {
          setState({ kind: "gone" });
          return;
        }
        setState({ kind: "ok", game: body.game, seated: body.room?.seats ?? [] });
      } catch {
        if (alive) setState({ kind: "gone" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [record.roomId]);

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="rounded-lg px-2 py-1 text-sm text-ink-mute active:bg-surface"
      >
        ← 回到战绩
      </button>
      <p className="text-xs text-ink-mute">
        {day(record.at)} · {record.roomName} · {record.roomId}
      </p>

      {state.kind === "loading" ? (
        <p className="py-8 text-center text-sm text-ink-mute">读取中…</p>
      ) : state.kind === "gone" ? (
        <div className="rounded-xl bg-surface-2 p-4 text-center">
          <p className="text-sm text-ink-soft">这局的详细战报已经过期了</p>
          <p className="mt-1 text-xs text-ink-mute">
            服务端只保留 7 天。上面这条摘要存在你手机里，不会过期。
          </p>
        </div>
      ) : (
        <Report game={state.game} seated={state.seated} />
      )}
    </div>
  );
};

export const History = ({ onClose }: { onClose: () => void }) => {
  const [records, setRecords] = useState(() => loadHistory());
  const [opened, setOpened] = useState<GameRecord | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const stats = summarize(records);

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-ground">
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2 safe-top">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-sm text-ink-mute active:bg-surface"
        >
          ← 返回
        </button>
        <p className="flex-1 text-center font-display text-lg text-gold">战绩</p>
        <span className="w-12" />
      </header>

      {/* 战绩是长列表，这里允许滚动 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 safe-bottom">
        {opened ? (
          <OneReport record={opened} onBack={() => setOpened(null)} />
        ) : records.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm text-ink-soft">还没有打完的对局</p>
            <p className="mt-2 text-xs text-ink-mute">打完一局就会记在这里</p>
          </div>
        ) : (
          <div className="space-y-5">
            <section className="space-y-2">
              <div className="flex gap-2">
                <Stat label="总胜率" total={stats.total} won={stats.won} />
                <Stat label="蓝方" total={stats.asBlue.total} won={stats.asBlue.won} />
                <Stat label="红方" total={stats.asRed.total} won={stats.asRed.won} />
              </div>
              <p className="text-[0.7rem] text-ink-mute">
                共 {stats.total} 局。<span className="text-ink-soft">只记在这台手机上</span> ——
                没有账号系统，换手机就从零开始。
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="font-display text-base text-gold">各角色</h2>
              <div className="space-y-1.5 rounded-xl bg-surface-2 p-3">
                {stats.byRole.map((r) => {
                  const rate = winRate(r.total, r.won);
                  const meta = ROLES[r.roleId];
                  return (
                    <div key={r.roleId} className="flex items-center gap-2 text-xs">
                      <span
                        className={`w-20 shrink-0 ${meta.side === "RED" ? "text-red" : "text-blue"}`}
                      >
                        {meta.name}
                      </span>
                      {/* 条形图比数字更快看出哪个角色打得好 */}
                      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-ground">
                        <span
                          className="block h-full rounded-full bg-gold"
                          style={{ width: `${rate ?? 0}%` }}
                        />
                      </span>
                      <span className="w-16 shrink-0 text-right text-ink-mute tabular-nums">
                        {rate}% · {r.total}局
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="space-y-2">
              <h2 className="font-display text-base text-gold">最近对局</h2>
              <div className="space-y-1.5">
                {records.map((r) => {
                  const meta = ROLES[r.roleId];
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setOpened(r)}
                      className="flex w-full items-center gap-2 rounded-xl bg-surface-2 px-3 py-2
                        text-left active:scale-[0.99]"
                    >
                      <span
                        className={`w-10 shrink-0 rounded px-1 py-0.5 text-center text-[0.7rem] font-bold
                          ${r.won ? "bg-gold text-ground" : "bg-surface text-ink-mute"}`}
                      >
                        {r.won ? "胜" : "负"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span
                            className={`text-sm ${meta.side === "RED" ? "text-red" : "text-blue"}`}
                          >
                            {meta.name}
                          </span>
                          <span className="text-[0.7rem] text-ink-mute tabular-nums">
                            {r.playerCount}人
                          </span>
                        </span>
                        <span className="block truncate text-[0.7rem] text-ink-mute">
                          {day(r.at)} · {REASON[r.reason]}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-ink-mute">›</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="pt-2">
              {confirmClear ? (
                <div className="flex gap-2">
                  <Button tone="ghost" className="flex-1" onClick={() => setConfirmClear(false)}>
                    取消
                  </Button>
                  <Button
                    tone="red"
                    className="flex-1"
                    onClick={() => {
                      clearHistory();
                      setRecords([]);
                      setConfirmClear(false);
                    }}
                  >
                    确认清空
                  </Button>
                </div>
              ) : (
                <Button
                  tone="ghost"
                  className="w-full text-xs"
                  onClick={() => setConfirmClear(true)}
                >
                  清空战绩
                </Button>
              )}
            </section>
          </div>
        )}

        <Button tone="ghost" className="mt-6 w-full" onClick={onClose}>
          返回
        </Button>
      </div>
    </div>
  );
};
