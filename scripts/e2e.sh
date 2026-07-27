#!/usr/bin/env bash
# 浏览器端到端测试。跑在一次性的服务端 + 前端预览实例上，不碰已部署的那套。
#
#   ./scripts/e2e.sh              全部
#   ./scripts/e2e.sh --headed     有头模式（需要本机 X）
#   ./scripts/e2e.sh -g 换座      只跑名字匹配的
set -euo pipefail
cd "$(dirname "$0")/.."

# playwright 官方镜像自带浏览器和依赖，省掉在容器里装浏览器那一堆系统库。
# 版本从 node_modules 里实际装的那个读，写死会在依赖升级后悄悄对不上，
# 报的错还是「Executable doesn't exist」这种看不出根因的。
PW_VERSION=$(node -p "require('./apps/web/node_modules/@playwright/test/package.json').version" 2>/dev/null || true)
if [[ -z "$PW_VERSION" ]]; then
  echo "读不到 @playwright/test 版本，先在容器里跑一次 pnpm install" >&2
  exit 1
fi
IMAGE="mcr.microsoft.com/playwright:v${PW_VERSION}-noble"
echo "使用镜像 $IMAGE"

exec docker run --rm -i \
  -v "$PWD:/app" -w /app \
  -e CI=1 \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e "PW_CONFIG=${PW_CONFIG:-}" \
  --add-host=host.docker.internal:host-gateway \
  "$IMAGE" bash -lc '
set -euo pipefail
corepack enable >/dev/null 2>&1

# 一次性 redis：e2e 不该污染开发或生产的数据
redis-server --port 7379 --save "" --appendonly no --daemonize yes 2>/dev/null || {
  apt-get update -qq && apt-get install -y -qq redis-server >/dev/null
  redis-server --port 7379 --save "" --appendonly no --daemonize yes
}

pnpm install --frozen-lockfile >/dev/null

# 前端构建产物由服务端直接发，跟生产同一条路径
pnpm --filter @avalon/web build >/dev/null
# 放宽防滥用限制：所有测试来自同一个 IP，生产的「3 个房/10 分钟」会把测试自己挡掉。
# 限流本身有独立的单测覆盖，e2e 不该在这上面打架。
REDIS_URL=redis://127.0.0.1:7379 PORT=4173 STATIC_DIR=/app/apps/web/dist \
  ROOM_CREATE_PER_IP=1000 MAX_ROOMS_PER_IP=1000 MSG_PER_WINDOW=1000 \
  pnpm --filter @avalon/server exec tsx src/index.ts > /tmp/e2e-server.log 2>&1 &

for i in $(seq 1 60); do
  sleep 0.5
  if node -e "fetch(\"http://127.0.0.1:4173/api/health\").then(()=>process.exit(0)).catch(()=>process.exit(1))" 2>/dev/null; then
    break
  fi
done

cd apps/web
pnpm exec playwright test ${PW_CONFIG:+--config "$PW_CONFIG"} "$@"
' -- "$@"
