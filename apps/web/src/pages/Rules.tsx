/**
 * 规则页 + 角色图鉴。
 *
 * 这是**唯一允许滚动**的页面（CLAUDE.md 铁律 4 的例外）——
 * 规则本来就是长文，硬塞进一屏只会变成没人看的小字。
 *
 * 内容分两块：怎么打（流程 + 任务人数表）、都有谁（角色图鉴，带插画）。
 * 桌上有人问「保护轮是第几轮」「奥伯伦看得见谁」时能立刻翻到。
 */

import { useState } from "react";
import {
  LADY_MIN_PLAYERS,
  LANCELOT_MIN_PLAYERS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  REJECT_LIMIT,
  ROLES,
  ROLE_IDS,
  SETUP_LANCELOT,
  SETUP_STANDARD,
  TEAM_SIZE,
  isProtectedRound,
  type PlayerCount,
  type RoleId,
} from "@avalon/shared";
import { loadArtStyle } from "../lib/identity.js";
import { Button } from "../components/ui.js";

const COUNTS: readonly PlayerCount[] = [5, 6, 7, 8, 9, 10];

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-2">
    <h2 className="font-display text-lg text-gold">{title}</h2>
    <div className="space-y-2 text-sm leading-relaxed text-ink-soft">{children}</div>
  </section>
);

/** 一副牌里某一方的角色，数成「忠臣×2」这种给人看的形式 */
const tally = (deck: readonly RoleId[], side: "BLUE" | "RED"): string => {
  const counts = new Map<string, number>();
  for (const id of deck) {
    if (ROLES[id].side !== side) continue;
    counts.set(ROLES[id].name, (counts.get(ROLES[id].name) ?? 0) + 1);
  }
  return [...counts].map(([name, n]) => (n > 1 ? `${name}×${n}` : name)).join("、");
};

/**
 * 某个人数发什么牌。桌上问得最多的就是这个 ——
 * 「9 人有没有莫德雷德」不该要退出规则页去房间设置里翻。
 */
const SetupRow = ({ count, deck }: { count: PlayerCount; deck: readonly RoleId[] }) => {
  const blue = deck.filter((id) => ROLES[id].side === "BLUE").length;
  return (
    <div className="flex gap-2 border-t border-line py-1.5 first:border-t-0 first:pt-0">
      <span className="w-9 shrink-0 pt-0.5 text-xs tabular-nums text-ink-mute">{count}人</span>
      <div className="min-w-0 flex-1 space-y-0.5 text-xs leading-snug">
        <p>
          <span className="text-blue">蓝 {blue}</span>
          <span className="text-ink-mute"> · {tally(deck, "BLUE")}</span>
        </p>
        <p>
          <span className="text-red">红 {deck.length - blue}</span>
          <span className="text-ink-mute"> · {tally(deck, "RED")}</span>
        </p>
      </div>
    </div>
  );
};

/** 角色卡：插画 + 名字 + 一句话 + 详细说明 */
const RoleEntry = ({ id }: { id: RoleId }) => {
  const meta = ROLES[id];
  const detail = ROLE_DETAIL[id];
  return (
    <div className="flex gap-3 rounded-xl bg-surface-2 p-2.5">
      <img
        src={`/art/roles/${loadArtStyle()}/${meta.artId}.webp`}
        alt=""
        loading="lazy"
        className="h-20 w-20 shrink-0 rounded-lg object-cover"
      />
      <div className="min-w-0 flex-1">
        <p className={`font-display text-lg leading-none ${meta.side === "RED" ? "text-red" : "text-blue"}`}>
          {meta.name}
        </p>
        <p className="mt-1 text-[0.72rem] leading-snug text-ink-mute">{meta.tagline}</p>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">{detail}</p>
      </div>
    </div>
  );
};

/** 图鉴里的详细说明。身份卡上那句 tagline 是气氛，这里才是说明书 */
const ROLE_DETAIL: Record<RoleId, string> = {
  MERLIN: "能看见除莫德雷德以外的所有红方，但不知道谁是谁。你得给派西维尔递信号，又不能让刺客认出你 —— 三次任务成功后他会来找你。",
  PERCIVAL: "能看见梅林和莫甘娜两个人，但不知道哪个是哪个。你的任务是认出真梅林，并且帮他挡刀。",
  LOYAL_SERVANT: "没有任何情报，全靠听和推。任务牌只能出成功。",
  LANCELOT_BLUE: "开局没有视野。翻忠诚牌时可能和红兰斯洛特互换阵营，胜负按对局结束时你站的那一边算。在蓝方时只能出成功。",
  MORGANA: "红方的领头人，能看见除奥伯伦外的红方队友。派西维尔会把你和梅林一起看到 —— 装成梅林是你的本职。兰斯洛特模式下由你执行刺杀。",
  ASSASSIN: "能看见除奥伯伦外的红方队友。蓝方拿下三次任务后，由你指认梅林；指对了，红方翻盘。",
  MORDRED: "梅林看不见你。这意味着你可以毫无顾忌地混进车里 —— 蓝方没有任何情报能指向你。",
  OBERON: "你看不见队友，队友也看不见你，但梅林看得见你。孤军奋战，也容易被自己人误伤。",
  MINION: "普通红方，能看见除奥伯伦外的队友，也会被梅林看见。",
  LANCELOT_RED: "开局没有视野，但红方队友知道你是兰斯洛特，梅林也看得见你（只知道你是红方）。在红方时只能出失败 —— 上车就等于亮牌。",
};

export const Rules = ({ onClose }: { onClose: () => void }) => {
  const [tab, setTab] = useState<"flow" | "roles">("flow");

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
              ["flow", "怎么打"],
              ["roles", "角色图鉴"],
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

      {/* 规则页是长文，这里允许滚动 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 safe-bottom">
        {tab === "flow" ? (
          <div className="space-y-6">
            <Section title="一局是怎么回事">
              <p>
                桌上分<span className="text-blue">蓝方</span>和
                <span className="text-red">红方</span>，红方知道彼此是谁，蓝方不知道。
                一局打 5 轮任务。
              </p>
              <p>
                <span className="text-blue">蓝方赢</span>：3 次任务成功，并且最后梅林没被刺客认出来。
              </p>
              <p>
                <span className="text-red">红方赢</span>：3 次任务失败，或者同一轮连续
                {REJECT_LIMIT} 次没人上得了车，或者最后刺中梅林。
              </p>
            </Section>

            <Section title="每一轮的流程">
              <ol className="ml-4 list-decimal space-y-1.5">
                <li>
                  <span className="text-ink">队长选人上车</span> —— 选几个人由人数和轮次决定，可以选自己。
                </li>
                <li>
                  <span className="text-ink">线下发言</span> —— 队长定方向，大家依次说。网页不管这一步。
                </li>
                <li>
                  <span className="text-ink">全体投票</span> —— 赞成票<span className="text-ink">超过半数</span>才发车。没过就流局，队长顺延给下一位。
                </li>
                <li>
                  <span className="text-ink">车上的人做任务</span> —— 蓝方只能出成功，红方可以出失败。
                  牌是打乱的，只公开失败牌的数量。
                </li>
              </ol>
              <p className="text-ink-mute">
                同一轮里连续 {REJECT_LIMIT} 次没上车，红方直接赢 —— 一直不让发车不是策略，是送。
              </p>
            </Section>

            <Section title="每轮上几个人">
              <div className="overflow-x-auto rounded-xl bg-surface-2 p-2">
                <table className="w-full text-center text-xs tabular-nums">
                  <thead className="text-ink-mute">
                    <tr>
                      <th className="px-1 py-1 font-normal">人数</th>
                      {[1, 2, 3, 4, 5].map((r) => (
                        <th key={r} className="px-1 py-1 font-normal">
                          第{r}轮
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {COUNTS.map((n) => (
                      <tr key={n} className="border-t border-line">
                        <td className="px-1 py-1.5 text-ink-mute">{n}人</td>
                        {TEAM_SIZE[n].map((size, round) => (
                          <td key={round} className="px-1 py-1.5">
                            <span className={isProtectedRound(n, round) ? "text-gold" : ""}>
                              {size}
                              {isProtectedRound(n, round) ? "🛡" : ""}
                            </span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-ink-mute">
                <span className="text-gold">🛡 保护轮</span>：这一轮要
                <span className="text-ink">2 张失败牌</span>才算任务失败，1 张不算。
                只有 7–10 人局的第 4 轮有。
              </p>
            </Section>

            <Section title="扩展玩法">
              <p>
                <span className="text-ink">湖中女神</span>（{LADY_MIN_PLAYERS} 人及以上）——
                第 2、3、4 轮任务后，女神查一个人的阵营，只有她自己看得到结果。
                说真话还是假话，是她的事。被查的人接任下一代女神，当过的人不能再被查。
              </p>
              <p>
                <span className="text-ink">兰斯洛特</span>（{LANCELOT_MIN_PLAYERS} 人及以上）——
                两边各一个兰斯洛特，翻忠诚牌时可能互换阵营。视野在开局就冻结了，不会跟着换。
                这个模式里没有刺客，刺杀由莫甘娜执行。
              </p>
              <p>
                <span className="text-ink">提前刺杀</span> ——
                打完 2 次任务后，刺客可以随时发起刺杀，每局一次。刺中梅林红方赢，刺错当场输。
              </p>
            </Section>

            <Section title="几人局都有谁">
              <p className="text-ink-mute">
                {MIN_PLAYERS}–{MAX_PLAYERS} 人。房主在房间设置里选人数，牌自动按下表发。
              </p>

              <p className="pt-1 text-xs text-ink">标准局</p>
              <div className="rounded-xl bg-surface-2 px-3 py-2">
                {COUNTS.map((n) => (
                  <SetupRow key={n} count={n} deck={SETUP_STANDARD[n]} />
                ))}
              </div>

              <p className="pt-1 text-xs text-ink">兰斯洛特模式（{LANCELOT_MIN_PLAYERS} 人起）</p>
              <div className="rounded-xl bg-surface-2 px-3 py-2">
                {COUNTS.filter((n) => SETUP_LANCELOT[n]).map((n) => (
                  <SetupRow key={n} count={n} deck={SETUP_LANCELOT[n]!} />
                ))}
              </div>
              <p className="text-ink-mute">
                两边各一个兰斯洛特，顶掉标准局里的一个忠臣和刺客 ——
                所以这个模式没有刺客，刺杀归莫甘娜。
              </p>
            </Section>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <h2 className="font-display text-lg text-blue">蓝方</h2>
              {ROLE_IDS.filter((id) => ROLES[id].side === "BLUE").map((id) => (
                <RoleEntry key={id} id={id} />
              ))}
            </div>
            <div className="space-y-2">
              <h2 className="font-display text-lg text-red">红方</h2>
              {ROLE_IDS.filter((id) => ROLES[id].side === "RED").map((id) => (
                <RoleEntry key={id} id={id} />
              ))}
            </div>
          </div>
        )}

        <Button tone="ghost" className="mt-6 w-full" onClick={onClose}>
          返回
        </Button>
      </div>
    </div>
  );
};
