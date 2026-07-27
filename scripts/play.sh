#!/usr/bin/env bash
# 一个人试玩用：把机器人放进你已经建好的房间，凑够人数。
#
#   ./scripts/play.sh ABC234       放 4 个（凑 5 人局）
#   ./scripts/play.sh ABC234 6     放 6 个（凑 7 人局，可以开湖中女神）
#
# 机器人只做最笨的决策（一律赞成、能出成功就出成功），目的是让流程跑起来。
# Ctrl-C 结束。这是开发/试玩工具，不属于应用本身。
set -euo pipefail
cd "$(dirname "$0")/.."

ROOM="${1:-}"
N="${2:-4}"
if [[ ! "$ROOM" =~ ^[A-HJ-NP-Z2-9]{6}$ ]]; then
  echo "用法: ./scripts/play.sh <房间码> [机器人数量]" >&2
  echo "房间码是房间页面顶部那 6 位。" >&2
  exit 1
fi

# 应用端口只绑在宿主机回环上，容器走 host-gateway 到不了 ——
# 直接把陪玩容器接进应用所在的 docker 网络，用服务名访问
NETWORK="$(docker compose ls --format json 2>/dev/null | grep -q '"Name":"avalon"' && echo avalon_default || echo "")"
if [[ -z "$NETWORK" ]]; then
  echo "没找到运行中的 avalon 编排，先 ./scripts/deploy.sh" >&2
  exit 1
fi

exec docker run --rm -it \
  --network "$NETWORK" \
  -v "$PWD:/app" -w /app \
  -e CI=true -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  node:24-bookworm-slim \
  sh -c "corepack enable >/dev/null 2>&1; node scripts/bots.mjs $ROOM $N --url http://app:3000"
