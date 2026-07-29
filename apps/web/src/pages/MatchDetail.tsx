/**
 * 一局的完整复盘。
 *
 * 归档里存着逐轮的提名、每个人的票、任务结果和全员身份 ——
 * 之前页面上只画了阵容和几个任务圆点，等于把数据存了却不给看。
 *
 * 唯一**不存也不显示**的是每张任务牌是谁放的（GAME.md Q5）。
 * 那是这局留在桌上的悬案，永久档案里也不揭。
 */

import { ROLES, type RoleId } from "@avalon/shared";
import { Avatar } from "../components/Avatar.js";

export interface MatchSeat {
  seat: number;
  playerId: string;
  nick: string;
  avatar: { seed: string; bg: string };
  roleId: string;
  side: string;
  won: boolean;
}

export interface MatchRecord {
  id: string;
  roomName: string;
  finishedAt: number;
  playerCount: number;
  mode: string;
  outcome: { winner: string; reason: string; assassinatedSeat: number | null };
  seats: MatchSeat[];
  missions: {
    roundIndex: number;
    leaderSeat: number;
    team: number[];
    failCount: number;
    success: boolean;
  }[];
  proposals: {
    roundIndex: number;
    attempt: number;
    leaderSeat: number;
    team: number[];
    votes: boolean[];
    approved: boolean;
  }[];
}

const REASON: Record<string, string> = {
  MISSIONS_SUCCEEDED: "三次任务成功，梅林没被认出来",
  MISSIONS_FAILED: "三次任务失败",
  REJECT_LIMIT: "同一轮连续五次没上车",
  ASSASSINATION_HIT: "刺客认出了梅林",
  ASSASSINATION_MISS: "提前刺杀刺错了人，红方当场判负",
};

const roleName = (id: string): string => ROLES[id as RoleId]?.name ?? id;

/** 头像 + 号码，一行里要塞下十个人就得这么紧 */
const Chip = ({
  seat,
  seats,
  tone,
  mark,
  showNick = false,
}: {
  seat: number;
  seats: MatchSeat[];
  tone?: "blue" | "red" | "gold";
  mark?: string;
  showNick?: boolean;
}) => {
  const p = seats[seat];
  const bg =
    tone === "blue"
      ? "bg-blue/20 text-blue"
      : tone === "red"
        ? "bg-red/20 text-red"
        : tone === "gold"
          ? "bg-gold/20 text-gold"
          : "bg-surface text-ink-soft";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full py-0.5 pl-0.5 pr-1.5 ${bg}`}>
      {p ? <Avatar avatar={p.avatar} size={16} /> : null}
      <span className="text-[0.66rem] font-bold tabular-nums">{seat + 1}</span>
      {showNick && p ? (
        <span className="max-w-[3.5rem] truncate text-[0.6rem] opacity-80">{p.nick}</span>
      ) : null}
      {mark ? <span className="text-[0.66rem] font-bold">{mark}</span> : null}
    </span>
  );
};

export const MatchDetail = ({ match }: { match: MatchRecord }) => {
  const blueWon = match.outcome.winner === "BLUE";
  const rounds = [...new Set([
    ...match.proposals.map((p) => p.roundIndex),
    ...match.missions.map((m) => m.roundIndex),
  ])].sort((a, b) => a - b);

  return (
    <div className="space-y-3 border-t border-line p-3">
      {/* ── 结局 ── */}
      <section className="space-y-1">
        <p className="text-xs text-ink-mute">{REASON[match.outcome.reason] ?? match.outcome.reason}</p>
        {match.outcome.assassinatedSeat !== null ? (
          <p className="flex flex-wrap items-center gap-1 text-xs text-ink-mute">
            <span>刺客选择了</span>
            <Chip seat={match.outcome.assassinatedSeat} seats={match.seats} tone="red" showNick />
            <span>
              （{roleName(match.seats[match.outcome.assassinatedSeat]?.roleId ?? "")}）
            </span>
          </p>
        ) : null}
      </section>

      {/* ── 阵容 ── */}
      <section>
        <p className="mb-1.5 text-[0.7rem] text-ink-mute">阵容</p>
        <div className="grid grid-cols-2 gap-1">
          {match.seats.map((s) => (
            <span
              key={s.seat}
              className={`flex items-center gap-1.5 rounded-lg px-1.5 py-1
                ${s.side === "RED" ? "bg-red/10" : "bg-blue/10"}`}
            >
              <Avatar avatar={s.avatar} size={20} />
              <span className="text-[0.68rem] font-bold tabular-nums">{s.seat + 1}</span>
              <span className="min-w-0 flex-1 truncate text-[0.62rem] text-ink-mute">{s.nick}</span>
              <span
                className={`shrink-0 text-[0.62rem] ${s.side === "RED" ? "text-red" : "text-blue"}`}
              >
                {roleName(s.roleId)}
              </span>
              {s.won ? <span className="shrink-0 text-[0.6rem] text-gold">胜</span> : null}
            </span>
          ))}
        </div>
      </section>

      {/* ── 逐轮 ── */}
      {rounds.map((round) => {
        const mission = match.missions.find((m) => m.roundIndex === round);
        const proposals = match.proposals.filter((p) => p.roundIndex === round);
        return (
          <section key={round} className="rounded-lg bg-surface p-2">
            <header className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium">第 {round + 1} 轮</span>
              {mission ? (
                <span className={`text-[0.68rem] ${mission.success ? "text-blue" : "text-red"}`}>
                  {mission.success ? "任务成功" : "任务失败"} · {mission.failCount} 张失败牌
                </span>
              ) : (
                <span className="text-[0.68rem] text-ink-mute">没打成</span>
              )}
            </header>

            <ul className="space-y-1.5">
              {proposals.map((p) => (
                <li key={p.attempt} className="space-y-1">
                  <div className="flex flex-wrap items-center gap-1">
                    <span
                      className={`rounded px-1 py-0.5 text-[0.62rem]
                        ${p.approved ? "bg-blue/20 text-blue" : "bg-red/20 text-red"}`}
                    >
                      {p.approved ? "通过" : "否决"}
                    </span>
                    <span className="text-[0.62rem] text-ink-mute">队长</span>
                    <Chip seat={p.leaderSeat} seats={match.seats} tone="gold" showNick />
                    <span className="text-[0.62rem] text-ink-mute">带</span>
                    {p.team.map((t) => (
                      <Chip key={t} seat={t} seats={match.seats} />
                    ))}
                  </div>
                  {/* 每个人投了什么 —— 复盘时最想看的就是这一行 */}
                  <div className="flex flex-wrap gap-1">
                    {p.votes.map((yes, seat) => (
                      <Chip
                        key={seat}
                        seat={seat}
                        seats={match.seats}
                        tone={yes ? "blue" : "red"}
                        mark={yes ? "✓" : "✗"}
                      />
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <p className="text-center text-[0.62rem] text-ink-mute">
        谁放的失败牌不记录 —— 这局的悬案留在桌上
      </p>
      <p className="text-center text-[0.62rem] text-ink-mute">
        {blueWon ? "蓝方" : "红方"}获胜 · {match.playerCount} 人
        {match.mode === "LANCELOT" ? " · 兰斯洛特" : ""}
      </p>
    </div>
  );
};
