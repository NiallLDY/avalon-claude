#!/usr/bin/env bash
# 按当前指标口径，把玩家累计战绩从对局归档重算一遍。
#
#   ./scripts/rebuild-stats.sh
#
# 什么时候要跑：**改了 packages/engine/src/stats.ts 里的口径之后。**
# 战绩是归档那一刻算好、加进玩家档案的，改口径不会让老局的数字自己变。
#
# 只重写玩家档案和排行榜，**对局归档一个字节都不动** —— 那才是原始数据，
# 所以这条命令可以放心重复跑，跑几遍结果一样。
set -euo pipefail
cd "$(dirname "$0")/.."

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }

if ! docker compose ps --format json redis 2>/dev/null | grep -q '"State":"running"'; then
  log "redis 没在跑，先起来"
  docker compose up -d redis
fi

log "构建"
docker compose build app >/dev/null

log "重算（对局归档只读，不会被改）"
# 路径跟 Dockerfile 走：产物在 apps/server/dist，WORKDIR 是 /app。
# **不是 dist/** —— 那是开发容器里的相对路径，生产镜像里没有。
docker compose run --rm --no-deps app node apps/server/dist/rebuild-stats.js

log "完成。刷新排行榜页面即可看到新数字"
