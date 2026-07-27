/**
 * 限流。纯内存滑动窗口 —— 单实例部署，不需要 Redis 协调。
 * 时间由调用方注入，测试里能直接推时钟而不用 sleep。
 */

export interface RateLimiter {
  /** 消费一次配额。返回 false 表示超限 */
  hit(key: string, now: number): boolean;
  /** 当前窗口内已用次数 */
  count(key: string, now: number): number;
  /** 清掉过期窗口，GC 时调 */
  sweep(now: number): void;
}

export const createRateLimiter = (limit: number, windowMs: number): RateLimiter => {
  const hits = new Map<string, number[]>();

  const prune = (key: string, now: number): number[] => {
    const cutoff = now - windowMs;
    const kept = (hits.get(key) ?? []).filter((t) => t > cutoff);
    if (kept.length === 0) hits.delete(key);
    else hits.set(key, kept);
    return kept;
  };

  return {
    hit(key, now) {
      const kept = prune(key, now);
      if (kept.length >= limit) return false;
      kept.push(now);
      hits.set(key, kept);
      return true;
    },
    count: (key, now) => prune(key, now).length,
    sweep(now) {
      for (const key of [...hits.keys()]) prune(key, now);
    },
  };
};

/** 计数器：管「同时存在多少个」，不是频率 */
export const createCounter = () => {
  const counts = new Map<string, number>();
  return {
    get: (key: string): number => counts.get(key) ?? 0,
    inc(key: string): number {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    },
    dec(key: string): number {
      const next = Math.max(0, (counts.get(key) ?? 0) - 1);
      if (next === 0) counts.delete(key);
      else counts.set(key, next);
      return next;
    },
  };
};
