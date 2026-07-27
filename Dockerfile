# 多阶段构建：产出一个同时提供 静态资源 + API + WebSocket 的单镜像。
#
# 不用 alpine 而用 bookworm-slim：与开发容器同为 glibc，
# 少一类「本地跑得好好的、镜像里预编译二进制挂了」的问题。体积差 ~40MB，在自有服务器上无所谓。

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# ── 依赖层：只拷 manifest，改代码不会让 pnpm install 缓存失效 ──
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
# 不挂 BuildKit cache mount 存 pnpm store：store 在缓存挂载上时，
# pnpm 从 store 硬链接到 node_modules 会退化成跨文件系统拷贝，偶发 ENOENT。
# 上面按 manifest 分层已经拿到了主要的缓存收益，够用。
RUN pnpm install --frozen-lockfile

# ── 构建层 ──
FROM deps AS build
COPY . .
# web: vite build（prebuild 会把 assets/roles 同步进 public）
# server: tsup 把 @avalon/* 内联进单文件，运行层就不需要 packages/ 了
RUN pnpm --filter @avalon/web build && pnpm --filter @avalon/server build

# ── 运行层：只装 server 的生产依赖 ──
FROM base AS runtime
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 STATIC_DIR=/app/public

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --prod --filter @avalon/server \
    && pnpm store prune

# 产物必须放在它在 workspace 里的原位置：pnpm 用隔离式 node_modules，
# 依赖软链在 apps/server/node_modules 下，产物挪到 /app/dist 就解析不到 fastify 了
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./public

# 别用 root 跑
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/server/dist/index.js"]
