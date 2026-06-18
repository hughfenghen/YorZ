---
stage: execute
last_action: 完成全部任务清单，服务端单测与 GUI 构建通过
updated_at: 2026-06-17
summary: 提供独立于 spec 详情页的 Agent 输出面板组件，跨页面保持 cli server SSE 连接，支持多实例并行展示批注/解释/执行 spec 等 Agent 任务的流式输出。
---

# Agent Stream Panel

## 1. 背景

需要一个独立于 spec 页面的 Agent 输出内容组件，用户使用解释功能或者执行 spec 时，Agent 输出的内容需要流式转发到这个组件；即使离开 spec 页面，该组件应该继续保持 cli server - Agent 的流式连接；组件允许存在多个实例，对应当前正在执行的 Agent 任务。

## 2. 需求

- 提供独立的 Agent 输出面板组件，不再耦合在 spec 详情页内部。
- 组件挂载点应在路由切换之外，离开 spec 页面后仍保持原有流式连接与输出累计。
- 允许同时存在多个面板实例，每个实例对应一个正在执行的 Agent 任务（来源可能是「解释」「执行 spec」「新建 spec 草稿」等）。
- 用户可在多个面板之间切换/展开/收起，能感知任务来源与所属 spec。
- 提交批注不触发 Agent，维持当前语义；但用户运行任何 Agent 任务时都需要创建一个 UI 面板实例承载其流式输出。
- 页面刷新后，仍在运行的 Agent 任务应自动回填到 dock，继续展示输出。

## 3. 现状分析

- `src/gui/src/lib/sse.ts` 已暴露三个 EventSource 订阅器：
  - `subscribeSpec(specId, handlers)` —— 同时投递 `updated` / `agent-stdout` / `agent-exit` / `agent-error`，服务器侧通过 `runner.active(specId)` + `runner.subscribe(specId)` 进行回灌与监听。
  - `subscribeRun(runId, handlers)` —— 按 runId 精确订阅单个 Agent 进程，并通过 `handle.buffer()` 回灌已有输出，是跨页面续流最自然的通道。
  - `subscribeSpecsList(onChange)` —— 列表刷新。
- `src/service/agent.ts` 的 `AgentRunner` 在内存中维护 `handlesById` 与 `skillRunBySpec`：进程退出即从内存清空；目前未暴露 `list active runs` 接口，刷新页面后前端无法重新发现「还在跑的任务」。
- `src/service/routes/specs.ts` 触发 Agent 的入口：
  - `POST /specs/:id/run` → mode `skill-run`，绑定真实 specId。
  - `POST /specs/:id/explain` → mode `explain`，绑定真实 specId。
  - `POST /specs` 草稿模式 → mode `skill-run`，specId 为 `__draft__-<rand>`（用于新建 spec 时由 Agent 决定 id）。
  - `POST /specs/:id/inputs` 仅追加批注到 md，**不触发 Agent**。
- `src/service/routes/events.ts` 中 `GET /runs/:runId/events` 在订阅时会先 `handle.buffer()` 回灌已有输出，刷新后只要拿到 runId 就能续接。
- 当前消费端散落在两个 page：
  - `src/gui/src/pages/SpecDetail.tsx`：在 `createEffect` 内 `subscribeSpec` + 可选 `subscribeRun`，把 `log` / `runStatus` / `explainText` / `explainStatus` 作为本地 signal 持有；`onCleanup` 一执行整个流就断开。
  - `src/gui/src/pages/NewSpec.tsx`：用 `subscribeRun(draftRunId)` 累计 log，跳转后由 SpecDetail 通过 query `?runId=` 重新接管。
  - `src/gui/src/components/ExplainDrawer.tsx` 仅做展示，无订阅。
- `src/gui/src/AppShell.tsx` 是路由根布局（顶栏 + `main`），是放置全局面板的天然挂载点；`src/gui/src/main.tsx` 用 `<Router root={AppShell}>` 包裹三条路由。
- Solid 的 `createRoot` 可让 store 脱离任一组件的生命周期常驻；EventSource 在浏览器端会自动重连，不需要心跳。

## 4. 技术实现方案

### 4.1 总体思路

引入一个常驻全局的 **Agent Tasks Store**，承担三件事：

1. 注册「Agent 任务」：任何触发 Agent 的入口（执行 spec / 解释选区 / 草稿创建 spec）都改成调用 `agentTasks.start({ runId, mode, specId, specTitle?, source })`。提交批注的入口保持不变，不创建任务。
2. 持有按 runId 的 SSE 订阅与输出缓冲：内部用 `createRoot` 启动，对每个 runId 调用 `subscribeRun` 累计 `chunk`，在 `exit` / `error` 时更新状态；store 不随 page 卸载而销毁。
3. 向 UI 暴露响应式的任务列表与控制方法（关闭、清空、展开/收起）。

UI 层新增 `<AgentPanelDock />`，放在 `AppShell` 的 `<main>` 同级，作为右下角悬浮 dock。每个任务对应一张「面板实例」卡，可独立展开/收起；多实例同时存在即可天然满足需求。

### 4.2 数据模型

`AgentTask`：

- `runId: string`（主键）
- `mode: 'skill-run' | 'explain'`
- `specId: string`（草稿时为 `__draft__-xxx`，需要在 store 内提供 `displaySpecId` 与「跳转链接是否可用」的派生）
- `specTitle?: string`（页面已知则传入，便于卡片显示）
- `source: 'run' | 'explain' | 'draft'`（用于 badge 文案）
- `status: 'pending' | 'streaming' | 'done' | 'failed'`
- `output: string`（累计的 stdout）
- `error?: string`
- `startedAt: number`、`endedAt?: number`
- UI 态：`expanded: boolean`、`dismissed: boolean`（dismissed 后从 dock 移除，但 store 内保留直至刷新或显式清空）

存放在 `createStore<{ tasks: Record<string, AgentTask>; order: string[] }>`，便于 Solid 细粒度更新；导出 `useAgentTasks()` 在任何组件内取用。

### 4.3 模块拆分

- 新增 `src/gui/src/lib/agent-tasks.ts`
  - `createRoot` 内初始化 store、`subscribeRun` 注册表（`Map<runId, () => void>`）。
  - 方法：`start(input)`、`dismiss(runId)`、`toggleExpand(runId)`、`clearFinished()`、`hasRunningSkillRun(specId)`、`hydrateFromActiveRuns()`。
  - 启动时主动遍历已存在但仍未结束的订阅，无需特殊处理（页面只会调用一次 `start`，重复调用直接复用，幂等）。
- 新增 `src/gui/src/components/AgentPanelDock.tsx`
  - 渲染右下角悬浮 dock：顶部按数量 badge，折叠时为「胶囊」；展开后列出每张任务卡。
  - 卡片包含：mode badge、`specId` / `specTitle`、status、运行计时、`pre` 输出区（自动滚到底）、关闭按钮、跳转 spec 按钮（仅在非 `__draft__` 时显示）。
- 在 `src/gui/src/AppShell.tsx` 内挂载 `<AgentPanelDock />`（位于 `<main>` 之后）。
- 修改 `src/gui/src/pages/SpecDetail.tsx`：
  - `runAgent()` / `openExplain()` 成功拿到 runId 后调用 `agentTasks.start(...)`。
  - 删除 page 内部的 `log` / `runStatus` / `runId` / `explainText` / `explainStatus` / `explainRunId` 等本地态以及对应的 `subscribeRun` `createEffect`。
  - `subscribeSpec` 保留：仅用于 `onUpdated` 触发文档刷新；不再处理 `agent-stdout/exit/error`，避免与 store 重复。
  - 「运行 Agent」按钮 disabled 判断依据改为 `agentTasks.hasRunningSkillRun(specId)`。
  - 移除内联日志区与 `ExplainDrawer`；解释流统一由 dock 呈现。
- 修改 `src/gui/src/pages/NewSpec.tsx`：
  - `createSpec` 拿到 draft runId 后调用 `agentTasks.start({ runId, mode: 'skill-run', specId: <draftSpecId 占位>, source: 'draft', specTitle: '（新建 spec 中）' })`。
  - 页面本地的 `log` 与 `cleanupRun` 仅在「等待跳转」的提示文案中保留极简显示；订阅由 store 拥有，离开 NewSpec 页不再断流。
  - 列表轮询逻辑保持不变；跳转目标仍然带 `?runId=...`，但 SpecDetail 的 URL 接管逻辑简化为「向 store 注册一次 `start({runId, specId: 真实id, source: 'draft'})`，并清除 query」。
- 删除 `src/gui/src/components/ExplainDrawer.tsx` 文件及其所有 import 引用。
- `src/gui/src/styles.css`：新增 dock 与卡片样式（沿用现有色板）。

### 4.4 跨页面续流的保证点

- store 由 `createRoot` 拥有，路由组件销毁不影响订阅。
- 每个 runId 在 store 内只订阅一次；`start` 入口对已存在的 runId 直接返回，幂等。
- EventSource 本身在网络/服务端瞬断时自动重连；服务端 `subscribeRun` 在 `/runs/:runId/events` 路由进入时会主动 `handle.buffer()` 把已有输出 flush 给新连接，重连后不会丢早期日志（前提是 Agent 进程仍在内存中，即未 exit）。
- 任务在收到 `exit` / `error` 后保留输出与状态，标记为 `done` / `failed`，由用户主动「关闭」从 dock 移除。

### 4.5 页面刷新后回填

- 服务端 `AgentRunner` 新增 `listActive(): Array<{ runId: string; mode: AgentMode; specId: string; startedAt: number }>`：遍历 `handlesById` 返回当前仍在内存中的进程；同时在 `spawn()` 时把 `startedAt = Date.now()` 写入 handle，便于回填时还原计时。
- 服务端在 `src/service/routes/events.ts`（或新增 `src/service/routes/runs.ts`）注册 `GET /runs`：返回 `runner.listActive()` JSON。
- GUI 侧在 `agent-tasks.ts` 暴露 `hydrateFromActiveRuns()`：调用 `GET /api/runs`，对每个返回项调用 `start(...)`，由 store 自行通过 `subscribeRun` 回灌 buffer 与续接事件。
- 在 `AppShell` 挂载时执行一次 `agentTasks.hydrateFromActiveRuns()`。

### 4.6 多实例呈现与自动消退

- dock 支持任意条目；超过 N（建议 3）默认折叠为列表，展开后纵向堆叠。
- 同一 specId 的 `skill-run` 由 runner 端去重（已有），所以同一 spec 不会出现两条 skill-run；`explain` 与 `skill-run` 可并存，多 spec / 多 explain 也可并存。
- 任务结束自动消退策略：
  - `status === 'done'`：30 秒后自动 `dismissed = true`（仅从 dock 折叠移除，store 内保留以备「显示已完成任务」入口在后续版本接入），用户可在 30s 内手动关闭。
  - `status === 'failed'`：不自动消失，必须由用户手动关闭，以避免错过错误信息。

### 4.7 不在本期范围

- 服务端「已结束 Agent 输出」的持久化（刷新页面后查看历史） — 当前 runner 不存历史，本期沿用同样语义；本期只回填仍在运行中的任务。
- 让批注触发 Agent 的语义改造（已确认本期不做）。

## 5. 待确认问题

- 暂无

## 6. 任务清单

- [x] 在 `src/service/agent.ts` 的 `AgentRunner` 增加 `listActive(): Array<{ runId, mode, specId, startedAt }>`：spawn 时记录 `startedAt`，遍历 `handlesById` 返回所有未退出条目；为现有 `AgentRunHandle` 类型补 `startedAt` 字段
- [x] 在 `src/service/routes/events.ts`（或拆分到 `src/service/routes/runs.ts`，由实现者选择更整洁的位置）新增 `GET /runs` 路由，返回 `runner.listActive()` 的 JSON 数组；并在 `src/service/server.ts` 中确保挂在 `/api` 下
- [x] 为 `AgentRunner.listActive()` 与 `GET /runs` 增加最小单测（位于 `src/service/__tests__/`）：覆盖「无活跃任务返回 []」「有活跃任务包含 runId/mode/specId/startedAt」
- [x] 在 `src/gui/src/lib/sse.ts` 增加 `fetchActiveRuns(): Promise<ActiveRunInfo[]>` helper（与已有订阅 API 共享类型）
- [x] 新增 `src/gui/src/lib/agent-tasks.ts`：在 `createRoot` 内创建 `createStore<{tasks: Record<string, AgentTask>; order: string[]}>`，实现 `start`/`dismiss`/`toggleExpand`/`clearFinished`/`hasRunningSkillRun`/`hydrateFromActiveRuns`；内部用 `subscribeRun` 累计 stdout、监听 exit/error 更新 status 并写入 endedAt
- [x] 在 `agent-tasks.ts` 实现自动消退：任务进入 `done` 时设置 30s `setTimeout` 自动 `dismiss(runId)`；进入 `failed` 不自动消退；同一任务 done→dismiss 内的手动关闭需清除该定时器
- [x] 新增 `src/gui/src/components/AgentPanelDock.tsx`：右下角悬浮 dock，折叠胶囊 + 展开任务卡列表，卡片含 mode badge、specId/specTitle、status、运行计时（基于 startedAt）、`pre` 输出区（自动滚到底）、关闭按钮、跳转 spec 按钮（非 `__draft__` 时显示）
- [x] 在 `src/gui/src/styles.css` 增加 dock 与卡片样式（沿用现有色板）
- [x] 在 `src/gui/src/AppShell.tsx` 引入并渲染 `<AgentPanelDock />`（位于 `<main>` 之后），并在挂载时调用一次 `agentTasks.hydrateFromActiveRuns()`
- [x] 修改 `src/gui/src/pages/SpecDetail.tsx`：删除 `log/runStatus/runId/explainText/explainStatus/explainRunId` 等本地态与 `subscribeRun` 调用；`runAgent`/`openExplain` 成功后调用 `agentTasks.start(...)`；`subscribeSpec` 仅保留 `onUpdated`；运行按钮 disabled 改用 `agentTasks.hasRunningSkillRun(specId)`；移除内联日志区与 `ExplainDrawer` 引用
- [x] 修改 `src/gui/src/pages/NewSpec.tsx`：拿到 draft runId 后调用 `agentTasks.start({runId, mode: 'skill-run', specId: draftSpecId, source: 'draft', specTitle: '（新建 spec 中）'})`，本地仅保留极简等待提示；跳转后让 SpecDetail 用 `?runId=` 注册一次真实 specId 的 task 并清除 query
- [x] 删除 `src/gui/src/components/ExplainDrawer.tsx` 与所有 import 引用
- [x] 运行 `npm run lint` / `npm run typecheck` / `npm test`（按仓库可用脚本为准），把结果写入「执行记录」；如有环境限制，记录原因

## 7. 执行记录

- 2026-06-17 服务端：`AgentRunner` 新增 `startedAt` 与 `listActive()`；`GET /api/runs` 路由在 `src/service/routes/events.ts` 内挂载；新增 2 个单测（`agent.test.ts` listActive 空/活跃用例 + `service.test.ts` HTTP 列表回归）。`npx vitest run`：6 个文件 / 45 用例全部通过。
- 2026-06-17 GUI 层：新增 `src/gui/src/lib/agent-tasks.ts`（基于 `createRoot` + `createStore` 的全局 Agent 任务 store，含 `start` 幂等更新、`dismiss`、`toggleExpand`、`clearFinished`、`hasRunningSkillRun`、`hydrateFromActiveRuns`；done 任务 30s 后自动折叠，failed 不自动消退）；新增 `src/gui/src/components/AgentPanelDock.tsx` 渲染右下角浮窗；在 `AppShell` 挂载并在 `onMount` 调用 `hydrateFromActiveRuns()`；在 `src/gui/src/lib/sse.ts` 增加 `fetchActiveRuns()` 与 `ActiveRunInfo` 类型；在 `styles.css` 追加 dock/卡片样式。
- 2026-06-17 改造调用方：`SpecDetail.tsx` 移除 `log/runStatus/runId/explainText/explainStatus/explainRunId` 与对应 `subscribeRun` `createEffect`，`subscribeSpec` 仅保留 `onUpdated`；`runAgent`/`openExplain` 拿到 runId 后调用 `agentTasks.start(...)`；按钮 disabled 改用 `agentTasks.hasRunningSkillRun(specId)`；移除 `ExplainDrawer` 引用。`NewSpec.tsx` 拿到 draft runId 后调用 `agentTasks.start({...specId: '__draft__-<runId>', source: 'draft'})`，跳转交由 SpecDetail 用 `?runId=` 再次 `start(realSpecId)` 完成 specId 改写；本地仅保留等待提示文案。删除 `src/gui/src/components/ExplainDrawer.tsx` 与残余 `.explain-drawer*` 样式。
- 2026-06-17 验证：`npx tsc --noEmit` 通过；`npm test` 通过（45/45）；`npm run build:gui` 通过（113 modules，CSS 9.74 kB / JS 164.95 kB）。仓库无 lint 脚本，已跳过；e2e 未执行（无变更需要 UI 端到端复测，留待 `npm run test:e2e` 由用户在浏览器视觉验证后追跑）。
