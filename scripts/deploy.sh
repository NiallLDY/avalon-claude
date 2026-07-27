#!/usr/bin/env bash
# 服务器上的部署 / 更新。首次和后续都是这一条命令。
#
#   cd /srv/avalon && ./scripts/deploy.sh
#
# 没有数据库迁移 —— 无账号系统就没有用户表，房间状态本来就是短生命周期的
# （见 PLAN.md §2.2）。所以这个脚本只做：拉代码 → 构建 → 滚动重启 → 清垃圾。
set -euo pipefail
cd "$(dirname "$0")/.."

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }

if [[ -n "$(git status --porcelain)" ]]; then
  echo "工作区有未提交的改动，先处理掉再部署：" >&2
  git status --short >&2
  exit 1
fi

log "拉取最新代码"
git pull --ff-only

if [[ ! -f .env ]]; then
  log "没有 .env，从 .env.example 复制一份（全部是默认值，可后续再改）"
  cp .env.example .env
fi

log "构建镜像"
docker compose build

# 正在进行的对局靠 Redis 快照续命：容器收到 SIGTERM 会立即落盘，
# 新容器起来后从快照恢复。所以重启对玩家来说只是短暂断线重连。
log "滚动重启"
docker compose up -d --remove-orphans

log "等待健康检查"
for _ in $(seq 1 60); do
  status=$(docker compose ps --format json app | sed -n 's/.*"Health":"\([^"]*\)".*/\1/p' | head -1)
  [[ "$status" == "healthy" ]] && break
  sleep 2
done

if [[ "${status:-}" != "healthy" ]]; then
  echo "启动后健康检查没通过，最近日志：" >&2
  docker compose logs --tail=50 app >&2
  exit 1
fi

log "清理旧镜像"
docker image prune -f >/dev/null

log "完成。当前状态："
docker compose ps
