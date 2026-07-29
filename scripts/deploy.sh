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

# ── 清理 ──
# 不清的话磁盘是单调增长的：实测跑几十次构建后，构建缓存到了 7.6GB。
log "清理构建残留"

# 1) 悬空镜像：上一版 avalon-app 被新构建顶掉之后成了无 tag 的，只有这些该删。
#
#    **不要加 -a** —— 那会把 node、redis、playwright 那个 3.7GB 的测试镜像一起删掉。
#    它们只是「此刻没有容器在跑」，不是没用，删了下次还得重下。
#
#    这条在**用 containerd snapshotter 的机器上永远回收 0**：那种存储下重建同名 tag
#    不留悬空镜像，旧内容由 containerd 自己 GC。传统 overlay2 镜像存储上它才有用 ——
#    看到它常年是 0 别急着删，换台机器就需要了。
freed_img=$(docker image prune -f | awk -F': ' '/Total reclaimed/ {print $2}')

# 2) 构建缓存 —— **真正一直涨的是这块**，实测跑几十次构建后到了 7.6GB，
#    这一条清掉了其中 1.6GB。
#    默认参数只清已经悬空的层，当前构建图还在用的活缓存留着，下次构建照样是增量的。
#    （试过 --max-used-space，docker 29 下它一个字节都不清，文档和行为对不上，别用。）
freed_cache=$(docker builder prune -f | awk -F': ' '/^Total:/ {print $2}')

log "回收：镜像 ${freed_img:-0B} · 构建缓存 ${freed_cache:-0B}"

# 磁盘真的紧张时再上这个：连活缓存一起清，代价是下次构建从头跑一遍
if [[ "${DEEP_CLEAN:-0}" == "1" ]]; then
  log "深度清理（下次构建会变慢）"
  docker builder prune -af | awk -F': ' '/^Total:/ {print "    再回收 " $2}'
fi

docker system df | sed 's/^/    /'

log "完成。当前状态："
docker compose ps
