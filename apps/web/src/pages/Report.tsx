/**
 * 战报 / 复盘。逐轮投票明细都在这里 ——
 * 唯一**没有**也永远不会有的，是每张任务牌是谁出的（GAME.md Q5）。
 *
 * 全部用「头像 + 号码」列人：复盘时要快速把记录和桌上的人对上，
 * 纯文字名单在手机上做不到这件事。
 */

import type { ClientGameView, PublicPlayer } from "@avalon/shared";
import { PlayerChip, PlayerChips } from "../components/PlayerChip.js";

export const Report = ({
  game,
  seated,
}: {
  game: ClientGameView;
  seated: readonly PublicPlayer[];
}) => (
  <div className="space-y-4 pb-2 text-sm">
    {game.missions.length === 0 && game.proposals.length === 0 ? (
      <p className="py-6 text-center text-ink-mute">还没有可看的记录</p>
    ) : null}

    {[0, 1, 2, 3, 4].map((round) => {
      const mission = game.missions.find((m) => m.roundIndex === round);
      const proposals = game.proposals.filter((p) => p.roundIndex === round);
      if (!mission && proposals.length === 0) return null;

      return (
        <section key={round} className="rounded-xl bg-surface-2 p-3">
          <header className="mb-2 flex items-center justify-between">
            <h3 className="font-medium">第 {round + 1} 轮</h3>
            {mission ? (
              <span className={`text-xs ${mission.success ? "text-blue" : "text-red"}`}>
                {mission.success ? "成功" : "失败"} · {mission.failCount} 张失败牌
                {mission.failsRequired === 2 ? "（保护轮，需 2 张）" : ""}
              </span>
            ) : (
              <span className="text-xs text-ink-mute">进行中</span>
            )}
          </header>

          <ul className="space-y-3">
            {proposals.map((p) => (
              <li key={p.attempt} className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[0.68rem] ${
                      p.approved ? "bg-blue/20 text-blue" : "bg-red/20 text-red"
                    }`}
                  >
                    {p.approved ? "通过" : "否决"}
                  </span>
                  <span className="text-[0.68rem] text-ink-mute">队长</span>
                  <PlayerChip player={seated[p.leaderSeat]} seat={p.leaderSeat} tone="gold" />
                  <span className="text-[0.68rem] text-ink-mute">带</span>
                  <PlayerChips seated={seated} seats={p.team} showNick={false} />
                </div>

                {/* 投票明细：10 个人也要排得下，所以只放头像 + 号码 + 勾叉 */}
                <div className="flex flex-wrap gap-1">
                  {p.votes.map((approve, seat) => (
                    <PlayerChip
                      key={seat}
                      player={seated[seat]}
                      seat={seat}
                      tone={approve ? "blue" : "red"}
                      mark={approve ? "✓" : "✗"}
                      showNick={false}
                      size={18}
                    />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      );
    })}

    {game.lady && game.lady.checks.length > 0 ? (
      <section className="rounded-xl bg-surface-2 p-3">
        <h3 className="mb-2 font-medium">湖中女神</h3>
        <ul className="space-y-2">
          {game.lady.checks.map((c, i) => (
            <li key={i} className="flex flex-wrap items-center gap-1.5 text-[0.68rem] text-ink-mute">
              <span>第 {c.afterRoundIndex + 1} 轮后</span>
              <PlayerChip player={seated[c.holderSeat]} seat={c.holderSeat} tone="gold" />
              <span>查验了</span>
              <PlayerChip player={seated[c.targetSeat]} seat={c.targetSeat} />
              <span>（查到什么只有女神本人知道）</span>
            </li>
          ))}
        </ul>
      </section>
    ) : null}

    {game.loyalty && game.loyalty.flips.length > 0 ? (
      <section className="rounded-xl bg-surface-2 p-3">
        <h3 className="mb-2 font-medium">忠诚牌</h3>
        <ul className="space-y-1 text-xs text-ink-mute">
          {game.loyalty.flips.map((f, i) => (
            <li key={i}>
              {f.afterRoundIndex === null ? "开局" : `第 ${f.afterRoundIndex + 1} 轮后`}：
              {f.swapped === null ? "已翻开（结果隐藏）" : f.swapped ? "阵营转换" : "阵营不变"}
            </li>
          ))}
        </ul>
      </section>
    ) : null}

    <p className="pt-1 text-center text-[0.7rem] text-ink-mute">
      任务牌不记名。谁放的失败牌，只有他自己知道
    </p>
  </div>
);
