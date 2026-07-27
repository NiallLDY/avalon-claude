/**
 * 战报 / 复盘。逐轮投票明细都在这里 ——
 * 唯一**没有**也永远不会有的，是每张任务牌是谁出的（GAME.md Q5）。
 */

import type { ClientGameView, PublicPlayer } from "@avalon/shared";

export const Report = ({
  game,
  seated,
}: {
  game: ClientGameView;
  seated: readonly PublicPlayer[];
}) => {
  const nickOf = (seat: number) => seated[seat]?.nick ?? `${seat + 1} 号`;

  return (
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

            <ul className="space-y-1.5">
              {proposals.map((p) => (
                <li key={p.attempt} className="text-xs">
                  <div className="flex items-baseline gap-2">
                    <span className={p.approved ? "text-blue" : "text-red"}>
                      {p.approved ? "通过" : "否决"}
                    </span>
                    <span className="text-ink-mute">
                      队长 {nickOf(p.leaderSeat)} → {p.team.map(nickOf).join("、")}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-ink-mute">
                    {p.votes.map((approve, seat) => (
                      <span key={seat} className={approve ? "text-blue/80" : "text-red/80"}>
                        {nickOf(seat)}
                        {approve ? "✓" : "✗"}
                      </span>
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
          <ul className="space-y-1 text-xs text-ink-mute">
            {game.lady.checks.map((c, i) => (
              <li key={i}>
                第 {c.afterRoundIndex + 1} 轮后：{nickOf(c.holderSeat)} 查验了 {nickOf(c.targetSeat)}
                <span className="text-ink-mute">（结果只有查验人知道）</span>
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
        每张任务牌是谁出的，服务器不会告诉任何人 —— 包括现在
      </p>
    </div>
  );
};
