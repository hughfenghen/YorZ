---
stage: execute
last_action: execute 完成 14 项任务，端到端验证通过
updated_at: 2026-06-14
summary: 落地 YorZ v0.1 最小可用的 Service（HTTP+SSE+FS Watcher+静态 GUI 托管）与 Solid.js GUI（spec 列表/详情/新建/实时刷新）
---

# 最小化 Service 与 GUI

## 背景

- 项目愿景与架构见 @docs/Prod-Design.md、@docs/Architecture.md、@docs/Vision.md
- 项目现状（截至本 spec 创建）：
  - 已交付：`@yorz/cli`（`install`/`uninstall`）+ `yorz-spec` skill（驱动 spec 状态机），见 @docs/specs/260611.feat.init-cli-and-skill.md
  - 未交付：架构图里的 Service / GUI / Agent Relauncher / `yorz init|serve|status|stop|resume` 等
- 本次推进目标：按 @docs/Architecture.md 第 4.2、4.4、5、7 节，以**最小可用集**形式落地 Service 与 GUI，先把"md ↔ GUI"环路跑通，为后续 Agent Relauncher、决策/Review 交互、移动端打底

## 需求

> 来自本次会话的用户输入："了解项目背景，新增需求，实现最小化的 Service 跟 GUI（@docs/Architecture.md）"。

- 在现有仓库内新增一个**单一 Service 进程**，能：
  - 提供 HTTP 接口列出 / 读取 / 新建 `.yorz/specs/*/spec.md`
  - 监听 `.yorz/specs/**/*.md` 文件变化并通过 SSE 推送给前端
  - 静态托管 GUI 产物
- 新增 **Solid.js + Vite GUI**，能：
  - 列出当前项目下的所有 spec（标题 / stage / updatedAt / summary）
  - 打开任意 spec 渲染其 markdown，并在文件被 Agent/用户改动时**自动实时刷新**（SSE）
  - 新建 spec（仅需"标题 + 首段需求"，Service 写入符合 `yorz-spec` skill 约定的 frontmatter 与七大空章节骨架）
- 在 CLI 上新增 `yorz serve` 命令，启动 Service（含默认端口、`--port`、`--open`）
- **明确不在本期范围**：
  - Agent Relauncher（spawn claude/opencode 进程）
  - `await/done` 决策与 Review 的图形化交互
  - 跨项目索引（`~/.yorz/db.sqlite`）
  - MCP Server
  - Mermaid / xyflow / 思维导图等高级图形组件
  - 公网穿透与认证
  - `yorz init` / `yorz status` / `yorz stop` / `yorz resume`

## 现状分析

### 仓库工程化

- Node 项目，`type: module`，TS + Vite lib 模式构建到 `dist/`
- `package.json` 仅一个产物：`@yorz/cli`（`bin: yorz → dist/cli/index.js`）
- 依赖：`commander`（运行时），`vite/vitest/prettier/typescript`（dev）
- 构建脚本：`vite build`（CLI lib 模式 + 同步复制 `src/skill/SKILL.md` 到 `dist/skill/`）
- 测试：vitest，已有 `tests/adapters.test.ts`、`tests/install.test.ts`
- 代码风格：`.prettierrc.json` 存在，spec skill 要求 `npx prettier --write <spec>`

### 现有 CLI

- `src/cli/index.ts`：commander 入口，命令 `install` / `uninstall`，参数 `--agent claude|opencode` / `--scope user|project`
- `src/cli/install.ts`：把内联的 `SKILL.md?raw` 写入目标 Agent 的 skills 目录
- `src/cli/adapters/*`：claude/opencode 路径解析适配器
- `src/skill/SKILL.md`：`yorz-spec` skill 源（构建期内联 + 复制）

### 现有 spec 数据形态

- skill 约定路径：`.yorz/specs/<id>/spec.md`（每个 spec 一个目录）
- id 规则：`YYMMDD.(feat|refct|fix).<summary-name>`
- frontmatter 字段固定顺序：`stage`/`last_action`/`updated_at`/`summary`
- 章节骨架：`## 背景` / `## 需求` / `## 现状分析` / `## 技术实现方案` / `## 待确认问题` / `## 任务清单` / `## 执行记录`
- 当前仓库下尚无 `.yorz/`（本次创建第 1 个），历史 spec 暂存于 `docs/specs/`

### 架构文档与本期范围的差异

- 架构 4.2 节描述 Service 分三层（Transport / Application / Storage）含 FS Watcher、Input Merger、Agent Relauncher、MCP 通道
- 本期**仅落地 Transport + FS Watcher + 最小 Input Merger 之 "create spec"**，Relauncher / await 合并留到下一期
- 架构 4.4 节描述 GUI 路由有 `/`、`/specs`、`/specs/new`、`/specs/:id`、`/settings` 等；本期仅 `/`（=列表）、`/specs/:id`、`/specs/new`
- 架构 5.1 节描述 `~/.yorz/db.sqlite` 仅作派生索引；本期**不引入 sqlite**，直接 FS 扫描 `.yorz/specs/`，规模可控

## 技术实现方案

### 总览

新增 3 个产物 + 1 处 CLI 扩展：

1. `@yorz/service`（同仓 monorepo 子包，或在现包内新增 `src/service/` 目录）：Node HTTP + SSE + FS Watcher
2. `@yorz/gui`：Solid.js + Vite SPA，构建产物落 `dist/gui/`
3. `yorz serve` 子命令：CLI 拉起 Service，可选自动打开浏览器
4. `.yorz/specs/` 数据目录：由 Service "create spec" 写入

### 包与目录结构（建议）

```
src/
  cli/
    index.ts            # 已有；新增 serve 子命令
    serve.ts            # 新增：调用 service.start()
    install.ts          # 已有
    uninstall.ts        # 已有
    adapters/           # 已有
  service/
    index.ts            # export start({ port, cwd, open }) -> { url, close }
    server.ts           # Hono app + 路由注册
    routes/
      specs.ts          # GET/POST /api/specs、GET /api/specs/:id、POST /api/specs/:id/inputs(本期仅追加 raw 文本)
      events.ts         # GET /api/specs/:id/events (SSE)
    watcher.ts          # chokidar 监听 .yorz/specs/**/*.md
    spec-store.ts       # FS 读写、frontmatter 解析、新建 spec 模板
    static.ts           # 托管 GUI 产物（dist/gui/）
  gui/
    index.html
    src/
      main.tsx          # Solid 入口
      router.tsx        # solid-router
      pages/
        Home.tsx        # = spec 列表
        SpecDetail.tsx  # 渲染 md + SSE 订阅
        NewSpec.tsx     # 新建表单
      lib/
        api.ts          # fetch wrapper
        sse.ts          # EventSource 包装
        markdown.ts     # markdown-it 渲染
      styles/           # 移动端优先 CSS
  skill/                # 已有
```

> 若要避免一次性引入 monorepo，可全部放在现有包内、复用同一份 `package.json`；vite 用两份配置（CLI lib 模式 + GUI SPA 模式），通过不同 `--config` 切换。**MVP 推荐先单包多产物**，结构更扁。

### 依赖选型

- HTTP/SSE：**hono**（架构文档已点名；体积小、原生支持 stream/SSE，Node 适配 `@hono/node-server`）
- 文件监听：**chokidar**（事实标准，跨平台稳定）
- frontmatter 解析：**gray-matter**（同步、零依赖）
- markdown 渲染（GUI）：**markdown-it** + **highlight.js**（或先用 `marked`，体积更小；高亮可延后）
- Solid 路由：**@solidjs/router**
- 构建：Vite（已有），GUI 用标准 SPA 模式

### Service 详细设计

#### 启动入口

```ts
// src/service/index.ts
export interface ServeOptions {
  port?: number      // default 7423
  cwd?: string       // default process.cwd()
  open?: boolean     // default false
}
export interface ServeHandle {
  url: string
  close(): Promise<void>
}
export async function start(opts: ServeOptions = {}): Promise<ServeHandle> { ... }
```

- 启动前确保 `<cwd>/.yorz/specs/` 存在（不存在则 `mkdir -p`，不写 `.gitignore`）
- 端口被占用：自动 +1 重试最多 10 次，最终在日志输出实际端口
- 启动后控制台输出 `YorZ Service ready at http://localhost:<port>/`

#### HTTP 路由（本期）

| Method | 路径                       | 说明                                                                                                                                                                          |
| ------ | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/` 与其他非 `/api/*` 路径 | 静态 GUI（含 SPA fallback：未命中静态资源回 `index.html`）                                                                                                                    |
| GET    | `/api/specs`               | 扫描 `.yorz/specs/*/spec.md`，返回 `{ id, title, stage, updated_at, summary }[]`，按 `updated_at` 倒序                                                                        |
| POST   | `/api/specs`               | Body `{ title: string, type?: 'feat'\|'refct'\|'fix', summary: string, requirement?: string }`；按 skill 规范生成 id、目录、初始 spec.md；返回 `{ id, path }`                 |
| GET    | `/api/specs/:id`           | 返回 `{ id, frontmatter, body, mtime }`（body 为去除 frontmatter 的 markdown 原文）                                                                                           |
| POST   | `/api/specs/:id/inputs`    | Body `{ kind: 'append-note', content: string }`；以 `> 用户批注（YYYY-MM-DDTHH:mm）：...` 形式追加到正文末尾，并写回 frontmatter `updated_at`；**本期不实现 await/done 合并** |
| GET    | `/api/specs/:id/events`    | SSE：订阅该 spec 文件 mtime 变化；事件 `{ type: 'updated', mtime }`                                                                                                           |
| GET    | `/api/projects/current`    | `{ cwd, name }` 简单回显                                                                                                                                                      |

> 错误处理：HTTP 标准 4xx/5xx + JSON `{ error: string }`；不引入复杂的错误码体系。

#### FS Watcher

- chokidar 监听 `<cwd>/.yorz/specs/**/*.md`，事件 `add` / `change` / `unlink`
- 内存维护 `Map<specId, { mtime, frontmatter }>`，事件触发时：
  1. 重新读取 frontmatter（gray-matter）更新缓存
  2. 向订阅了该 specId 的 SSE 连接广播 `updated` 事件
  3. 向订阅 `/api/specs` 列表的 SSE 连接广播 `list-changed`（**本期可先不做列表 SSE，前端在收到 specDetail 更新后手动重新拉列表**）
- 写回操作通过 `spec-store.write()` 集中，避免 watcher 触发自我回路（短时 echo 抑制：write 后记录 mtime，watcher 同 mtime 跳过）

#### spec-store

- `list()`：扫描子目录中的 `spec.md`
- `read(id)`：返回 frontmatter + body
- `create({ title, type, summary, requirement })`：
  - 生成 id：`YYMMDD.<type>.<kebab-summary-name>`，冲突追加 `-2/-3`
  - 写入骨架：frontmatter（`stage: plan`、`last_action: 新建 spec`、`updated_at: <today>`、`summary`）+ 七大空章节，`## 背景` 下写入 requirement（若提供）
- `appendNote(id, content)`：追加批注段，更新 `updated_at`

### GUI 详细设计

- 单包 SPA，构建产物落 `dist/gui/`，Service 启动时 `serveStatic('./dist/gui/')`
- 三个页面：
  - **Home（`/`）**：spec 列表卡片；空状态引导"新建 spec"
  - **SpecDetail（`/specs/:id`）**：
    - 顶部状态条（stage 徽标、updated_at、summary）
    - 主区：markdown 渲染（只读 MVP）
    - 右侧/底部（移动端折叠）：追加批注输入框 → POST `/api/specs/:id/inputs`
    - 挂载时建立 `EventSource('/api/specs/:id/events')`，收到 `updated` 重新 `GET /api/specs/:id`
  - **NewSpec（`/specs/new`）**：表单：title / type 单选 / summary / requirement(textarea) → POST → 跳详情
- 移动端优先：所有交互按钮 min 44×44px，列表卡片单列；PC 自动两列网格
- 仅引入必要依赖：`solid-js` / `@solidjs/router` / `markdown-it`

### CLI 扩展

```bash
yorz serve [--port 7423] [--open] [--cwd <dir>]
```

- 委托 `service.start()`，前台运行；Ctrl+C 优雅退出（关闭 server + watcher）
- `--background` 不在本期范围（后续配合 `~/.yorz/runtime.json` 探活）

### 构建与发布

- vite 改造为多入口：
  - 现有 CLI lib 配置保留
  - 新增 `vite.gui.config.ts`（标准 SPA），`outDir: dist/gui`
  - `package.json` 新脚本：`build:cli` / `build:gui` / `build`（= 两者依次）
- `package.json` `files` 字段（若未来发布）需包含 `dist/cli`、`dist/gui`、`dist/skill`
- 运行时 Service 通过 `import.meta.url` 推导 `dist/gui/` 绝对路径

### 测试策略

- 单元（vitest）：
  - `spec-store.create` 的 id 生成与冲突追加 `-2`
  - frontmatter 序列化字段顺序与时间格式
  - `appendNote` 不破坏 frontmatter
- 集成（vitest + 临时目录）：
  - 启动 Service → POST 创建 spec → GET 列表包含 → 直接写文件触发 watcher → SSE 收到 `updated`
- GUI：MVP 不做自动化测试，手测列表/详情/新建/SSE 自动刷新四条路径
- 端到端验收：跑 `yorz serve`，浏览器打开，创建一个 spec，在终端用 `echo` 改 md，GUI 自动刷新

## 待确认问题

- 暂无

> 决议（已合并至上方方案）：单包多产物保留 `@yorz/cli`；端口默认 7423，占用 +1 重试；markdown-it；GUI 表单显式选 type；MVP 仅追加批注不做全文编辑；本期不写 `~/.yorz/runtime.json`；`.yorz/specs/` 纳入 git；不迁移旧 spec。

## 任务清单

- [x] 在 `package.json` 增加运行时依赖 `hono` / `@hono/node-server` / `chokidar` / `gray-matter` 与开发依赖 `solid-js` / `@solidjs/router` / `markdown-it` / `@types/markdown-it` / `vite-plugin-solid`，运行 `pnpm install` 成功更新 lockfile
- [x] 在 `src/service/spec-store.ts` 实现 `list()` / `read(id)` / `create({title,type,summary,requirement})` / `appendNote(id,content)`：id 形如 `YYMMDD.<type>.<kebab>`、冲突追加 `-2`，frontmatter 固定字段顺序，初始 spec 含七大空章节
- [x] 在 `tests/spec-store.test.ts` 覆盖 id 冲突追加 `-2`、frontmatter 字段顺序、`appendNote` 不破坏 frontmatter，`pnpm test` 通过
- [x] 在 `src/service/watcher.ts` 用 chokidar 监听 `<cwd>/.yorz/specs/**/*.md`，对外暴露 `subscribe(specId, cb)` / `subscribeList(cb)`，写入时记录 mtime 实现 echo 抑制
- [x] 在 `src/service/server.ts` + `src/service/routes/{specs,events,project}.ts` 用 hono 注册 `/api/specs` GET/POST、`/api/specs/:id` GET、`/api/specs/:id/inputs` POST、`/api/specs/:id/events` SSE、`/api/projects/current` GET，错误返回 JSON `{ error }`
- [x] 在 `src/service/index.ts` 导出 `start({ port=7423, cwd, open })`：占用端口自动 +1 重试 ≤10 次，console 输出实际 URL，返回 `{ url, close() }`
- [x] 在 `tests/service.test.ts` 集成测试：临时 cwd → start → POST 创建 → GET 列表命中 → 直接 writeFile 改 md → SSE 收到 `updated` → close()，`pnpm test` 通过
- [x] 在 `src/cli/serve.ts` 实现 `serve` 子命令并在 `src/cli/index.ts` 注册 `yorz serve [--port] [--open] [--cwd]`，SIGINT 时调用 `handle.close()` 优雅退出
- [x] 新建 GUI 骨架 `src/gui/index.html` + `src/gui/src/main.tsx` + `src/gui/src/AppShell.tsx`，使用 `solid-js` + `@solidjs/router` 挂载到 `#app`
- [x] 在 `src/gui/src/pages/{Home,SpecDetail,NewSpec}.tsx` 实现三页面：列表卡片；markdown-it 渲染 + EventSource 自动刷新 + 追加批注表单；新建表单 → POST → 跳详情；附 `lib/{api,sse,markdown}.ts`
- [x] 新增 `vite.gui.config.ts`（solid plugin，`root: src/gui`，`outDir: dist/gui`），并把 `package.json` 脚本拆为 `build:cli` / `build:gui` / `build`
- [x] 在 `src/service/static.ts` 实现 GUI 静态托管 + SPA fallback（非 `/api/*` 未命中静态资源时回 `index.html`），路径通过 `process.argv[1]` 推导（替代原方案中的 `import.meta.url`，避开 Vite lib 模式把 `import.meta.url` 内联成 `data:` URL 的问题）
- [x] 运行 `pnpm build && pnpm test` 全部通过，产物含 `dist/cli/index.js`、`dist/gui/index.html`、`dist/gui/assets/index-*.js`、`dist/skill/SKILL.md`
- [x] 端到端实测：`node dist/cli/index.js serve --port 17423` 启动成功；`curl /` 返回 GUI HTML、`curl /api/specs` 列出本 spec、`POST /api/specs` 成功创建并出现在列表中、未知路由 `/specs/<id>` 命中 SPA fallback 返回 200

## 执行记录

- 2026-06-14 任务 1：`pnpm add hono @hono/node-server chokidar gray-matter` + `pnpm add -D solid-js @solidjs/router markdown-it @types/markdown-it vite-plugin-solid` 成功，lockfile 更新；esbuild 构建脚本告警可忽略
- 2026-06-14 任务 2-3：新增 `src/service/spec-store.ts`（含 `SpecStore` 类、id 生成 `YYMMDD.<type>.<kebab>`、冲突追加 `-2/-3`、frontmatter 固定字段顺序、七大空章节模板）；`tests/spec-store.test.ts` 6 个用例全部通过
- 2026-06-14 任务 4-6：新增 `src/service/watcher.ts`（chokidar 监听、echo 抑制 `markSelfWrite`、`subscribe(id)` / `subscribeList`）、`src/service/server.ts`、`routes/{specs,events,project}.ts`、`static.ts`、`index.ts`（`start({port,cwd,open})` 支持端口占用 +1 重试 ≤10 次）；TS 严格检查无报错
- 2026-06-14 任务 7：新增 `tests/service.test.ts` 4 个集成测试（创建/列表/详情/SSE/404/400），含 SSE EventSource 实测收到 `event: updated`，全部通过；累计 `pnpm test` 22 个用例 0 失败
- 2026-06-14 任务 8：CLI 新增 `serve` 子命令（`src/cli/serve.ts` + `src/cli/index.ts` 注册），支持 `--port` `--open` `--cwd`，SIGINT/SIGTERM 调用 `handle.close()` 后 `process.exit(0)`
- 2026-06-14 任务 9-11：GUI 工程骨架建好（`src/gui/index.html` + `src/gui/src/main.tsx` + `AppShell.tsx` + `pages/{Home,NewSpec,SpecDetail}.tsx` + `lib/{api,sse,markdown}.ts` + `styles.css`，移动端优先栅格 + stage 徽标 + 暗色模式 prefer-color-scheme）；`vite.gui.config.ts` 用 solid 插件，`outDir: dist/gui`；`package.json` 脚本拆为 `build:cli` / `build:gui` / `build` / `dev:gui`；`tsconfig.json` 增加 `jsx: preserve` + `jsxImportSource: solid-js` + DOM lib + tsx include
- 2026-06-14 任务 12：构建产物初次有问题（`fileURLToPath` 收到 `data:video/mp2t;base64,...` URL），原因是 Vite lib 模式把 `static.ts` 中通过 `import.meta.url` 推导路径的语义内联成了源码 data URL；改为通过 `process.argv[1]` 在 CLI 入口推导 `dist/gui/` 路径解决；构建后 `dist/cli/index.js` 32.51 kB / gzip 12.74 kB，`dist/gui/index.html` 0.41 kB + `assets/index-*.js` 148.78 kB + `assets/index-*.css` 5.03 kB
- 2026-06-14 任务 13：`pnpm build && pnpm test` 全部通过，产物含 `dist/cli/index.js` / `dist/gui/index.html` / `dist/gui/assets/*` / `dist/skill/SKILL.md`
- 2026-06-14 任务 14：端到端实测脚本 `node dist/cli/index.js serve --port 17423`，验证：(1) `curl /` 返回 413 byte HTML 含 `<html lang="zh-CN">`；(2) `curl /api/specs` 返回本 spec 元信息；(3) `curl -X POST /api/specs -d '{"title":...,"type":"feat",...}'` 返回 `{"id":"260614.feat.e2e","path":...}`、磁盘出现新目录、列表再次 GET 包含 2 项；(4) `curl /specs/some-id` 命中 SPA fallback 返回 200；测试 spec 已清理。修复了 `updated_at` 被 gray-matter 解析为 Date → JSON 序列化成 ISO 字符串的 bug（新增 `normalizeFrontmatter` + `dateString` 把 Date 还原为 `YYYY-MM-DD`）
- 2026-06-14 收尾：浏览器 GUI 交互（点击新建表单、SSE 自动刷新）受当前终端环境限制未做人工点击实测，但所有底层 HTTP/SSE 接口均通过 `vitest` 与 `curl` 端到端覆盖，行为可预期
