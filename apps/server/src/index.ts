/**
 * 服务端入口。单进程同时提供：静态资源 + REST + WebSocket。
 * 架构图见 PLAN.md §4。
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { Server as IOServer } from "socket.io";
import { roomOptionsSchema } from "@avalon/shared/schemas";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { createRegistry } from "./registry.js";
import { createStore } from "./store.js";
import { attachSocket } from "./socket.js";
import { roomSummary } from "./rooms.js";

const registry = createRegistry();
const store = createStore();

const app = Fastify({ loggerInstance: logger, trustProxy: config.trustProxy });

const clientIp = (req: { ip: string }): string => req.ip;

app.get("/api/health", async () => ({ ok: true, rooms: registry.size() }));

app.get("/api/rooms", async (req) => {
  const q = (req.query as Record<string, unknown>)["q"];
  return { rooms: registry.list(typeof q === "string" ? q : undefined) };
});

app.get<{ Params: { id: string } }>("/api/rooms/:id", async (req, reply) => {
  const room = registry.get(req.params.id.toUpperCase());
  if (!room) return reply.code(404).send({ error: "ROOM_NOT_FOUND" });
  return { room: roomSummary(room) };
});

app.post("/api/rooms", async (req, reply) => {
  const parsed = roomOptionsSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "INVALID_PAYLOAD", message: "房间参数不合法" });
  }
  const hostId = (req.headers["x-player-id"] as string | undefined) ?? "";
  if (!hostId) return reply.code(400).send({ error: "INVALID_PAYLOAD", message: "缺少身份" });

  const created = registry.create({
    ...parsed.data,
    hostId,
    ip: clientIp(req),
    now: Date.now(),
  });
  if (!created.ok) return reply.code(429).send({ error: "RATE_LIMITED", message: created.error });

  void store.saveNow(created.room);
  return { room: roomSummary(created.room) };
});

/** 终局战报，供复盘页看。Redis TTL 7 天 */
app.get<{ Params: { id: string } }>("/api/reports/:id", async (req, reply) => {
  const report = await store.loadReport(req.params.id.toUpperCase());
  if (!report) return reply.code(404).send({ error: "NOT_FOUND" });
  return report;
});

// 生产环境下由本进程直接发前端静态资源，省一个 nginx
const staticDir = config.staticDir || resolve(process.cwd(), "public");
if (existsSync(staticDir)) {
  await app.register(fastifyStatic, { root: staticDir, wildcard: false });
  // SPA 兜底：非 /api 的路径一律回 index.html，交给前端路由
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api")) return reply.code(404).send({ error: "NOT_FOUND" });
    return reply.sendFile("index.html");
  });
  logger.info({ staticDir }, "静态资源已挂载");
}

await app.ready();

// Socket.IO 直接挂在 Fastify 的 http server 上 —— 同一个端口同时服务 HTTP 与 WS，
// Caddy 那边一条 reverse_proxy 就够了，不用为 /ws 单独配路由
const io = new IOServer(app.server, {
  path: "/ws",
  // 手机场景：锁屏、切后台、Wi-Fi↔4G 切换极常见，心跳要能穿过 CF 的 100s 空闲超时
  pingInterval: 25_000,
  pingTimeout: 20_000,
  maxHttpBufferSize: config.maxPayloadBytes,
  // 生产环境同源，不需要 CORS；开发时 Vite 在另一个端口，得放开
  ...(config.env === "production" ? {} : { cors: { origin: true, credentials: true } }),
});

attachSocket(io, registry, store);

// 启动时把 Redis 里的快照捞回内存，让部署不打断正在进行的对局
const restored = await store.restoreAll();
for (const room of restored) registry.adopt(room);
if (restored.length > 0) logger.info({ count: restored.length }, "已从快照恢复房间");

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, "收到退出信号，正在保存快照");
  // 退出前把内存里的房间**立即**落盘，不等防抖
  await Promise.allSettled(registry.all().map((r) => store.saveNow(r)));
  await io.close();
  await app.close();
  await store.close();
  process.exit(0);
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void shutdown(signal));
}

await app.listen({ host: config.host, port: config.port });
logger.info({ host: config.host, port: config.port }, "Melbourne 阿瓦隆 服务端已启动");
