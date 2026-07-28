#!/usr/bin/env bash
# 换一台服务器。
#
#   旧机：./scripts/migrate.sh export ./avalon-backup.tar.gz
#   新机：./scripts/migrate.sh import ./avalon-backup.tar.gz
#
# ── 要搬的东西只有三样 ──
#   1. Redis 里的房间快照与战报（唯一的服务端状态，没有数据库、没有上传文件）
#   2. .env（不进 git，新机没有就跑默认值，防滥用参数会跟你现在不一样）
#   3. 代码版本（记下 commit，新机构建同一份，免得快照结构对不上）
#
# ── 玩家身份**不在服务端** ──
#   playerId + token 存在每台手机的 localStorage 里，按 origin 隔离。
#   所以只要**域名不变**，迁移对玩家是无感的：座位、房主身份、进行中的对局都还在。
#   **换域名 = 所有人变成新玩家**，这跟换不换服务器没关系，是唯一真会「丢用户」的操作。
#
# ── 为什么必须先停 app 再导 Redis ──
#   房间的真相在内存里，写 Redis 有 2 秒防抖（config.snapshotDebounceMs）。
#   app 收到 SIGTERM 会把所有房间**立刻**落盘（apps/server/src/index.ts）。
#   反过来先导后停，丢的就是最后那几秒 —— 正好是最可能有人在操作的几秒。
set -euo pipefail
cd "$(dirname "$0")/.."

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

cmd=${1:-}
file=${2:-}
force=${3:-}

case "$cmd" in
  export)
    [[ -n "$file" ]] || die "用法：./scripts/migrate.sh export ./avalon-backup.tar.gz"

    log "停 app —— 它收到 SIGTERM 会把内存里的房间立刻落盘"
    docker compose stop app

    log "让 Redis 同步落一次盘"
    docker compose exec -T redis redis-cli SAVE >/dev/null

    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT

    log "打包 Redis 数据目录（RDB + AOF 一起搬，免得两者谁优先的问题）"
    docker compose cp redis:/data "$tmp/redis-data"

    if [[ -f .env ]]; then
      cp .env "$tmp/env"
      log "带上 .env"
    else
      log "没有 .env，新机将使用默认参数"
    fi

    git rev-parse HEAD > "$tmp/commit"
    date -u +"%Y-%m-%dT%H:%M:%SZ" > "$tmp/exported-at"

    tar -czf "$file" -C "$tmp" .
    log "导出完成：$file（$(du -h "$file" | cut -f1)），代码版本 $(cat "$tmp/commit" | cut -c1-7)"

    cat <<'TIP'

app 现在还停着，旧机没有在服务。接下来：
  1. 把备份传到新机          scp <备份> 新机:/srv/avalon/
  2. 新机 git clone 同一个仓库并 checkout 到备份里的 commit
  3. 新机执行                ./scripts/migrate.sh import <备份>
  4. 确认新机能打开、能进房后，再把入口切过去（见下）
  5. 旧机收摊                docker compose down

入口切换：
  - 用 Cloudflare Tunnel 的话，把同一个 tunnel token 在新机跑起来、旧机停掉即可，
    **不用等 DNS 生效**。这是隧道方案在迁移上唯一的好处。
  - 用 DNS A 记录直连的话，提前把 TTL 调到 60 秒，切换当天再改指向。

要回滚（新机没弄好，先让旧机继续服务）：docker compose start app
TIP
    ;;

  import)
    [[ -n "$file" && -f "$file" ]] || die "用法：./scripts/migrate.sh import ./avalon-backup.tar.gz"

    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT
    tar -xzf "$file" -C "$tmp"

    want=$(cat "$tmp/commit" 2>/dev/null || echo "")
    here=$(git rev-parse HEAD)
    if [[ -n "$want" && "$want" != "$here" ]]; then
      log "备份来自 ${want:0:7}，本机是 ${here:0:7}"
      log "快照结构和代码版本是绑定的，建议先 git checkout $want 再导入"
      [[ "$force" == "--force" ]] || die "版本不一致。确认没问题就加 --force 重试"
    fi

    # 先把 redis 拉起来一次，让 compose 建好卷
    docker compose up -d redis
    docker compose exec -T redis redis-cli ping >/dev/null

    existing=$(docker compose exec -T redis redis-cli DBSIZE | tr -d '[:space:]')
    if [[ "$existing" != "0" ]]; then
      log "本机 Redis 里已经有 $existing 个键，导入会**整个覆盖**它们"
      [[ "$force" == "--force" ]] || die "怕误伤，先确认。确认要覆盖就加 --force 重试"
    fi

    log "停 redis 后替换数据目录"
    docker compose stop redis
    docker compose run --rm --no-deps --entrypoint sh redis -c 'rm -rf /data/* /data/.[!.]* 2>/dev/null || true'
    docker compose cp "$tmp/redis-data/." redis:/data

    if [[ -f "$tmp/env" && ! -f .env ]]; then
      cp "$tmp/env" .env
      log "写入 .env"
    elif [[ -f "$tmp/env" ]]; then
      log "本机已有 .env，保留本机的；备份里那份在 $tmp/env（本命令结束就删）"
      cp "$tmp/env" ./.env.from-backup
      log "另存一份到 .env.from-backup 供比对"
    fi

    log "起 redis"
    docker compose up -d redis
    for _ in $(seq 1 30); do
      docker compose exec -T redis redis-cli ping >/dev/null 2>&1 && break
      sleep 1
    done

    restored=$(docker compose exec -T redis redis-cli DBSIZE | tr -d '[:space:]')
    log "Redis 已恢复 $restored 个键"

    log "构建并启动 app"
    docker compose build app
    docker compose up -d --remove-orphans

    for _ in $(seq 1 60); do
      status=$(docker compose ps --format json app | sed -n 's/.*"Health":"\([^"]*\)".*/\1/p' | head -1)
      [[ "$status" == "healthy" ]] && break
      sleep 2
    done
    [[ "${status:-}" == "healthy" ]] || {
      docker compose logs --tail=50 app >&2
      die "健康检查没过"
    }

    log "从日志确认房间是否恢复："
    docker compose logs app | grep -F "已从快照恢复房间" | tail -1 || log "（没有进行中的房间，属正常）"

    log "完成。把入口切到本机后，旧机再 docker compose down"
    ;;

  *)
    die "用法：./scripts/migrate.sh {export|import} <备份文件> [--force]"
    ;;
esac
