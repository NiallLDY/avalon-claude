# CLAUDE.md

Melbourne 阿瓦隆 —— 线下面对面玩阿瓦隆时使用的**在线发牌器 / 主持器**。手机网页优先。

## 三份权威文档

| 文件 | 作用 | 规矩 |
|---|---|---|
| [`GAME.md`](./GAME.md) | **游戏规则的唯一真相**（角色、视野、任务人数表、三种扩展模式） | 改规则**先改 GAME.md**，再改 `packages/engine` 与其单测 |
| [`PLAN.md`](./PLAN.md) | 架构、技术选型、协议、UX、素材、部署、里程碑 | 架构决策变化时同步更新 |
| `CLAUDE.md` | 本文件，工程约定 | — |

## 当前状态

**M0–M8 全部完成，可部署运行。** 里程碑见 `PLAN.md §12`。

| 包 | 内容 |
|---|---|
| `packages/shared` | 常量表、角色元数据、客户端类型、画风注册表；Zod schema 在 `@avalon/shared/schemas` 子入口（**只有服务端 import**，别打进前端） |
| `packages/engine` | `setup` 发牌 / `vision` 视野 / `machine` 状态机 / `projection` 视图裁剪 |
| `apps/server` | Fastify + Socket.IO + Redis 快照 + 限流 |
| `apps/web` | React 单屏客户端，PWA。规则页是**唯一允许滚动**的页面 |
| `assets/roles/` | 角色卡插画，生成流水线见 `scripts/art/` |

213 个 vitest + 21 个 Playwright e2e。部署见 `README.md`。

## 技术栈速查

- monorepo：pnpm workspaces；语言：TypeScript strict
- `packages/shared` —— 协议类型 + Zod schema + 常量表（前后端共用）
- `packages/engine` —— **纯函数**规则引擎，零 I/O，Vitest 覆盖
- `apps/server` —— Node 24 + Fastify 5 + Socket.IO 4 + Redis 8
- `apps/web` —— React 19 + Vite 7 + Tailwind v4 + shadcn/ui + Zustand + Motion
- 部署：单镜像（静态资源 + API + WS）+ redis 容器，Caddy 反代

## 不可违反的铁律

1. **服务端权威**：角色、视野、投票、任务出牌只在服务端计算与保存。
2. **绝不下发全量状态**：每次推送必须经 `projectFor(game, viewer)` 裁剪。前端"不显示"不等于安全 —— 抓包就能看到。任何新增字段都要问一句：**这个字段能被所有人看到吗？**
3. **任务出牌永久匿名**：`playerId → success/fail` 的映射不得出现在任何下行 payload 里。
4. **单屏不滚动**：主界面（大厅/房间/对局/终局）必须在手机竖屏一屏内放下。溢出内容用 Bottom Sheet / Dialog。仅规则页等长文允许滚动。
5. **移动端优先**：所有交互按拇指可达区设计；用 `100dvh` 而非 `100vh`；处理 `safe-area-inset`。
6. **无账号系统**：身份 = `localStorage` 里的 `playerId + token`。不要引入登录、邮箱、密码。
7. **规则引擎不碰副作用**：`engine` 里禁止 `Date.now()`、`Math.random()`、网络、Redis。随机源与时间戳由调用方注入。

## 开发命令

**开发与测试一律在容器里跑**，宿主机不需要 node。镜像 `node:24-bookworm-slim`，与生产同大版本、同 libc。

```bash
./scripts/dev.sh     # 起 server(:3000) + web(:5173) + redis(:6379)
./scripts/test.sh    # vitest；参数透传，如 ./scripts/test.sh vision --watch
./scripts/e2e.sh     # Playwright 真浏览器测试（iPhone 视口）
./scripts/sh.sh      # 进容器 shell
```

> **改前端就要跑 `./scripts/e2e.sh`。** vitest 那层直接走 socket 协议，
> 绕开了浏览器 —— 客户端状态管理的问题（刷新掉房、输入框误报、连接状态误判）
> 在那一层一个都测不出来。

容器内可用 `pnpm install / dev / test / typecheck / build`。
node_modules 通过 bind mount 落在宿主机（同为 glibc x64），编辑器能直接解析类型。

## 约定

- 代码注释与文档：中文；标识符、日志、commit message：英文。
- 提交信息：`feat(engine): ...` / `fix(web): ...` 形式。
- 规则相关的魔法数字（任务人数、保护轮、角色配置）**只允许**定义在 `packages/shared/src/tables.ts`，其他地方一律引用。
- 新增 socket 事件必须同时补 Zod schema 与协议表（`PLAN.md §5`）。
