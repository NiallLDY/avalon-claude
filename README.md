# Melbourne 阿瓦隆

线下面对面玩《阿瓦隆》时使用的**在线发牌器 / 主持器**。手机网页优先，无需注册。

网页负责：发牌与视野、组队、投票、任务出牌、忠诚牌、湖中女神查验、刺杀、胜负判定与战报。
发言与讨论仍然发生在线下。

支持：标准模式、**兰斯洛特模式**、**湖中女神模式**、**提前刺杀模式**，5–10 人。

## 文档

| 文件 | 内容 |
|---|---|
| [`GAME.md`](./GAME.md) | 完整游戏规则规格 —— 规则的唯一真相 |
| [`PLAN.md`](./PLAN.md) | 架构、技术选型、协议、UX、素材与部署方案 |
| [`CLAUDE.md`](./CLAUDE.md) | 工程约定 |

---

## 本地开发

宿主机**只需要 Docker**，不用装 Node。

```bash
./scripts/dev.sh     # server(:3000) + web(:5173) + redis(:6379)
./scripts/test.sh    # vitest，参数透传：./scripts/test.sh vision --watch
./scripts/sh.sh      # 进容器 shell
```

浏览器开 <http://localhost:5173>。要在手机上试，用同一 Wi-Fi 下的 `http://<你的内网IP>:5173`。

### 一个人试玩

对局要 5–10 个人，一台设备进不去。用陪玩脚本把剩下的座位填上：

```bash
# 1. 手机/浏览器打开应用，建个房间，记下顶部那 6 位房间码
# 2. 在服务器上：
./scripts/play.sh ABC234        # 放 4 个机器人，凑 5 人局
./scripts/play.sh ABC234 6      # 放 6 个，凑 7 人局（可以开湖中女神）
```

机器人只做最笨的决策（一律赞成、能出成功就出成功），目的是让流程跑起来，不是当对手。
推进「继续」由你这个房主点，节奏你控制。Ctrl-C 结束。

### 看界面长什么样

```bash
./scripts/shots.sh    # 用 5 个真浏览器打完一局，逐阶段截 iPhone 视口的图
```

产物在 `apps/web/shots/`。改完 UI 想对比效果时很有用。

---

## 部署

目标：自有服务器，Caddy 反代到 `avalon.melbournemasters.org`。

### 1. 首次部署

```bash
git clone <你的仓库地址> /srv/avalon
cd /srv/avalon
./scripts/deploy.sh
```

脚本做的事：拉代码 → 构建镜像 → `docker compose up -d` → 等健康检查 → 清理旧镜像。

**没有数据库迁移步骤。** 无账号系统 ⇒ 无用户表；房间状态本身是短生命周期数据，
Redis 只存快照（结构变更时快照 key 带版本号，旧的自然失效）。所以更新流程里不存在"迁移"这一环。

跑起来后应用监听 **`127.0.0.1:8787`**（只绑回环，不暴露公网）。

### 2. Caddy

服务器上已有 Caddy 的话，往 `Caddyfile` 里加：

```caddy
avalon.melbournemasters.org {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8787
}
```

然后 `caddy reload --config /etc/caddy/Caddyfile`（或 `systemctl reload caddy`）。

几点说明：

- **WebSocket 不需要额外配置。** Caddy v2 的 `reverse_proxy` 原生透传 `Upgrade` 握手，
  不像 nginx 那样要手写 `proxy_set_header Upgrade`。
- **HTTPS 自动签发。** 只要域名 A 记录已经指到这台机器，Caddy 会自己申请并续期证书。
  PWA 必须跑在 HTTPS 上，这一步不能省。
- **别对 `/ws` 开压缩改写。** `encode` 对 WebSocket 帧无效也无害，但如果你另外加了
  第三方的响应改写插件，记得排除 `/ws`。

前置是 Caddy 时，容器的 `TRUST_PROXY=1` 会让服务端从 `X-Forwarded-For` 取真实客户端 IP —— 
**这条很重要**，否则所有人的建房限流会共用"同一个 IP"，一个人刷满全站就卡住。

### 3. Cloudflare Tunnel（可选）

**可行，Cloudflare 支持 WebSocket。** 两种接法：

```yaml
# ~/.cloudflared/config.yml
ingress:
  # 接法 A：Tunnel → Caddy，保留现有 Caddy 路由（推荐，其他站点不受影响）
  - hostname: avalon.melbournemasters.org
    service: http://127.0.0.1:80

  # 接法 B：Tunnel → 应用，绕过 Caddy
  # - hostname: avalon.melbournemasters.org
  #   service: http://127.0.0.1:8787

  - service: http_status:404
```

注意点：

- Cloudflare 代理层对**空闲 WebSocket 约 100 秒**超时。Socket.IO 默认 25 秒心跳已经覆盖，不用改。
- 在 Cloudflare 面板里关掉该域名的 **Rocket Loader** 和 **Auto Minify**，它们会改写 HTML/JS，
  可能破坏 service worker。
- 走 Tunnel 时真实 IP 在 `CF-Connecting-IP`，Cloudflare 也会同时写 `X-Forwarded-For`，
  所以 `TRUST_PROXY=1` 依然有效。

### 4. 后续更新

在服务器上：

```bash
cd /srv/avalon && ./scripts/deploy.sh
```

重启期间正在进行的对局**不会丢**：容器收到 `SIGTERM` 会立即把房间快照写进 Redis，
新容器启动时读回来，玩家那边表现为一次短暂的断线重连。

### 5. 配置

所有参数都有默认值，不配也能跑。要改就复制 `.env.example` 成 `.env`：

```bash
cp .env.example .env
```

常用的几个：建房频率 `ROOM_CREATE_PER_IP`、单 IP 并发房间 `MAX_ROOMS_PER_IP`、
全站上限 `MAX_ROOMS`、房主掉线移交时间 `HOST_TRANSFER_AFTER_MS`。
完整列表见 `apps/server/src/config.ts`。

### 6. 换一台服务器

```bash
# 旧机
./scripts/migrate.sh export ./avalon-backup.tar.gz
scp ./avalon-backup.tar.gz 新机:/srv/avalon/

# 新机（先 git clone 同一个仓库）
./scripts/migrate.sh import ./avalon-backup.tar.gz
```

要搬的只有三样：**Redis 里的房间快照与战报**（唯一的服务端状态，没有数据库、没有上传文件）、
`.env`、以及代码版本（脚本会记 commit，新机版本对不上会拦下来 —— 快照结构跟代码是绑定的）。

**玩家身份不在服务端。** `playerId + token` 存在每台手机的 `localStorage` 里，按 origin 隔离：

- **域名不变** ⇒ 迁移对玩家是无感的。断线重连会自动回房，座位、房主身份、进行中的对局都还在。
- **换域名 ⇒ 所有人变成新玩家**，座位和房主身份全丢。这是唯一真会「丢用户」的操作，
  跟换不换服务器没关系。真要换域名，等一局都没有的时候再换。

**导出必须先停 app 再导 Redis**，脚本里就是这个顺序。房间的真相在内存里，写 Redis 有 2 秒防抖；
app 收到 `SIGTERM` 会把所有房间立刻落盘。反过来先导后停，丢的正好是最后几秒 ——
也就是最可能有人在操作的那几秒。

入口切换：

- **Cloudflare Tunnel**：同一个 tunnel token 在新机跑起来、旧机停掉即可，**不用等 DNS 生效**。
- **DNS 直连**：提前一天把 TTL 调到 60 秒，切换当天再改指向。

停机窗口就是「旧机停 app → 传备份 → 新机导入起服 → 切入口」这一段，几分钟。
期间玩家看到的是「连接断开，正在重连」，切完自动回到原来的房间。

### 7. 排查

```bash
docker compose logs -f app        # 应用日志
docker compose ps                 # 容器与健康状态
curl -s localhost:8787/api/health # {"ok":true,"rooms":N}
docker compose exec redis redis-cli keys 'avalon:*'
```

---

## 素材

角色卡插画用本机 `codex` CLI 的 `img_gen` 生成，流水线可复现：

```bash
python3 scripts/art/gen-art.py painterly            # 生成全套（单张约 1.5–2 分钟）
python3 scripts/art/optimize-art.py painterly       # PNG → WebP
```

画风定义在 `scripts/art/styles/<styleId>.json`。加一套新画风 = 加一个 json + 跑两条脚本 +
在 `packages/shared/src/art.ts` 的 `ART_STYLES` 里加一项，**组件代码一行不用改**。

## 致谢

- 玩家头像美术：*Avatar Illustration System* by **Micah Lanier**，授权 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)（经 [DiceBear](https://dicebear.com) 实现；与 [vue-color-avatar](https://github.com/Codennnn/vue-color-avatar) 同源）
