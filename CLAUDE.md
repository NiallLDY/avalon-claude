# CLAUDE.md

Melbourne 阿瓦隆 —— 线下面对面玩阿瓦隆时使用的**在线发牌器 / 主持器**。手机网页优先。

## 三份权威文档

| 文件 | 作用 | 规矩 |
|---|---|---|
| [`GAME.md`](./GAME.md) | **游戏规则的唯一真相**（角色、视野、任务人数表、三种扩展模式） | 改规则**先改 GAME.md**，再改 `packages/engine` 与其单测 |
| [`PLAN.md`](./PLAN.md) | 架构、技术选型、协议、UX、素材、部署、里程碑 | 架构决策变化时同步更新 |
| `CLAUDE.md` | 本文件，工程约定 | — |

## 当前状态

**M0：文档与选型阶段，尚无业务代码。** 里程碑见 `PLAN.md §12`。

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

## 开发命令（M1 之后可用）

```bash
pnpm install
pnpm dev            # 并行起 server(:3000) + web(:5173) + 本地 redis
pnpm test           # vitest（引擎单测为主）
pnpm typecheck
pnpm build
```

> 注意：**本机当前未安装 Node**，M1 开工前需先装 Node 24 + pnpm 10（corepack）。

## 约定

- 代码注释与文档：中文；标识符、日志、commit message：英文。
- 提交信息：`feat(engine): ...` / `fix(web): ...` 形式。
- 规则相关的魔法数字（任务人数、保护轮、角色配置）**只允许**定义在 `packages/shared/src/tables.ts`，其他地方一律引用。
- 新增 socket 事件必须同时补 Zod schema 与协议表（`PLAN.md §5`）。
