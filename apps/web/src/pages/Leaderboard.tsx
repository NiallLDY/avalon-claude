/**
 * 公开排行榜 + 对局详情。
 *
 * 和规则页一样是全屏浮层，**允许滚动**（铁律 4 的例外）。
 *
 * 每个指标都写了口径 —— 排行榜上一串没解释的百分比，没人知道是好是坏，
 * 更没人知道分母是什么。
 */

import { useEffect, useState } from "react";
import { Avatar } from "../components/Avatar.js";
import { Button } from "../components/ui.js";
import { MatchDetail, type MatchRecord } from "./MatchDetail.js";
import { selfId } from "../store.js";

interface Stats {
  games: number;
  wins: number;
  asBlue: number;
  blueWins: number;
  asRed: number;
  redWins: number;
  leaderApproved: number;
  leaderApprovedWithEvil: number;
  votedReject: number;
  votedRejectWithEvil: number;
  votedApprove: number;
  votedApproveWithEvil: number;
  assassinated: number;
  assassinatedHit: number;
  asMerlin: number;
  merlinSurvived: number;
}

interface PlayerRecord {
  id: string;
  nick: string;
  avatar: { seed: string; bg: string };
  stats: Stats;
}

const pct = (num: number, den: number): string =>
  den > 0 ? `${Math.round((num / den) * 100)}%` : "—";

/** 指标口径。写清楚分母，不然数字没法读 */
const METRICS: readonly {
  label: string;
  of: (s: Stats) => [number, number];
  hint: string;
}[] = [
  { label: "总胜率", of: (s) => [s.wins, s.games], hint: "赢的局 / 总局数" },
  { label: "蓝方胜率", of: (s) => [s.blueWins, s.asBlue], hint: "以终局阵营算" },
  { label: "红方胜率", of: (s) => [s.redWins, s.asRed], hint: "以终局阵营算" },
  {
    label: "带狼上车率",
    of: (s) => [s.leaderApprovedWithEvil, s.leaderApproved],
    hint: "你当队长、车通过了，车上有红方的比例。越低越会组队",
  },
  {
    label: "反对准确率",
    of: (s) => [s.votedRejectWithEvil, s.votedReject],
    hint: "你投反对的车里，确实有红方的比例。越高越准",
  },
  {
    label: "赞成失误率",
    of: (s) => [s.votedApproveWithEvil, s.votedApprove],
    hint: "你投赞成的车里，混了红方的比例。越低越好",
  },
  {
    label: "刺杀命中率",
    of: (s) => [s.assassinatedHit, s.assassinated],
    hint: "当刺客动手的局里，刺中梅林的比例",
  },
  {
    label: "梅林存活率",
    of: (s) => [s.merlinSurvived, s.asMerlin],
    hint: "当梅林、且蓝方拿满三次任务进了刺杀的局里，躲过一刀的比例",
  },
];

export const Leaderboard = ({ onClose }: { onClose: () => void }) => {
  const [tab, setTab] = useState<"rank" | "matches">("rank");
  const [players, setPlayers] = useState<PlayerRecord[]>([]);
  const [minGames, setMinGames] = useState(5);
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const [a, b] = await Promise.all([
        fetch("/api/leaderboard").then((r) => r.json()),
        fetch("/api/matches").then((r) => r.json()),
      ]);
      setPlayers(a.players ?? []);
      setMinGames(a.minGames ?? 5);
      setMatches(b.matches ?? []);
      setLoading(false);
    })().catch(() => setLoading(false));
  }, []);

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
        <div className="flex flex-1 justify-center gap-1 rounded-lg bg-surface-2 p-1">
          {(
            [
              ["rank", "排行榜"],
              ["matches", "对局记录"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`min-h-8 flex-1 rounded-md px-3 text-sm transition
                ${tab === key ? "bg-gold font-medium text-ground" : "text-ink-soft"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="w-12" />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 safe-bottom">
        {loading ? (
          <p className="py-10 text-center text-sm text-ink-mute">读取中…</p>
        ) : tab === "rank" ? (
          <div className="space-y-3">
            {players.length === 0 ? (
              <p className="py-10 text-center text-sm text-ink-mute">
                还没有人打满 {minGames} 局
              </p>
            ) : (
              players.map((p, i) => (
                <details
                  key={p.id}
                  className={`rounded-xl bg-surface-2 p-3 ${p.id === selfId ? "ring-1 ring-gold" : ""}`}
                >
                  <summary className="flex cursor-pointer list-none items-center gap-3">
                    <span
                      className={`w-6 shrink-0 text-center font-display text-lg tabular-nums
                        ${i < 3 ? "text-gold" : "text-ink-mute"}`}
                    >
                      {i + 1}
                    </span>
                    <Avatar avatar={p.avatar} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        {p.nick}
                        {p.id === selfId ? <span className="ml-1 text-xs text-gold">（你）</span> : null}
                      </span>
                      <span className="block text-[0.7rem] text-ink-mute">{p.stats.games} 局</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-display text-lg text-ink">
                        {pct(p.stats.wins, p.stats.games)}
                      </span>
                      <span className="block text-[0.65rem] text-ink-mute">胜率</span>
                    </span>
                  </summary>

                  <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3">
                    {METRICS.slice(1).map((m) => {
                      const [num, den] = m.of(p.stats);
                      return (
                        <div key={m.label} title={m.hint}>
                          <dt className="text-[0.68rem] text-ink-mute">{m.label}</dt>
                          <dd className="text-sm tabular-nums">
                            {pct(num, den)}
                            <span className="ml-1 text-[0.62rem] text-ink-mute">
                              {den > 0 ? `${num}/${den}` : ""}
                            </span>
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </details>
              ))
            )}

            <section className="space-y-1.5 rounded-xl bg-surface p-3 text-[0.7rem] leading-relaxed text-ink-mute">
              <p>上榜要打满 {minGames} 局。胜率相同时局数多的排前面。</p>
              {METRICS.slice(3).map((m) => (
                <p key={m.label}>
                  <span className="text-ink-soft">{m.label}</span> —— {m.hint}
                </p>
              ))}
              <p className="pt-1">
                没有账号系统，身份只记在这台手机上。清了浏览器数据或换设备，就会被当成新的人重新计数。
              </p>
            </section>
          </div>
        ) : (
          <div className="space-y-2">
            {matches.length === 0 ? (
              <p className="py-10 text-center text-sm text-ink-mute">还没有打完的对局</p>
            ) : (
              matches.map((m) => (
                <div key={m.id} className="rounded-xl bg-surface-2">
                  <button
                    type="button"
                    onClick={() => setOpen(open === m.id ? null : m.id)}
                    className="flex w-full items-center gap-3 p-3 text-left"
                  >
                    <span
                      className={`shrink-0 rounded px-2 py-1 text-[0.7rem]
                        ${m.outcome.winner === "BLUE" ? "bg-blue/20 text-blue" : "bg-red/20 text-red"}`}
                    >
                      {m.outcome.winner === "BLUE" ? "蓝胜" : "红胜"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{m.roomName}</span>
                      <span className="block text-[0.7rem] text-ink-mute">
                        {m.playerCount} 人 · {new Date(m.finishedAt).toLocaleString("zh-CN")}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-ink-mute">{open === m.id ? "收起" : "详情"}</span>
                  </button>

                  {open === m.id ? <MatchDetail match={m} /> : null}
                </div>
              ))
            )}
          </div>
        )}

        <Button tone="ghost" className="mt-6 w-full" onClick={onClose}>
          返回
        </Button>
      </div>
    </div>
  );
};
