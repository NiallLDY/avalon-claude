/**
 * 本地战绩。**存在这台手机的 localStorage 里，服务端一无所知。**
 *
 * 这不是偷懒，是这个项目没有账号系统的必然结果（铁律 6）：
 * 服务端不知道「你」是谁跨局的同一个人，只有这台手机知道自己的 playerId。
 * 要做跨设备的长期战绩榜就得先有账号和数据库，那是另一个产品。
 *
 * 服务端永久保留每局的完整战报。本地这份是「摘要 + 房间码」，
 * 想看逐轮明细就拿房间码去 `/api/reports/:id` 换。
 * 全站公开的排行榜和对局记录另有接口（/api/leaderboard、/api/matches）。
 */

import type { RoleId, Side, WinReason } from "@avalon/shared";

const KEY = "avalon.history.v1";
/** 只留最近这些局。手机 localStorage 就几 MB，别当数据库使 */
const MAX = 200;

export interface GameRecord {
  /** 去重用。同一局在刷新、重连后不该被记两次 */
  readonly id: string;
  /** 本机记录的完成时间 */
  readonly at: number;
  readonly roomId: string;
  readonly roomName: string;
  readonly playerCount: number;
  /** 我这一局的角色与**终局时**的阵营（兰斯洛特可能换过边） */
  readonly roleId: RoleId;
  readonly side: Side;
  readonly winner: Side;
  readonly won: boolean;
  readonly reason: WinReason;
}

const read = (): GameRecord[] => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as GameRecord[]) : [];
  } catch {
    // 存坏了就当没有，别让一条脏数据把整个大厅打不开
    return [];
  }
};

const write = (records: readonly GameRecord[]): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(records.slice(0, MAX)));
  } catch {
    // 配额满了就算了，战绩不值得为它报错
  }
};

export const loadHistory = (): readonly GameRecord[] => read();

export const clearHistory = (): void => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 同上 */
  }
};

/**
 * 记一局。**同一局重复调用是安全的** ——
 * 刷新页面、断线重连都会让客户端再次进入终局状态，
 * 不去重的话一局会被记好几次，胜率就成了假的。
 *
 * id 里带上 reveal（这一局的发牌结果）：同一个房间连打两局，
 * 房间码和结局原因都可能一样，但发到每个座位上的角色几乎不可能一样。
 */
export const recordGame = (r: Omit<GameRecord, "id" | "at"> & { readonly deal: string }): void => {
  const id = `${r.roomId}:${r.deal}:${r.reason}`;
  const records = read();
  if (records.some((x) => x.id === id)) return;

  const { deal: _deal, ...rest } = r;
  write([{ ...rest, id, at: Date.now() }, ...records]);
};

export interface HistoryStats {
  readonly total: number;
  readonly won: number;
  readonly asBlue: { readonly total: number; readonly won: number };
  readonly asRed: { readonly total: number; readonly won: number };
  /** 每个角色打过几局、赢过几局，按场次多的排前面 */
  readonly byRole: readonly { readonly roleId: RoleId; readonly total: number; readonly won: number }[];
}

export const summarize = (records: readonly GameRecord[]): HistoryStats => {
  const roles = new Map<RoleId, { total: number; won: number }>();
  let won = 0;
  const asBlue = { total: 0, won: 0 };
  const asRed = { total: 0, won: 0 };

  for (const r of records) {
    if (r.won) won += 1;
    const bucket = r.side === "BLUE" ? asBlue : asRed;
    bucket.total += 1;
    if (r.won) bucket.won += 1;

    const cur = roles.get(r.roleId) ?? { total: 0, won: 0 };
    cur.total += 1;
    if (r.won) cur.won += 1;
    roles.set(r.roleId, cur);
  }

  return {
    total: records.length,
    won,
    asBlue,
    asRed,
    byRole: [...roles]
      .map(([roleId, v]) => ({ roleId, ...v }))
      .sort((a, b) => b.total - a.total),
  };
};

/** 胜率，给人看的百分数。0 场时返回 null —— 「0%」会被误读成「打了很多但一场没赢」 */
export const winRate = (total: number, won: number): number | null =>
  total === 0 ? null : Math.round((won / total) * 100);
