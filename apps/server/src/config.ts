/**
 * 运行配置。全部可用环境变量覆盖，默认值对应「自有小服务器、朋友之间用」的场景。
 * 防滥用相关的数字见 PLAN.md §7。
 */

const num = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const str = (key: string, fallback: string): string => process.env[key] ?? fallback;

const MINUTE = 60_000;

export const config = {
  env: str("NODE_ENV", "development"),
  host: str("HOST", "0.0.0.0"),
  port: num("PORT", 3000),
  redisUrl: str("REDIS_URL", "redis://127.0.0.1:6379"),
  /** 生产环境下静态资源目录（前端构建产物） */
  staticDir: str("STATIC_DIR", ""),

  // ── 防滥用 ──
  /** 单 IP 建房频率 */
  roomCreatePerIp: num("ROOM_CREATE_PER_IP", 3),
  roomCreateWindowMs: num("ROOM_CREATE_WINDOW_MS", 10 * MINUTE),
  /** 单 IP 同时存在的房间数 */
  maxRoomsPerIp: num("MAX_ROOMS_PER_IP", 2),
  /** 全站房间上限 */
  maxRooms: num("MAX_ROOMS", 200),
  /** 单 IP socket 连接数 */
  maxSocketsPerIp: num("MAX_SOCKETS_PER_IP", 20),
  /** 单连接消息频率 */
  msgPerWindow: num("MSG_PER_WINDOW", 30),
  msgWindowMs: num("MSG_WINDOW_MS", 10_000),
  maxPayloadBytes: num("MAX_PAYLOAD_BYTES", 4096),

  // ── 生命周期 ──
  /** 全员离线多久后回收房间 */
  idleRoomMs: num("IDLE_ROOM_MS", 30 * MINUTE),
  /** 对局结束后多久回收 */
  finishedRoomMs: num("FINISHED_ROOM_MS", 120 * MINUTE),
  /** 房主掉线多久后自动移交给座位号最小的在线玩家 */
  hostTransferAfterMs: num("HOST_TRANSFER_AFTER_MS", MINUTE),
  /** GC 扫描间隔 */
  sweepIntervalMs: num("SWEEP_INTERVAL_MS", MINUTE),
  /** 房间快照写 Redis 的防抖间隔 */
  snapshotDebounceMs: num("SNAPSHOT_DEBOUNCE_MS", 2_000),
  /** 终局战报在 Redis 里的保留时长 */
  reportTtlSeconds: num("REPORT_TTL_SECONDS", 7 * 24 * 60 * 60),

  /** 留的开关：设了才启用 Cloudflare Turnstile 建房校验 */
  turnstileSecret: str("TURNSTILE_SECRET", ""),
  /** 反代后取真实 IP。自建 Caddy / cloudflared 都是可信前置 */
  trustProxy: str("TRUST_PROXY", "1") !== "0",
} as const;

export type Config = typeof config;
