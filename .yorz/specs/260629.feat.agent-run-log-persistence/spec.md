---
stage: execute
last_action: 完成全部 19 项任务实施——AgentLogStore/AgentRunner 接线/ProjectRegistry/HTTP 路由/GUI 独立页面/CLI gitignore；测试 191 passed、构建通过
updated_at: 2026-06-29
summary: 将 Agent 任务执行日志持久化到 .yorz/tmp，按 specId 隔离，服务端定期清理 3 个月前的旧日志；spec 详情页新增 "Agent 执行日志" 独立子页面（按时间降序、卡片化、可折叠）；yorz install 在 git 仓库下把 .yorz/tmp 写入 .gitignore
---

# Spec: Agent 任务执行日志持久化与回看入口

## 1. 背景

当前 GUI 右下角 `AgentPanelDock`（`src/gui/src/components/AgentPanelDock.tsx`）通过 SSE 实时显示 Agent 任务输出，状态来源是浏览器内存中的 `agentTasks` store（`src/gui/src/lib/agent-tasks.ts`）；服务端 `AgentRunner` 在 `agent.ts` 内只在内存里维护一个 64KB 环形缓冲（`BUFFER_MAX = 64 * 1024`），运行结束后 handle 即从 `handlesById` 中删除，buffer 也随之失效。

结果：

- Agent 跑完（或失败）之后只要刷新页面或关闭 dock 卡片，输出就找不回了；
- 复盘失败原因、对照 agent 真实执行了哪些工具调用、回放长任务执行片段时无据可查。

需要把执行日志写到磁盘做长期回看，并在 spec 详情页提供一个统一的入口浏览历史日志。

## 2. 需求

### 2.1 原始需求

> Agent 任务运行日志应该持久化，当前右下角的Agent任务执行完成或失败之后的信息刷新就没有了，某些场景需要观察 Agent 的输出；
> 将Agent的信息输出到 .yorz/tmp 目录进行持久化存储，按specId进行隔离，在 server 里面新增一个清除机制，类似清理 drafts，清除3个月以前的执行日志；
> 在GUI中的spike详情页，新增一个 Agent 执行日志入口，从 tmp 目录根据 specId 关联到相关的执行日志，以卡片形式加载日志文件，支持展开折叠，按时间降序；
> yorz install 命令执行的时候，如果项目是一个git仓库，应该把 .yorz/tmp 目录添加到 git ignore 文件中

### 2.2 功能需求

- **FEAT-1 日志落盘**：每个 Agent 运行（包括 `skill-run`、`explain` 两类）从启动那一刻就持续把输出写入磁盘文件；进程退出/失败/被取消时仍能保留落盘内容。
- **FEAT-2 按 specId 隔离**：所有日志放在项目根下的 `.yorz/tmp/agent-logs/<specId>/` 目录；同一 spec 的多次运行各自独立成文件。
- **FEAT-3 自动清理**：服务端定时（或在合适触发点）清理 3 个月以前的日志，类似 `AttachmentStore.cleanupExpired()` 的实现风格。
- **FEAT-4 spec 详情页日志入口**：在 `SpecDetail.tsx` 新增 "Agent 执行日志" 区块，按时间降序列出该 spec 下所有历史日志条目；每条以卡片形式呈现，默认折叠（仅展示元数据），点击展开后才异步加载并显示完整文本。
- **FEAT-5 install 命令副作用**：`yorz install` 在 git 仓库中运行时，自动把 `.yorz/tmp` 追加到项目根的 `.gitignore`（如已有则幂等跳过）；非 git 仓库下不做任何改动。

### 2.3 非功能需求

- 落盘写入必须 **流式追加**（不能等运行结束统一写）——否则 server 崩溃/手动 kill 会丢日志；
- 单个运行的日志文件大小无硬上限（人工跑长任务时输出可能 >1MB），但要避免无界增长——继续沿用 BUFFER_MAX 内存缓冲只是给 SSE 回放用，落盘日志走单独的文件 stream。
- GUI 列表加载只读元信息（不预读正文），避免大量日志拖累首屏渲染。

## 3. 现状分析

### 3.1 服务端：AgentRunner 与运行生命周期

`src/service/agent.ts` 关键事实：

- `AgentRunner.spawn()`（行 142-224）通过 `child_process.spawn` 拉起 agent 子进程，stdout/stderr 经 `pushStdout`/`append` 收敛到一个内存 buffer（`BUFFER_MAX = 64 * 1024`）。
- handle 形如 `AgentRunHandle`，唯一存活时间是 `handlesById.set/delete`：`run()` 行 75-94 在 spawn 后 set，`onExit` 内 delete；进程退出后 handle 即被 GC，**buffer 不会持久化**。
- 流格式有两种：JSONL（`attachJsonlStream`）会把每行 JSON 经 `formatStreamEvent` 转成 human-readable 文本后写入 buffer；非 JSON 模式直接转 utf8 字符串。
- `cwd` 由构造时传入（`AgentRunnerOptions.cwd`），就是项目根（`ProjectInstance.path`），所以日志目录路径已经可达。

### 3.2 服务端：项目实例化与启动钩子

`src/service/project-registry.ts` 的 `materialize()`（行 164-211）是项目级资源的诞生地：

- 同时构造 `SpecStore` / `SpecWatcher` / `AgentRunner` / `TouchedFilesStore` / `AttachmentStore`；
- 启动 `startPromise` 内串行执行 `store.ensureRoot()` / `attachments.ensureRoot()` / `attachments.cleanupExpired()` / `watcher.start()`；
- 这是新增 `AgentLogStore` 类初始化与首轮 `cleanupExpired()` 的天然挂载点。

### 3.3 服务端：现成的清理范式（drafts）

`src/service/attachment-store.ts:269-293` 的 `cleanupExpired()` 就是要照搬的模板：

```ts
async cleanupExpired(): Promise<{ removed: string[] }> {
  if (!existsSync(this.root)) return { removed: [] }
  // ...
  const cutoff = this.now() - this.ttlMs
  for (const entry of entries) {
    // 比对 stat.mtimeMs 与 cutoff，超时则 rm -rf 整个子目录
  }
}
```

- 触发时机：`ProjectRegistry.materialize()` 内一次性 fire-and-forget（`void attachments.cleanupExpired().catch(() => {})`），以及在 `routes/spec-drafts.ts` POST `spec-drafts` 时再触发一次。
- TTL 默认 24h，对日志改成 90 天（约 3 个月）。

### 3.4 服务端：SSE 路由与 buffer 回放

`src/service/routes/events.ts:94-209` 的 `GET /projects/:projectId/specs/:id/events` 在订阅时会把 `handle.buffer()` 整体压入队列推给客户端（行 137-146），这是 GUI 重连恢复 dock 实时展示的依据。**注意**：这是"in-memory buffer 回放"——只能恢复当前 *仍在跑* 的任务，对已退出任务无效。

`routes/runs/:runId/events`（行 225-308）也只能拉到当前活跃的 handle；已退出的 run 直接返回 `run not found or already ended`。

→ 历史日志需要新的 HTTP 路由（不复用 SSE），以"读取磁盘文件"的方式提供给 GUI。

### 3.5 GUI：dock 与 spec 详情页交互模型

- `src/gui/src/components/AgentPanelDock.tsx`：右下角浮层；数据全部来自 `agentTasks` store；任务结束后保留卡片直到用户手动"清理已完成"或刷新页面（此时 store 重置，历史就丢了）。
- `src/gui/src/pages/SpecDetail.tsx`：当前结构是 `<header class="page-head detail-head">` + `<div class="spec-split">`（左：`QuestionConfirmPanel`；右：`<article class="markdown spec-main">`）。日志区块需要插入到 `.spec-split` 之外、`.page` 之内，作为页面的一个独立块。
- `src/gui/src/lib/api.ts`：所有 HTTP 调用集中在 `api` 对象；新增日志相关接口要在这里加。

### 3.6 CLI install 现状

`src/cli/install.ts` 的 `install()` 函数：

- 把 `src/skill/yorz-spec/**` 内联到 Vite bundle，写入 adapter 解析出的 `<scope>/<agent>/skills/yorz-spec/`；
- 只动 skill 目录，**完全不感知 cwd 项目状态**（既不查是否 git 仓库，也不读 `.gitignore`）。
- `--scope user`（默认）时 cwd 与项目实际无关；`--scope project` 时 cwd 才是项目根；但实际用户通常在项目目录里跑 install，需要照顾到。
- 测试在 `src/cli/__tests__/install.test.ts`，用临时 `home`/`cwd` 沙箱，每条用例只验证 skill 目录写入；本次新增 gitignore 行为需要追加用例。

### 3.7 项目 `.gitignore` 现状

仓库根 `.gitignore` 第 12 行已有 `.yorz/drafts`——说明已有"把 `.yorz` 下临时目录写入 ignore"的先例；本次只是再加一行 `.yorz/tmp`。本仓库自身的 `.gitignore` 不在本 spec 改动范围（手工改即可），但 install 行为需要保证未来在 *其它* 项目里 `yorz install` 时能自动追加。

## 4. 技术实现方案

### 4.1 数据模型与目录结构

```
<project-root>/.yorz/tmp/
  agent-logs/
    <specId>/
      <runId>.log    # 纯文本/经 formatStreamEvent 处理后的输出流（含 stderr）
      <runId>.json   # 元数据：{runId, specId, mode, startedAt, endedAt, exitCode, error?, source?}
```

理由：

- `.yorz/tmp` 留作未来更通用的临时目录（与 `.yorz/drafts` 平级），`agent-logs` 是其下首个子用途；
- 拆 `.log` + `.json` 而非单一 JSONL：日志正文是大头（流式追加），元数据是小头（单次写入），分开后元数据可在列表接口里只读 `.json`，无需读正文；
- `runId` 已经是 `randomUUID()`，天然有唯一性；时间排序靠 `startedAt`（已记录在元数据里），无需依赖文件名时序。

`source` 字段（`run|explain|draft`）只在 GUI 触发时知道，server 这边 `AgentRunner` 只有 `mode`，不强制持久化 source；若 GUI 后续想展示，再以可选字段处理。

### 4.2 服务端新增：AgentLogStore

新文件 `src/service/agent-log-store.ts`，类比 `AttachmentStore`：

```ts
export interface AgentLogMeta {
  runId: string
  specId: string
  mode: 'skill-run' | 'explain'
  startedAt: number      // ms epoch
  endedAt: number | null // null 表示仍在写入或异常未收尾
  exitCode: number | null
  error?: string
  sizeBytes: number      // 末次更新时的 .log 大小，方便列表展示
}

export class AgentLogStore {
  constructor(opts: { cwd: string; now?: () => number; ttlMs?: number })
  ensureRoot(): Promise<void>
  /** 打开一个写入 handle；返回 append(chunk) / finalize({exitCode, error?}) 两个回调。 */
  openWriter(input: { runId; specId; mode; startedAt }): Promise<AgentLogWriter>
  /** 列出某 spec 下所有日志元信息，按 startedAt 降序。 */
  listBySpec(specId: string): Promise<AgentLogMeta[]>
  /** 读取某 runId 的 .log 内容；可加 maxBytes 限制。 */
  readLog(specId: string, runId: string, opts?: { maxBytes?: number }): Promise<string>
  /** 删除超过 ttl（默认 90 天）的 spec 子目录 / 单 run 文件。粒度待定，见 4.3。 */
  cleanupExpired(): Promise<{ removed: string[] }>
}
```

`AgentLogWriter` 内部用 `fs.createWriteStream(<runId>.log, { flags: 'a' })` 流式写；`finalize()` 时关流并写 `<runId>.json`（之前可先写一份 `endedAt: null` 的初始 meta，便于异常恢复时辨认未完成的运行）。

### 4.3 清理粒度与 TTL

- TTL 取 90 天（`90 * 24 * 60 * 60 * 1000`），允许通过 `AgentLogStoreOptions.ttlMs` 覆写（便于测试）。
- 清理粒度选 **按单条 run 粒度**（依据 `.json` 里的 `endedAt`，缺失时退回 `mtimeMs`）——比 attachment 的"按 draft 目录粒度"更细，避免一个 spec 下混合新旧时被一刀切。
- 触发点：
  - `ProjectRegistry.materialize()` 启动时一次性 fire-and-forget；
  - 每次 `AgentRunner.run()` 开始前，fire-and-forget 触发一次（频率不会高，不打扰主路径）。

### 4.4 AgentRunner ↔ AgentLogStore 接线

`AgentRunner` 改造：

- 构造选项新增 `logStore?: AgentLogStore`（可选，便于测试场景跳过）。
- `spawn()` 内拿到 `id`/`startedAt` 后立即调用 `logStore.openWriter(...)`，拿到 `writer`。
- 既有的 `pushStdout(text)` 改为同时：
  - `append(text)` 进内存 buffer（保留——SSE 实时回放仍要用）；
  - `writer.append(text)`（fire-and-forget，错误吞掉，避免影响主流）。
- `child.on('exit')` / `child.on('error')` 内补一次 `writer.finalize({exitCode, error})`。
- 写文件失败不阻断 agent；只在 console.warn 一次（沿用项目内吞错风格）。

### 4.5 HTTP 路由：历史日志列表与读取

新增到 `src/service/routes/events.ts`（或单独 `agent-logs.ts`，倾向后者以避免 events.ts 继续膨胀）：

- `GET /api/projects/:projectId/specs/:id/agent-logs`
  → 返回 `AgentLogMeta[]`（按 `startedAt` 降序）。
- `GET /api/projects/:projectId/specs/:id/agent-logs/:runId`
  → 返回 `{ meta: AgentLogMeta; content: string }`。content 大小若超过阈值（如 256KB）截断并返回 `truncated: true`。

权限/校验：均经过 `resolveProject(projectId)`，404 路径与既有路由一致。

`src/service/server.ts` 把新路由 mount 上去。

### 4.6 GUI 集成：新增 "Agent 执行日志" 独立子页面（仿 review 模式）

**入口（SpecDetail.tsx 头部）**：在 `<header class="page-head detail-head">.meta` 区域内、`Review` 链接旁，新增一个同样风格的链接：

```tsx
<A class="ghost agent-logs-link" href={projectHref(`specs/${s().id}/agent-logs`)}>
  执行日志
</A>
```

**路由（src/gui/src/main.tsx）**：在既有 review 路由后新增

```tsx
<Route path="/:projectId/specs/:id/agent-logs" component={SpecAgentLogs} />
```

**新页面组件 `src/gui/src/pages/SpecAgentLogs.tsx`**（参考 `SpecReview.tsx` 结构）：

- 页面顶部 `<header class="page-head detail-head">`：含 `← 返回 spec` 链接、标题 `执行日志 · {specId}`、spec summary 副标题。
- 主区 `<section class="agent-log-list">`：标题 "Agent 执行日志 (N)"；使用 `createResource` 拉 `api.listAgentLogs(pid, specId)`，得到 `AgentLogMeta[]`，按后端返回顺序渲染（已是 `startedAt` 降序）。
- 每条日志渲染为卡片 `<article class="agent-log-card">`：
  - 折叠态（默认）：显示本地时间（`new Date(startedAt).toLocaleString()`）、`mode` 标签、运行时长（`endedAt - startedAt`，毫秒 → 人读，未完成则显示 "运行中/未收尾"）、exitCode 状态徽章（0 成功 / 非 0 失败 / null 未收尾）、`sizeBytes` 大小。
  - 展开时按需触发 `api.getAgentLog(pid, specId, runId)`（同一 runId 只拉一次，缓存在组件 `Map<runId, content>` 内），展开后渲染 `<pre class="agent-log-body">` 输出；若 `truncated: true`，顶部显示 "已截断显示前 256KB" 提示。
  - 折叠/展开按钮使用新写 `.agent-log-card-toggle` 类（不与 dock 的 `agent-task-expand` 强耦合，避免互相牵连）。
- 列表为空时显示 `<p class="muted">暂无 Agent 执行日志</p>`。
- 刷新：页面提供顶部一个 "刷新" 按钮（不做轮询，参考既有项目列表手动刷新模式），点击后 `setRefreshTick`；从 SpecDetail 跳回再进入会天然触发新一次 resource 拉取。

**`src/gui/src/lib/api.ts` 新增**：

```ts
listAgentLogs: (pid, specId) => request<AgentLogMeta[]>(...)
getAgentLog: (pid, specId, runId) => request<{ meta: AgentLogMeta; content: string; truncated?: boolean }>(...)
```

同时 `export type AgentLogMeta` 与服务端字段对齐。

**样式新增到 `src/gui/src/styles.css`**：增加 `.agent-log-list`、`.agent-log-card`、`.agent-log-card-head`、`.agent-log-card-body`、`.agent-log-card-toggle` 等 class，遵从既有色板与 `.spec-review` / `.review-changes` 现有节奏。

### 4.7 CLI install：git 仓库感知 + .gitignore 追加

`src/cli/install.ts` 在现有 `install()` 结束前新增一段：

```ts
async function ensureTmpIgnored(cwd: string): Promise<{ updated: boolean; path: string } | null> {
  if (!await isGitRepo(cwd)) return null
  const giPath = join(cwd, '.gitignore')
  const existing = (await readFile(giPath, 'utf8').catch(() => '')) ?? ''
  if (hasIgnoreEntry(existing, '.yorz/tmp')) return { updated: false, path: giPath }
  const next = existing.endsWith('\n') || existing === '' ? existing : existing + '\n'
  await writeFile(giPath, next + '.yorz/tmp\n', 'utf8')
  return { updated: true, path: giPath }
}
```

要点：

- 判定 git 仓库：检查 `<cwd>/.git` 是否存在（文件或目录皆可——支持 worktree 链接 `.git` 文件）。不主动调用 `git` 命令，避免依赖二进制。
- `hasIgnoreEntry`：按行扫描，忽略注释与空白行，命中 `.yorz/tmp` 或 `.yorz/tmp/` 或 `/.yorz/tmp` 同视为已存在。
- 行尾换行规整：原文件如果没有结尾换行则补一个再追加。
- 调用时机：`install()` 末尾，无论 scope 是 user 还是 project，都基于 `opts.cwd` 触发。理由：用户通常在项目目录里跑 `yorz install` 来"开个项目"。
- 返回值由 CLI 入口 `src/cli/index.ts` 打印一行（"appended .yorz/tmp to .gitignore" / "already ignored" / 非 git 仓库时静默）。
- 测试：扩展 `src/cli/__tests__/install.test.ts`，新增三个用例覆盖（git 仓库无 .gitignore、git 仓库已 ignore、非 git 仓库）。

不动 `uninstall.ts`——卸载不撤回 ignore 配置（用户可能仍想保留临时目录被忽略）。

### 4.8 影响范围

| 模块                                    | 改动                                                        |
| --------------------------------------- | ----------------------------------------------------------- |
| `src/service/agent-log-store.ts`        | 新增                                                        |
| `src/service/agent.ts`                  | 注入 `logStore`，writer 接线                                |
| `src/service/project-registry.ts`       | `materialize()` 构造 logStore 并启动 cleanup                |
| `src/service/routes/agent-logs.ts`      | 新增                                                        |
| `src/service/server.ts`                 | mount 新路由                                                |
| `src/gui/src/lib/api.ts`                | 新增 list/get 接口 + `AgentLogMeta` 类型                    |
| `src/gui/src/pages/SpecAgentLogs.tsx`   | 新增独立子页面（仿 SpecReview 模式）                        |
| `src/gui/src/pages/SpecDetail.tsx`      | 头部 `meta` 区新增"执行日志"链接（紧邻 Review）             |
| `src/gui/src/main.tsx`                  | 新增 `/:projectId/specs/:id/agent-logs` 路由                |
| `src/gui/src/styles.css`                | 新增日志卡片样式                                            |
| `src/cli/install.ts`                    | `ensureTmpIgnored()` + 调用                                 |
| `src/cli/index.ts`                      | install 命令打印 gitignore 处理结果                         |
| `src/cli/__tests__/install.test.ts`     | 三个新用例                                                  |
| `.gitignore`（本仓库自身）              | 手工追加 `.yorz/tmp`（不写代码改）                          |

## 5. 待确认问题

- 暂无

### 5.1 已确认的决策（来自用户批注）

- **P-1**：选项 A——所有 `AgentRunner.run()` 均落盘（含 `explain`），统一处理。
- **P-2**：新增独立子页面（仿 review 模式），路由 `/:projectId/specs/:id/agent-logs`，由 SpecDetail 头部链接进入。
- **P-3**：采用推荐方案——`<runId>.log` + `<runId>.json` 分离。
- **P-4**：列表严格 meta only，展开时再拉日志正文。
- **P-5**：选项 A——`ensureTmpIgnored` 无论 scope 是 user 还是 project，只要 cwd 是 git 仓库就追加，幂等静默。
- **P-6**：单 run 日志不设硬上限，仅在读取接口做 256KB 截断；磁盘膨胀靠 TTL 清理兜底。
- **P-7**：接受现状，不补特性上线前的历史空记录。

## 6. 任务清单

### 6.1 服务端 · AgentLogStore

- [x] 新建 `src/service/agent-log-store.ts`：导出 `AgentLogMeta` 接口（runId/specId/mode/startedAt/endedAt/exitCode/error?/sizeBytes）与 `AgentLogStore` 类；实现 `ensureRoot()`（递归创建 `<cwd>/.yorz/tmp/agent-logs/`）；验收点：`new AgentLogStore({cwd}).ensureRoot()` 后目录存在且可写。
- [x] 实现 `AgentLogStore.openWriter({runId, specId, mode, startedAt})`：先写一份 `endedAt: null` 的 `<runId>.json` 初始 meta；返回 `{ append(chunk), finalize({exitCode, error?}) }`；`append` 内部用 `fs.createWriteStream(<runId>.log, { flags: 'a' })` 复用同一 stream；`finalize` 关闭 stream 并 stat 文件大小后回写 meta（含 `endedAt = now()`、`exitCode`、`error?`、`sizeBytes`）；验收点：append 多次后 `.log` 包含所有片段，finalize 后 `.json.endedAt` 非空且 `sizeBytes` 与文件大小一致。
- [x] 实现 `AgentLogStore.listBySpec(specId)`：扫描 `<root>/<specId>/*.json`，读取并解析 meta，过滤损坏项，按 `startedAt` 降序返回；验收点：单测构造 3 个 run 后 list 返回 3 条且顺序正确。
- [x] 实现 `AgentLogStore.readLog(specId, runId, opts?)`：读取 `<runId>.log`，若指定 `maxBytes` 且文件超过则只读末尾 `maxBytes` 字节并返回 `{ content, truncated: true }`；验收点：构造一个 300KB 日志，maxBytes=256\*1024 时返回 truncated 且 content 长度 = 256KB。
- [x] 实现 `AgentLogStore.cleanupExpired()`：默认 `ttlMs = 90 * 24 * 60 * 60 * 1000`；按 `<runId>.json.endedAt`（缺失退回 `mtimeMs`）与 `now() - ttlMs` 比较，超时删除 `<runId>.log` 与 `<runId>.json`；返回 `{ removed: string[] }`（runId 列表）；验收点：注入 `now`/`ttlMs` 后单测验证旧 run 被删、新 run 保留。
- [x] 为 `AgentLogStore` 新建单元测试 `src/service/__tests__/agent-log-store.test.ts`，覆盖 ensureRoot/writer 全流程、list 排序、read 截断、cleanupExpired 选择性删除四个场景。

### 6.2 服务端 · AgentRunner 接线

- [x] 修改 `src/service/agent.ts`：`AgentRunnerOptions` 增加可选 `logStore?: AgentLogStore`；在 `spawn()` 拿到 `id`/`startedAt` 后调用 `await this.logStore?.openWriter({...})` 并把返回的 writer 挂到 handle 上；验收点：构造 runner 且不传 logStore 时行为不变（既有测试通过）。
- [x] 修改 `pushStdout(handle, text)`：同步执行既有 `append(text)` 进内存 buffer，并 fire-and-forget 调用 `handle.writer?.append(text)`，错误吞掉并 `console.warn` 一次；验收点：注入 mock writer 后能收到全部 chunk。
- [x] 修改 `child.on('exit')` 与 `child.on('error')` 处理：在 delete `handlesById` 之前 fire-and-forget 调用 `handle.writer?.finalize({exitCode: code ?? null, error: err?.message})`；验收点：mock writer 收到 finalize 调用且 exitCode 正确。

### 6.3 服务端 · ProjectRegistry 与清理触发

- [x] 修改 `src/service/project-registry.ts` 的 `materialize()`：实例化 `AgentLogStore({ cwd })`，在 `startPromise` 内追加 `await logStore.ensureRoot()` 与 `void logStore.cleanupExpired().catch(() => {})`；并把 logStore 透传到 `new AgentRunner({...})` 构造选项；验收点：项目实例化后 `.yorz/tmp/agent-logs/` 目录存在。
- [x] 在 `AgentRunner.run()` 入口（`spawn()` 之前）追加一次 `void this.logStore?.cleanupExpired().catch(() => {})`；验收点：每次启动 run 触发一次清理，单测验证 cleanup 被调用。

### 6.4 服务端 · HTTP 路由

- [x] 新建 `src/service/routes/agent-logs.ts`：导出 `registerAgentLogsRoutes(app)`；实现 `GET /api/projects/:projectId/specs/:id/agent-logs` → 调用 `logStore.listBySpec(specId)` 返回 `AgentLogMeta[]`；404 路径与既有路由一致（`resolveProject`）；验收点：手动 curl 在 mock 数据下返回降序数组。
- [x] 在 `agent-logs.ts` 实现 `GET /api/projects/:projectId/specs/:id/agent-logs/:runId` → 调用 `listBySpec` 找到 meta 并 `readLog(specId, runId, { maxBytes: 256 * 1024 })`，返回 `{ meta, content, truncated }`；runId 不存在返回 404；验收点：mock 数据下能拿到 content；不存在的 runId 返回 404。
- [x] 修改 `src/service/server.ts`：调用 `registerAgentLogsRoutes(app)` 挂载新路由；验收点：服务端启动后两个新接口可访问。

### 6.5 GUI · API 与类型

- [x] 修改 `src/gui/src/lib/api.ts`：导出 `type AgentLogMeta`（字段与服务端一致），并在 `api` 对象上新增 `listAgentLogs(pid, specId)` 与 `getAgentLog(pid, specId, runId)` 两个方法；验收点：TypeScript 类型检查通过。

### 6.6 GUI · 新页面 SpecAgentLogs

- [x] 新建 `src/gui/src/pages/SpecAgentLogs.tsx`：参照 `SpecReview.tsx` 骨架，含 `← 返回 spec` 链接、`执行日志 · {specId}` 标题、spec summary；用 `createResource` 拉 `api.listAgentLogs(pid, specId)`；空列表显示 "暂无 Agent 执行日志"；顶部含手动 "刷新" 按钮（`setRefreshTick`）。
- [x] 在 `SpecAgentLogs.tsx` 内实现日志卡片：折叠态显示 本地时间 / mode 标签 / 运行时长（人读毫秒：未收尾显示 "运行中"）/ exitCode 徽章（0 成功、非 0 失败、null 未收尾）/ sizeBytes（人读 KB/MB）；点击切换展开；展开时按需调用 `api.getAgentLog`，缓存在组件 `Map<runId, content>` 内避免重复请求；展开后渲染 `<pre class="agent-log-card-body">`；若 `truncated` 顶部提示 "已截断显示末尾 256KB"。
- [x] 修改 `src/gui/src/main.tsx`：在 review 路由后新增 `<Route path="/:projectId/specs/:id/agent-logs" component={SpecAgentLogs} />`；并 `import { SpecAgentLogs } from './pages/SpecAgentLogs.jsx'`；验收点：浏览器访问该路由能渲染页面。
- [x] 修改 `src/gui/src/pages/SpecDetail.tsx`：在 `.meta` 区 Review 链接旁新增 `<A class="ghost agent-logs-link" href={projectHref(\`specs/${s().id}/agent-logs\`)}>执行日志</A>`；验收点：详情页能看到入口并点击跳转。
- [x] 修改 `src/gui/src/styles.css`：新增 `.agent-log-list`、`.agent-log-card`、`.agent-log-card-head`、`.agent-log-card-body`、`.agent-log-card-toggle`、`.agent-logs-link` 样式，沿用 `.spec-review` / `.review-changes` 节奏；验收点：页面视觉与 review 页一致。

### 6.7 CLI · install 追加 .gitignore

- [x] 在 `src/cli/install.ts` 新增 `ensureTmpIgnored(cwd)`：检测 `<cwd>/.git` 是否存在（文件或目录，支持 worktree 形式）；不是 git 仓库返回 `null`；读取 `<cwd>/.gitignore`（不存在视为空字符串）；按行扫描忽略空白与注释行，命中 `.yorz/tmp`、`.yorz/tmp/`、`/.yorz/tmp` 任一形式视为已存在；存在则返回 `{ updated: false, path }`；不存在则追加 `.yorz/tmp\n`（确保前一行有换行）并返回 `{ updated: true, path }`。
- [x] 在 `install()` 函数末尾（skill 写入完成后）调用 `await ensureTmpIgnored(opts.cwd)`，并把返回值并入 `install()` 的返回结构（如 `{ ..., gitignore: { updated, path } | null }`）；验收点：返回值新字段可被入口消费。
- [x] 修改 `src/cli/index.ts` install 命令：根据 `ensureTmpIgnored` 返回值打印一行：`updated=true` → "appended .yorz/tmp to .gitignore"；`updated=false` → "already ignored .yorz/tmp"；`null`（非 git 仓库）→ 静默不输出；验收点：三种场景在 CLI 输出上行为正确。
- [x] 扩展 `src/cli/__tests__/install.test.ts`：新增 3 个用例 ——（1）临时 cwd 含 `.git` 但无 `.gitignore`，install 后 `.gitignore` 被创建且仅含 `.yorz/tmp`；（2）临时 cwd 含 `.git` 与已有 `.gitignore`（已包含 `.yorz/tmp`），install 后内容不变；（3）临时 cwd 无 `.git`，install 后无 `.gitignore` 文件被创建/修改。

## 7. 执行记录

- 2026-06-29：新建 spec，初始化文档结构；完成 plan 阶段——现状分析（3.1-3.7）覆盖 AgentRunner 内存 buffer 生命周期、ProjectRegistry materialize 钩子、AttachmentStore 清理范式、SSE buffer 回放局限、SpecDetail/dock 现有交互、install.ts 当前对 cwd 无感知；技术实现方案（4.1-4.8）给出 `.yorz/tmp/agent-logs/<specId>/<runId>.{log,json}` 数据模型、新增 `AgentLogStore`、AgentRunner 注入 writer、HTTP list/get 路由、CLI install 新增 `ensureTmpIgnored()`；`## 5. 待确认问题` 提出 P-1 ~ P-7 待用户批注；等待人工确认后进入 tasks。
- 2026-06-29：消费 P-1 ~ P-7 批注——P-1/P-3/P-4/P-5/P-6/P-7 锁定推荐方案；P-2 改为"新增独立子页面（仿 review 路由）"，相应改写 4.6 章节（DOM 结构由"插入到 SpecDetail 底部"调整为"新建 `SpecAgentLogs.tsx` + 新增路由 + 头部链接入口"）并更新 4.8 影响范围表；待确认问题清空；拆出 7 大组共 19 项可执行任务（AgentLogStore / AgentRunner 接线 / ProjectRegistry / HTTP 路由 / GUI API / GUI 页面与样式 / CLI install），等待 execute 阶段实施。
- 2026-06-29：execute 阶段一次性落地全部 19 项任务。改动点：
  - **服务端**：新建 `src/service/agent-log-store.ts`（`AgentLogStore` + 文件型流式写入 + 90 天 TTL 清理）；新建 `src/service/__tests__/agent-log-store.test.ts`（6 用例覆盖 ensureRoot/writer/list 排序/read 截断/cleanup 按 endedAt 与 mtimeMs 兜底）。
  - **AgentRunner**（`src/service/agent.ts`）：`AgentRunnerOptions` 新增 `logStore?`；`spawn()` 入口构造 writer（异步 ready，期间 chunk 入队后 flush）；`pushStdout` 同时写内存 buffer 与 writer；`exit/error/同步 spawn 失败` 三路径均 `finalize`；`run()` 入口 fire-and-forget 触发 `cleanupExpired`。
  - **ProjectRegistry**（`src/service/project-registry.ts`）：新增 `agentLogs: AgentLogStore` 字段；`materialize()` 实例化、`startPromise` 调用 `ensureRoot()` + `cleanupExpired()`、并把 logStore 注入 AgentRunner。
  - **HTTP 路由**：新建 `src/service/routes/agent-logs.ts`（`GET .../agent-logs` 列表 + `GET .../agent-logs/:runId` 单条，读取截断 256KB）；`src/service/server.ts` 挂载。
  - **GUI**：`src/gui/src/lib/api.ts` 导出 `AgentLogMeta/AgentLogPayload/AgentLogMode` 类型与 `listAgentLogs/getAgentLog`；新建 `src/gui/src/pages/SpecAgentLogs.tsx`（独立页面 + 卡片折叠 + 按需懒加载 + 手动刷新）；`src/gui/src/main.tsx` 新增路由 `/:projectId/specs/:id/agent-logs`；`SpecDetail.tsx` 头部增 "执行日志" 链接；`styles.css` 新增 `.spec-agent-logs .*` 卡片样式。
  - **CLI**：`src/cli/install.ts` 新增 `ensureTmpIgnored()`（.git 文件/目录检测、按行幂等扫描、自动补尾换行）并在 `install()` 末尾调用，返回值带 `gitignore` 字段；`src/cli/index.ts` install 命令打印 gitignore 处理结果；`src/cli/__tests__/install.test.ts` 新增 3 个用例（无 .gitignore / 已 ignore / 非 git 仓库）。
  - 验证：`pnpm exec vitest run` → 24 文件 / 191 用例全部通过（新增 6 + 3 = 9 个）；`pnpm run build` cli + gui 均构建成功，无类型错误。
  - 备注：本仓库自身的 `.gitignore` 是否追加 `.yorz/tmp` 不在本 spec 改动范围（按 4.8 表，手工追加）；GUI 行为尚未在浏览器端实测，需要 `pnpm dev` 联调验证（受当前环境限制未跑）。

## 流程状态

- 当前阶段：execute
- 最近动作：完成全部 19 项任务实施；测试 191 passed、构建通过；GUI 端浏览器实测未跑（需要 `pnpm dev` 联调）
- 更新时间：2026-06-29

## 用户批注

（已全部消费，相关决策见 §5.1 已确认的决策）
