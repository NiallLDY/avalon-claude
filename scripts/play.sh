#!/usr/bin/env bash
# 一个人试玩用：把机器人放进你已经建好的房间，凑够人数。
#
#   ./scripts/play.sh ABC234       放 4 个（凑 5 人局）
#   ./scripts/play.sh ABC234 6     放 6 个（凑 7 人局，可开湖中女神）
#
# 机器人只做最笨的决策，目的是让流程能跑起来。Ctrl-C 结束。
set -euo pipefail
cd "$(dirname "$0")/.."

ROOM="${1:-}"
N="${2:-4}"
if [[ -z "$ROOM" ]]; then
  echo "用法: ./scripts/play.sh <房间码> [机器人数量]" >&2
  exit 1
fi

exec docker compose -f compose.dev.yaml run --rm --no-deps -T \
  -e CI=true app sh -c "corepack enable >/dev/null 2>&1; \
    node scripts/bots.mjs $ROOM $N --url http://host.docker.internal:8787" \
  2>/dev/null || true
