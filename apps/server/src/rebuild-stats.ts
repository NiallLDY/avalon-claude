/**
 * 按**当前**指标口径，把所有玩家的累计战绩从归档重算一遍。
 *
 *   ./scripts/rebuild-stats.sh
 *
 * 什么时候需要跑：**改了 `packages/engine/src/stats.ts` 里的口径之后。**
 * 战绩是归档那一刻算好、加进玩家档案的，档案里只留加总的数字 ——
 * 改口径不会让老局的数字自己变，只能拿归档重放。
 *
 * 安全性：
 * - **只重写玩家档案**（`avalon:rec:v1:player:*` 与排行榜 zset），
 *   对局归档本身一个字节都不动 —— 它才是原始数据。
 * - 幂等：整个重建而不是累加，跑几遍结果一样。
 * - 可以在服务运行时跑。最坏情况是重算期间刚好有一局结束，
 *   那一局被算两次；重跑一遍就正了。真在意就先 `docker compose stop app`。
 */

import Redis from "ioredis";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { createRecords } from "./records.js";

const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });

const records = createRecords(redis);

try {
  // 用 allPlayers 而不是 leaderboard —— 后者有「打满 5 局」的门槛，
  // 小圈子会一行差异都打不出来，看着就像没干活
  const before = await records.allPlayers();
  const { matches, players } = await records.rebuildStats();
  const after = await records.allPlayers();

  logger.info({ matches, players }, "重算完成");

  // 把变化打出来 —— 跑完看不见差异的话，没人知道它到底干了什么
  const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");
  let touched = 0;
  for (const a of after) {
    const b = before.find((x) => x.id === a.id);
    if (!b) {
      process.stdout.write(`${a.nick}（${a.stats.games} 局）新建档案\n`);
      touched++;
      continue;
    }
    const changed = (Object.keys(a.stats) as (keyof typeof a.stats)[]).filter(
      (k) => a.stats[k] !== b.stats[k],
    );
    if (changed.length === 0) continue;
    touched++;
    process.stdout.write(
      `${a.nick}（${a.stats.games} 局）\n` +
        changed.map((k) => `    ${k}: ${b.stats[k]} → ${a.stats[k]}`).join("\n") +
        `\n    梅林存活率 ${pct(b.stats.merlinSurvived, b.stats.asMerlin)}` +
        ` → ${pct(a.stats.merlinSurvived, a.stats.asMerlin)}\n`,
    );
  }
  // 说清楚「真的没有变化」，别让沉默看起来像没跑
  process.stdout.write(
    touched === 0
      ? `扫了 ${matches} 局 / ${after.length} 人，按当前口径算出来的数字和档案里原本的完全一致，无需改动。\n`
      : `共 ${touched} 人的数字有变化（扫了 ${matches} 局 / ${after.length} 人）。\n`,
  );
} catch (e) {
  logger.error({ err: String(e) }, "重算失败");
  process.exitCode = 1;
} finally {
  await redis.quit();
}
