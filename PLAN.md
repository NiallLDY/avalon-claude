# PLAN.md — Melbourne 阿瓦隆 · 架构与实施方案

> 规则见 [`GAME.md`](./GAME.md)。本文覆盖：技术选型、架构、协议、UX、素材、部署、里程碑。
> 状态：**M0 方案讨论中**，尚未写业务代码。

---

## 1. 产品目标与硬约束

| 约束 | 说明 |
|---|---|
| 使用场景 | 朋友线下围坐，人手一台手机开同一个网页；发言/讨论全在线下 |
| 主设备 | **手机浏览器竖屏**（iOS Safari / Android Chrome / 微信内置浏览器） |
| 账号系统 | **无**。仅本地昵称 + 头像 + 匿名 token |
| 房间 | 公共房间列表，支持**搜索**、**观战**、私密房（房间码） |
| 部署 | 自有墨尔本公网服务器（4C/24G），`docker compose` 一键起，Caddy 反代 `avalon.melbournemasters.org` |
| 更新方式 | 服务器 `git pull` + 一条脚本 |
| **UI 铁律** | **主界面单屏放下，不滚动**。放不下的内容用 Bottom Sheet / Dialog 承载。仅规则页等长文允许滚动 |

---

## 2. 技术选型

### 2.1 结论

| 层 | 选型 | 版本 |
|---|---|---|
| 包管理 / 仓库 | **pnpm workspaces** monorepo | pnpm 10 |
| 语言 | **TypeScript**（`strict`, 全栈共享类型） | 5.9 |
| 前端框架 | **React 19** + **Vite 7**（SPA） | — |
| 样式 | **Tailwind CSS v4**（CSS-first config） | v4 |
| 组件 | **shadcn/ui**（Radix 原语，源码进仓可改）+ **vaul**（移动端 Bottom Sheet） | — |
| 客户端状态 | **Zustand** | v5 |
| 动效 | **Motion**（原 framer-motion） | v12 |
| 实时通信 | **Socket.IO**（client + server） | v4 |
| PWA | **vite-plugin-pwa** | — |
| 服务端 | **Node 24 LTS** + **Fastify 5** | — |
| 校验 | **Zod 4**（协议 schema 全栈复用） | — |
| 日志 | **pino** + pino-pretty(dev) | — |
| 状态存储 | **Redis 8**（房间快照 + 限流计数） | — |
| 规则引擎 | 纯函数包 `packages/engine`，零 I/O | — |
| 测试 | **Vitest**（引擎单测为主）+ **Playwright**（关键流程 e2e，可选） | — |
| 容器 | 多阶段 Dockerfile → 单镜像同时提供 静态资源 + API + WS | node:24-bookworm-slim |

### 2.2 关键决策与理由

**为什么 Vite SPA 而不是 Next.js**
无 SEO、无 SSR 需求；这是一个长连接实时应用，页面就 4 个。SPA + PWA 启动更快、部署更简单（一个 Node 进程既发静态资源又跑 WS），也避免 Next 的 RSC 心智负担。

**为什么 Socket.IO 而不是原生 WebSocket**
手机场景下**锁屏、切后台、Wi-Fi↔4G 切换**极其常见。Socket.IO 自带**自动重连 + 断线缓冲 + ack 确认 + room 广播 + 心跳**，这几样自己写要花掉一半工期且容易出 bug。开销（额外几 KB + engine.io 握手）在 10 人局里完全可忽略。

**为什么不用 Colyseus / 房间状态自动同步框架**
阿瓦隆是**隐藏信息博弈**，服务端必须为**每个玩家单独裁剪视图**。自动状态同步框架的心智是"共享状态 + 打补丁"，做 per-client 裁剪反而别扭且容易漏信息。这里显式手写 `projectStateFor(player)` 更安全、更可审计。

**为什么不上 PostgreSQL**
无账号系统 ⇒ 无用户表；无跨设备数据 ⇒ 无持久化刚需。活跃房间放**内存**（唯一真相），每次状态变更**防抖写 Redis 快照**，进程重启可恢复正在进行的对局。终局战报也写进 Redis（TTL 7 天）供"复盘"页面查看。
⇒ **没有数据库迁移，部署脚本只需拉镜像 + 起容器。** 若后续要做长期战绩榜，再引入 Postgres + Drizzle。

**为什么规则引擎单独成包**
`packages/engine` 是**纯函数状态机**（`(state, action) => newState`），不碰 socket/redis/时间/随机源（随机数由外部注入 seed）。好处：
- 全部规则可用 Vitest 穷举测试（5–10 人 × 3 种扩展模式的组合很多，手测不现实）
- 规则变更只改一处，前端只做展示
- 未来若要做"回放/复盘"，重放 action 日志即可

---

## 3. 仓库结构

```
avalon/
├─ GAME.md                  # 规则权威文档
├─ PLAN.md                  # 本文件
├─ CLAUDE.md                # 给 Claude Code 的项目须知
├─ README.md                # 部署与使用说明
├─ docker-compose.yml
├─ Dockerfile
├─ .env.example
├─ scripts/
│  ├─ deploy.sh             # 服务器：git pull + rebuild + restart
│  ├─ dev.sh                # 本地：一键起 redis + web + server
│  └─ art/                  # 素材生成流水线（见 §9.2）
│     ├─ styles/*.json      # 每套画风的「风格圣经」
│     ├─ gen-art.py         # 批量调 codex img_gen
│     └─ optimize-art.py    # PNG → WebP
├─ assets/
│  └─ roles/<styleId>/*.webp # 角色卡成品（构建时拷进 web）
├─ packages/
│  ├─ shared/               # 协议类型 + Zod schema + 常量表（前后端共用）
│  │  └─ src/{protocol,types,tables,roles}.ts
│  └─ engine/               # 纯规则引擎 + 单测
│     └─ src/{machine,setup,vision,rules,lancelot,lady}.ts
└─ apps/
   ├─ server/               # Fastify + Socket.IO + Redis
   │  └─ src/{index,rooms,socket,store,ratelimit,projection}.ts
   └─ web/                  # React + Vite
      └─ src/{pages,components,store,hooks,assets}/
```

---

## 4. 服务端架构

```
                 ┌──────────────── Node 单进程 ────────────────┐
  手机浏览器 ──► │  Fastify                                      │
   (WS+HTTP)     │   ├─ 静态资源 (@fastify/static, apps/web/dist)│
                 │   ├─ REST: GET /api/rooms  (房间列表/搜索)   │
                 │   │         POST /api/rooms (建房，限流)      │
                 │   └─ Socket.IO /ws                            │
                 │        ├─ RoomManager (内存 Map<roomId,Room>) │
                 │        │     └─ engine.reduce(state, action)  │
                 │        └─ Projection: 每玩家裁剪视图后单播     │
                 └────────────┬──────────────────────────────────┘
                              │ 防抖快照 / 限流计数
                              ▼
                          Redis 8
```

- **单实例**即可支撑数百房间（每房 10 人，状态是几 KB 的 JSON）。不做水平扩展 ⇒ 不需要 socket.io-redis adapter。
- 房间生命周期：创建 → 活跃 → 全员离线 **30 min** 后 GC；对局结束 **2 h** 后 GC。
- **权威随机**：发牌/翻忠诚牌用 `crypto.randomInt`；对局记录 seed 以便复盘。

### 4.1 视图裁剪（最关键的安全边界）

```ts
// apps/server/src/projection.ts
function projectFor(game: Game, viewer: PlayerId | null): ClientGameView
```
- 只输出：公开信息 + `viewer` 自己的角色 + `viewer` 的视野 + `viewer` 自己的投票/出牌。
- 观战者 `viewer = null` ⇒ 只有公开信息。
- 单测断言：**任意非终局状态下，任意玩家视图的 JSON 序列化结果中不得出现他人的 role 字段**。

---

## 5. 实时协议（Socket.IO 事件草案）

**Client → Server**（全部经 Zod 校验，带 ack 回执）

| 事件 | payload |
|---|---|
| `room:join` | `{ roomId, token, profile:{nick, avatar} , asSpectator? }` |
| `room:sit` / `room:stand` | `{ seatIndex }` |
| `room:settings` | `RoomSettings`（仅房主） |
| `room:kick` / `room:transferHost` | `{ playerId }` |
| `game:start` | `{}` |
| `game:ackRole` | `{}` |
| `game:proposeTeam` | `{ seatIndexes:number[], speakDirection:'CW'\|'CCW' }` |
| `game:vote` | `{ approve:boolean }` |
| `game:mission` | `{ success:boolean }` |
| `game:lady` | `{ targetSeat:number }` |
| `game:assassinate` | `{ targetSeat:number }` |
| `game:earlyAssassinate` | `{}` |
| `game:next` | `{}`（房主推进/强制跳过） |

**Server → Client**

| 事件 | payload |
|---|---|
| `state` | 完整 `ClientGameView`（裁剪后，幂等全量，重连即用） |
| `event` | 一次性提示（`TEAM_APPROVED` / `MISSION_FAILED` / `LOYALTY_FLIPPED` …），用于播动画和音效 |
| `error` | `{ code, message }` |
| `room:list` | 大厅房间列表增量 |

> 设计取向：**服务端每次变更下发全量裁剪视图**，不做增量 diff。状态才几 KB，简单胜过优化，且天然解决重连一致性。

---

## 6. 无账号身份方案

1. 首次进站：前端生成 `playerId = uuidv7()` + `token = 32B random`，存 `localStorage`。
2. 昵称 + 头像在**首页设置**，也存 `localStorage`，随时可改。
3. 入房时携带 `{playerId, token}`；服务端以此认座位、认房主、认重连。
4. **换手机 = 新身份**（按你的要求，重新设昵称头像即可）。若原座位仍被占，房主可踢掉幽灵玩家后入座。
5. 断线保护：对局中掉线不释放座位，重连即恢复；房主可"强制推进"避免卡死。

---

## 7. 房间与防滥用

**建房限制（组合拳，均在服务端）**
| 措施 | 参数（可环境变量调） |
|---|---|
| 单 IP 建房频率 | 3 个 / 10 分钟 |
| 单 IP 并发房间 | 2 个 |
| 全站房间上限 | 200 个 |
| 房间空闲 GC | 无人 30 min 回收 |
| Socket 单 IP 连接数 | 20 |
| 消息频率限制 | 每连接 30 msg / 10 s，超限断开 |
| Payload 上限 | 4 KB / 消息 |
| 昵称 | 长度 ≤ 12，过滤控制字符/零宽字符 |
| 房间名 | 长度 ≤ 20，同上 |
| **可选**：Cloudflare Turnstile | 仅"建房"动作校验，隐形挑战，免费；域名走 Cloudflare 时几乎零成本 |

> 建议：先上前 8 条（纯服务端、零依赖）。若真被刷再开 Turnstile，代码里预留开关 `TURNSTILE_SECRET`。
> 另外：房间列表**不显示 IP、不显示房间内玩家的任何身份信息**；私密房不进公开列表，仅凭 6 位房间码进入。

---

## 8. UI / UX 设计

### 8.1 页面清单（4 个主页面 + 若干 Sheet）

| 页面 | 说明 |
|---|---|
| **首页 / 大厅** | 昵称头像设置卡 → 房间列表（搜索、状态标签、人数）→ 建房 / 输码加入 |
| **房间等待页** | 环形座位、房主设置面板（Sheet）、开始按钮 |
| **对局页** | **核心单屏**，见下 |
| **终局页** | 全员身份揭晓、逐轮战报、再来一局 |

### 8.2 对局页布局（竖屏单屏，禁滚动）

```
┌────────────────────────────────────┐
│ ①  ●●○○○  流局 ●●○○○   房间码 ⋮  │  顶部：5 轮任务进度 + 流局计数
├────────────────────────────────────┤
│                                    │
│         ②  环形座位区              │  10 个座位沿椭圆排布
│      (头像 / 昵称 / 👑队长          │  中心：当前阶段大字
│       / ✅上车 / 投票结果角标)      │       + 倒计时/提示
│                                    │
├────────────────────────────────────┤
│ ③  阶段提示：请队长选择 3 名队员    │  中部：一行状态文案
├────────────────────────────────────┤
│ ④  [ 主操作按钮 · 大拇指可达区 ]    │  底部：随阶段切换的操作区
│    身份卡 │ 战报 │ 规则            │  常驻 3 个 Sheet 入口
└────────────────────────────────────┘
```

- **① 顶部条**：5 个任务圆点（显示该轮人数、保护轮标 🛡、完成后染蓝/红）+ 5 个流局点。
- **② 环形座位**：与线下真实座次一致，一眼对上人。座位角标承载全部实时信息（队长冠、上车勾、投票 ✓/✗、女神令牌、掉线灰度）。
- **④ 操作区**是唯一随阶段变化的部分：
  - 组队：`确认队伍 (2/3)` + 发言方向切换
  - 投票：并排两个大按钮 `赞成` / `反对`
  - 任务：`任务成功` / `任务失败`（无权限的按钮直接不渲染）
  - 刺杀 / 查验：先点座位再点确认
  - 非我方回合：显示"等待 X 人操作"进度
- **Bottom Sheet 承载**：我的身份卡（含视野）、逐轮战报、规则速查、房间设置、玩家列表。
- **安全性 UX**：身份卡默认**盖住**，需**长按 1.5s 才显形**（防旁边人瞄到），松手即盖回；可选"翻转动画"。

### 8.3 视觉基调
- **暗色为主**（线下昏暗环境护眼、也符合中世纪调性），单一暗色主题，不做亮色。
- 阵营色：蓝方 `#3B6FE0 → #1B2A6B` 靛蓝银白；红方 `#C0392B → #4A0E0E` 暗红铜金；中性金 `#D8B36A` 作强调。
- 圆角 + 微玻璃拟态 + 轻微质感噪点，避免纯扁平的廉价感。
- 全站禁用页面级滚动：`html,body{overflow:hidden;height:100dvh}`，用 `dvh` 规避 iOS 地址栏跳动；`viewport-fit=cover` + `env(safe-area-inset-*)` 处理刘海/小白条。
- PWA：`display: standalone`，加桌面后无浏览器地址栏，单屏体验才真正成立。

### 8.4 动效清单（Motion）
发牌翻转、上车头像高亮、投票同时揭晓（卡片同时翻面）、任务牌洗牌后逐张翻开、忠诚牌翻转、刺杀锁定、胜负结算横幅。

---

## 9. 素材方案

### 9.1 玩家头像 —— DiceBear `micah`（**推荐**）
- 你指定的 [vue-color-avatar](https://github.com/Codennnn/vue-color-avatar) 素材来源是 **Micah Lanier 的 "Avatar Illustration System"（CC BY 4.0）**；**DiceBear 的 `micah` 风格用的是同一套原始美术资源**，且已封装成开箱即用的 npm 包。
- 方案：`@dicebear/core` + `@dicebear/collection`，前端本地生成 SVG，**零网络请求**。
  - 存储只需 `{ seed, options }`（几十字节），不存图片。
  - "随机头像"= 换 seed；"自定义"= 暴露发型/眼睛/嘴型/眼镜/胡须/肤色/背景色选择器。
- **署名要求（CC BY 4.0）**：在"关于/规则"页注明 `Avatar artwork: "Avatar Illustration System" by Micah Lanier, CC BY 4.0`。
- 备选方案：直接搬运 vue-color-avatar 的 Vue SFC 部件转 React（部件更多、风格略不同），工作量大得多，除非你就要那个特定观感。

### 9.2 角色卡插画 —— codex `img_gen` 生成的**油画立绘**（已定稿）

**出图能力（实测结论）**
本机 `codex` CLI 的 `image_generation` 特性为 `stable / enabled`，**ChatGPT 账号登录即可用，不需要 `OPENAI_API_KEY`**。实测：

```bash
codex exec -C <outdir> --sandbox workspace-write \
  "Use your image generation tool (img_gen) to generate ONE image and save it as ./x.png.
   Do NOT resize or post-process it. Prompt: <...>"
```

- 原生输出 **1254×1254 PNG**（约 1.2–2.7 MB），单张耗时 **~1.5–2 分钟**。
- 提示词里必须写 **"Do NOT resize or post-process"**，否则它会自己写个 Python 缩放脚本去凑你要求的尺寸，反而糊掉。
- 无水印、无边框需在提示词里显式排除（`no text, no watermark, no border`）。

**风格：油画立绘（`painterly`）**
半身立绘、厚涂笔触、强轮廓光、暗角背景、正方形构图。已选定为第一套。

**多风格架构（为将来的卡通风格预留）**
角色卡从第一天起就是**可切换资源集**，不是写死的图片路径：

```
assets/roles/<styleId>/<roleId>.webp     # 生成产物，styleId ∈ {painterly, cartoon, ...}
scripts/art/styles/<styleId>.json        # 该风格的「风格圣经」：共用后缀 + 阵营色板 + 每角色提示词
scripts/art/gen-art.py                   # 批量调 codex img_gen，并发生成
scripts/art/optimize-art.py              # PNG master → WebP（q92，原生 1254²）
```

- 前端：`ART_STYLES` 常量 + `useArtStyle()`，图片路径由 `` `/art/roles/${styleId}/${roleId}.webp` `` 拼出。
- 加第二套风格 = 加一个 `cartoon.json` + 跑一次脚本 + 在设置里多一个选项，**不改任何组件**。
- 风格选择存 `localStorage`，属于个人偏好，不进房间状态（不影响服务端）。

**10 个角色 ID（与 `packages/shared` 的 `RoleId` 对齐）**
`merlin` `percival` `loyal-servant` `lancelot-blue` / `morgana` `assassin` `mordred` `oberon` `minion` `lancelot-red`

- 两个兰斯洛特刻意画成**同一个人物的蓝/红两面**（双面披风翻转），呼应"换阵营"机制。
- 莫甘娜的立绘带**模仿法术微光**的手势，呼应她在派西维尔眼里与梅林难辨。
- 莫德雷德半身没入阴影（梅林看不见）、奥伯伦独自处于浓雾（队友互不相认）—— 机制暗示进画面。

**体积**：master WebP q92 约 300–450 KB/张，前端按需再压到 1024² q85（约 120–180 KB）并**懒加载**（只有自己的身份卡 + 终局揭晓才用到）。

### 9.3 字体与图标
- 中文用系统字体栈（`-apple-system, "PingFang SC", "Noto Sans SC", …`），**不引入几 MB 的中文字体**。
- 标题装饰字（"AVALON" 等拉丁字母）自托管一个衬线展示体（如 `Cinzel`，OFL 授权），只子集化用到的字符，< 20 KB。
- 图标用 `lucide-react`（ISC）。

### 9.4 音效（可选，默认关）
发车、通过/否决、任务成功/失败、刺杀 —— 短促 UI 音，来源用 CC0 素材库，总量控制在 100 KB 内，默认静音、可开关。

---

## 10. 部署方案

### 10.1 容器
```yaml
# docker-compose.yml（草案）
services:
  app:
    build: .
    restart: unless-stopped
    env_file: .env
    ports: ["127.0.0.1:8787:3000"]   # 只监听回环，由 Caddy 反代
    depends_on: [redis]
  redis:
    image: redis:8-alpine
    restart: unless-stopped
    command: ["redis-server","--appendonly","yes","--save","60","1"]
    volumes: ["redis-data:/data"]
volumes: { redis-data: {} }
```
`Dockerfile` 多阶段：`pnpm install --frozen-lockfile` → `build web + server` → 运行阶段只带 `dist` + 生产依赖，最终镜像预期 < 200 MB。

### 10.2 Caddy（服务器已有 Caddy）
```caddy
avalon.melbournemasters.org {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8787
}
```
Caddy v2 的 `reverse_proxy` **原生透传 WebSocket 升级**，无需额外配置；HTTPS 证书自动签发。

### 10.3 Cloudflare Tunnel（可选替代/叠加）
可行，Cloudflare **支持 WebSocket**。两种接法：
- **Tunnel → Caddy**：`service: http://127.0.0.1:80`（保留现有 Caddy 路由）
- **Tunnel → 应用**：`service: http://127.0.0.1:8787`
```yaml
ingress:
  - hostname: avalon.melbournemasters.org
    service: http://127.0.0.1:8787
  - service: http_status:404
```
注意点：Cloudflare 代理层对**空闲 WebSocket 约 100 秒**超时 ⇒ Socket.IO 默认 25 s 心跳已覆盖，无需改；同时需关闭对 `/ws` 路径的 Rocket Loader/压缩改写。

### 10.4 更新流程（你在服务器上）
```bash
cd /path/to/avalon && ./scripts/deploy.sh
# deploy.sh 内容：git pull --ff-only → docker compose build → docker compose up -d → docker image prune -f
```
**无数据库迁移**；Redis 数据结构变更时脚本会带版本号自动清理不兼容的房间快照（对局是短生命周期数据，清掉无损失）。

---

## 11. 本机开发环境

**开发与测试全部在容器内进行**，宿主机只需要 Docker。见 `compose.dev.yaml` 与 `scripts/{dev,test,sh}.sh`。

| 决策 | 理由 |
|---|---|
| dev 镜像 = `node:24-bookworm-slim` | 与生产镜像同大版本同 libc；不用 alpine 是为了避开 musl 与宿主机 glibc 的预编译二进制（esbuild 等）冲突 |
| 整个仓库 bind mount 进 `/app` | 热更新即时；`node_modules` 落在宿主机，编辑器能解析类型 |
| pnpm store 放具名 volume | 重建容器不用重下依赖 |
| redis 端口只绑 `127.0.0.1` | 宿主机可以 `redis-cli` 观察，但不暴露公网 |

> 宿主机上另有 nvm 装的 node（当前 default 已对齐 24），但项目命令不依赖它。

---

## 12. 里程碑

| 里程碑 | 内容 | 产出 |
|---|---|---|
| **M0** | 需求/规则/选型定稿（当前） | GAME.md / PLAN.md / CLAUDE.md |
| **M1** | 骨架：monorepo、TS 配置、Docker 跑通 | `pnpm dev` 可起 |
| **M2** | **规则引擎 + 全量单测**（标准/兰斯洛特/女神/提前刺杀） | `packages/engine` 绿灯 |
| **M3** | 服务端：房间、协议、裁剪视图、Redis 快照、限流 | 可用 CLI/脚本跑通一局 |
| **M4** | 前端：首页/大厅/房间等待页/头像系统 | 能建房入座 |
| **M5** | 前端：对局主界面（单屏）+ 全流程联调 | 标准模式可完整玩 |
| **M6** | 扩展模式 UI + 终局战报页 | 全模式可玩 |
| **M7** | 素材接入（角色卡多风格切换）、动效、PWA、移动端打磨 | 体验达标 |
| **M8** | 部署上线、README、运维脚本 | 线上可用 |

---

## 13. 产品决策记录

规则层决策见 [`GAME.md` §13](./GAME.md)（Q1–Q10，已全部拍板）。此处是产品/技术层，同样已全部拍板：

| # | 问题 | 结论 |
|---|---|---|
| P1 | 玩家头像方案 | **DiceBear `micah`** —— 与 vue-color-avatar 同源美术（Micah Lanier, CC BY 4.0），前端本地生成 SVG 零网络请求，只存 seed。**待观察**：若实际观感不满意，改为搬 vue-color-avatar 的部件转 React |
| P2 | 角色卡美术方向 | **油画立绘**（codex img_gen 生成），架构上预留第二套卡通风格，见 §9.2 |
| P3 | 观战聊天 / 发言计时器 | **都不做**（线下已解决），只留「发言方向」提示 |
| P4 | 终局复盘页 | **做**，逐轮投票明细；出牌人映射不公开（GAME.md Q5） |
| P5 | 房间内多局连打 | **做**，保留座位重新发牌 |
| P6 | 亮色主题 | **不做**，只做暗色 |
| P7 | 国际化 | **只做中文**，文案集中一个文件便于后加 |
| P8 | Cloudflare Turnstile 建房验证 | **先不开**，代码留 `TURNSTILE_SECRET` 开关 |
| P9 | 音效 | **做**，默认关 |
| P10 | PWA 可安装 | **做** —— 这是「单屏不滚动」真正成立的前提 |
