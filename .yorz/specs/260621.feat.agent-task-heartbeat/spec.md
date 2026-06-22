---
stage: execute
last_action: 完成代码改动与自动化测试；本地手测待用户在 GUI 环境完成
updated_at: 2026-06-21
summary: 为 Agent 任务执行引入心跳机制，Server 异常退出时 GUI 能及时识别失联并把任务标记为失败，避免长期卡死在 streaming 状态。
---

# Agent 任务心跳机制

## 1. 背景

YorZ Service 在 dev 环境出现过整体崩溃的情况：vite 的 `closeBundle` 钩子拷贝 `src/skill/SKILL.md` 失败抛出 `ENOENT`，pnpm orchestrator 把 SIGTERM 级联给 `serve` 子进程，Service 进程被强制关闭。

崩溃时正在执行的 Agent 任务在 GUI 侧仍显示为 `streaming`，没有任何提示也无法重新触发，必须手动刷新或重启 GUI 才能恢复，体验上等同于"任务卡死"。本 spec 旨在补齐 Agent 任务执行的心跳机制，从源头消除该卡死现象。

复现日志片段：

```
[cli] Error: ENOENT: no such file or directory, copyfile '.../src/skill/SKILL.md' -> '.../dist/skill/SKILL.md'
[cli]   plugin: 'yorz:post-build', hook: 'closeBundle'
[cli] vite build --watch exited with code 1
--> Sending SIGTERM to other processes..
[serve] Shutting down YorZ Service...
[serve] node dist/cli/index.js serve exited with code SIGTERM
```

## 2. 需求

- Server 进程异常退出（崩溃 / 被 kill / 网络中断）时，GUI 端能在可接受时间内识别失联，把仍在执行的 Agent 任务从 `streaming` 切到 `failed`，并给出明确原因（如「Server 失联」），不再无限期等待。
- Server 重启后，新启动的 Service 不应"复活"旧任务为运行中，而应让 GUI 把这些任务视作失败 / 终止（旧任务恢复不在本次范围内）。
- 心跳机制不应显著增加正常 Agent 任务的资源开销（CPU / 网络）。
- 不依赖任何额外的进程监管软件（systemd / pm2 等）即可工作。

## 3. 现状分析

### 3.1 任务状态机与持久化

- GUI 端任务状态定义于 `src/gui/src/lib/agent-tasks.ts:11`，枚举：`'pending' | 'streaming' | 'done' | 'failed'`。
- 状态切换三入口（`agent-tasks.ts:93-133`）：
  - `onAgentStdout` → `pending` 切 `streaming`
  - `onAgentExit` → `done` / `failed`
  - `onAgentError` → `failed`
- **关键缺陷**：没有第四个入口处理"长时间无任何事件"，因此一旦 SSE 静默就会永久停在 `streaming`。
- Server 端 Agent 句柄 `AgentRunHandle` 仅存于 `AgentRunner.handlesById` 内存 Map（`src/service/agent.ts:56-57`），Service 退出即全部丢失。`.yorz/specs/<id>/spec.md` frontmatter 里只有 spec 自身的 `stage`，没有 Agent run 的执行态。

### 3.2 子进程与生命周期

- Agent 子进程使用 `spawn(..., { detached: true })`（`agent.ts:156`），独立进程组。
- Service 进程被 SIGTERM 时，`serve.ts:25-26` 调用 `shutdown()`，但 `handle.close()` 链路只关 server 与 watcher，**没有显式 kill 已在运行的 Agent 子进程**——孤儿 Agent 进程可能继续运行，但 GUI 已经无法收到它的输出（SSE 断开 + handle 丢失）。
- pnpm orchestrator 级联 SIGTERM 时，Agent 子进程因 detached 不在同一进程组，是否被同时收死取决于上游 shell。
- 本期不主动 kill 子进程；孤儿进程的资源回收留给后续 spec 处理。

### 3.3 SSE 传输与重连

- GUI 通过 EventSource 订阅 `/api/runs/:runId/events` 与 `/api/specs/:id/events`（`src/gui/src/lib/sse.ts:30,78`）。
- EventSource 内建自动重连，但 `sse.ts:58-59,103-105` 对 `error` 事件仅 `// no-op`，错误信息**不会冒泡到 task 状态机**。
- Server 崩溃后 EventSource 会一直在后台尝试重连，GUI 视觉上没有任何反馈。
- 服务重启后 `fetchActiveRuns()`（`sse.ts:121`）会返回空数组，但 GUI 端已挂掉的 task 仍留在 `state.tasks` 中，不会被"自动失败化"。

### 3.4 已有兜底能力

- `AgentRunner.listActive()` / `cancel(runId)` 可枚举与终止活跃 run，但前提是 Server 还活着。
- `agent.ts:48-49` 有 `KILL_GRACE_MS = 2000`，但属于"主动 kill 的优雅期"，与心跳无关。
- 现有代码中无任何 `heartbeat` / `watchdog` / `stale` / `ping` 关键字命中。

## 4. 技术实现方案

### 4.1 总体思路：连接级心跳 + 客户端 watchdog + 重启对账

按用户批注收敛后，心跳只承担「Server 是否还活着」一件事：

- Agent 子命令自身的任务超时由 agent 内部控制，本 spec 不引入 per-run 心跳。
- 因此心跳挂在 **SSE 连接级别**（而不是 per-run / per-EventEmitter），所有现有 SSE 路由共享同一份心跳实现。
- 同一笔心跳同时承担两件事：
  1. 写入 SSE 注释行 `: keep-alive\n\n`，绕过反向代理（nginx / cloudflare 默认 30~60s 空闲断流）的传输层超时。
  2. 写入命名事件 `server-heartbeat`（payload `{ ts }`），供 GUI watchdog 刷新 `lastEventAt`。
- GUI 端用一个全局轻量 watchdog 判定「Server 失联」并把任务切到 `failed`；服务重启回连后再用 active runs 列表对账，把孤儿 task 标失败。

### 4.2 Server 侧改动

仅改 `src/service/routes/events.ts`：

- 新增常量 `HEARTBEAT_INTERVAL_MS = 5000`。
- 抽取 helper `attachHeartbeat(stream): () => void`：
  - `setInterval` 内调用 `stream.writeSSE({ event: 'server-heartbeat', data: JSON.stringify({ ts: Date.now() }) })`。
  - 写入失败（流已关闭）时静默忽略，由 `onAbort` 兜底清理。
  - 返回清理函数 `clearInterval`。
- 在三条 SSE 流（`/events/specs`、`/specs/:id/events`、`/runs/:runId/events`）中：
  - 在初始 `ready` 事件之后立即调用 `attachHeartbeat(stream)`。
  - `stream.onAbort` 中调用心跳清理函数。
- Service 启动时由现有日志体系打印 `agent heartbeat enabled (interval=5s)` 一行 `info`（位置：`src/service/serve.ts` 或 `src/service/index.ts` 启动处，就近接现有 `console.log` 风格）。

### 4.3 GUI 侧改动

`src/gui/src/lib/sse.ts`：

- 新增类型 `ServerHeartbeatEvent { ts: number }`。
- `SpecSubscribeHandlers` / `RunSubscribeHandlers` 各加可选 `onServerHeartbeat?: (e: ServerHeartbeatEvent) => void`。
- 在两个 `subscribe*` 函数中 `addEventListener('server-heartbeat', ...)` 并在 cleanup 中移除。
- `subscribeRun` / `subscribeSpec` 返回值改为 `{ unsubscribe: () => void; readyState: () => number }`（或在外层暴露 `source.readyState` 探针），便于 watchdog 判定 SSE 是否处于 `OPEN`。**实施时优先保留原 unsub 函数语义、改用扩展属性**，避免破坏现有调用方。

`src/gui/src/lib/agent-tasks.ts`：

- `AgentTask` 增加 `lastEventAt: number`（在 `start()` 中初始化为 `startedAt`）。
- `onAgentStdout` / `onServerHeartbeat` / `onAgentExit` / `onAgentError` 内均刷新 `lastEventAt = Date.now()`。
- `Internal` 中存 `unsubByRun: Map<string, { unsubscribe: () => void; readyState: () => number }>`。
- 新增模块级 watchdog：常量 `STALE_AFTER_MS = 20_000`、`WATCHDOG_TICK_MS = 2_000`。
  - 仅在存在活跃任务（`pending|streaming`）时启动 `setInterval`，全部任务结束后停掉，避免常驻成本。
  - 每 tick 遍历活跃任务：若 `Date.now() - t.lastEventAt > STALE_AFTER_MS` 且 `readyState() !== EventSource.OPEN`，将任务标 `failed`，`error = 'Server 失联，任务可能已终止'`。
- 新增 `reconcileWithActive(activeIds: Set<string>)`：把本地 `pending|streaming` 但不在列表中的 task 标 `failed`，`error = 'Server 已重启，原任务未恢复'`。
- 改造 `hydrateFromActiveRuns()`：先 `fetchActiveRuns()` → `reconcileWithActive(new Set(list.map(i => i.runId)))` → 再为列表中条目调用 `start()`。

### 4.4 配置与可观测

- 心跳间隔与超时阈值放在 `src/service/routes/events.ts` 与 `src/gui/src/lib/agent-tasks.ts` 顶部常量，便于后续微调，不引入用户可配项。
- Server 启动时打印 `agent heartbeat enabled (interval=5s)`。
- 不新增持久化文件（`.yorz/runs/*.json` 之类），降低改动面与风险；恢复语义留给后续 spec。

### 4.5 边界与例外

- 心跳与 stdout 共用 `lastEventAt`：高频 stdout 也算心跳来源，因此 chatty agent 不会触发误判。
- 极慢但仍在运行的 agent（如长 think 阶段）由 Server 端连接级心跳兜底（5s 一次），不会被误判 stale。
- GUI 处于 tab 后台时浏览器会节流 `setInterval`；最坏情况下 stale 检测延迟到用户切回 tab 时触发，仍能避免"永久卡死"。
- `dismiss()` / `cancelRun()` 不变；watchdog 只看 `pending|streaming` 任务，已结束/已 dismiss 的不会再被改写。
- 不修改 Service `shutdown()`：心跳负责"UI 卡死"，孤儿子进程的资源回收不在本期范围。

### 4.6 测试策略

- Server：在 `src/service/routes/events.spec.ts`（新增或就近）用 vitest fake timers 断言连接建立后定期写入 `server-heartbeat`，断流后清理 interval。
- GUI：为 `agent-tasks.ts` 新增单测，模拟 SSE 断开 + 超时，断言任务被切到 `failed`；模拟 `reconcileWithActive` 行为。
- E2E / 手测：本地 `pnpm dev` → 启动一个 skill-run → kill -9 Service 进程 → 预期 ~20s 内 GUI 任务切为「Server 失联」失败态。

## 5. 待确认问题

- 暂无

## 6. 任务清单

- [x] 在 `src/service/routes/events.ts` 顶部新增 `HEARTBEAT_INTERVAL_MS = 5000` 与 `attachHeartbeat(stream)` helper：每 `HEARTBEAT_INTERVAL_MS` 写一次 `: keep-alive\n\n` 注释行 + `server-heartbeat` 事件（payload `{ ts }`），返回清理函数；写入失败静默忽略
- [x] 在 `events.ts` 的三条 SSE 流（`/events/specs`、`/specs/:id/events`、`/runs/:runId/events`）的 `ready` 之后挂载 `attachHeartbeat`，`stream.onAbort` 中调用清理函数；验收：手动连接后能看到周期性 `server-heartbeat`，断流后 interval 释放
- [x] 在 Service 启动处（`src/service/serve.ts` 或 `src/service/index.ts`）增加一行启动日志 `agent heartbeat enabled (interval=5s)`，与现有日志风格一致
- [x] 在 `src/gui/src/lib/sse.ts` 新增 `ServerHeartbeatEvent` 类型；`SpecSubscribeHandlers` / `RunSubscribeHandlers` 各加 `onServerHeartbeat?`；`subscribeSpec` / `subscribeRun` 注册 `server-heartbeat` 监听，并在返回的 unsubscribe 函数上挂 `readyState()` 探针（保持原 unsub 调用方式不破坏现有调用）
- [x] 在 `src/gui/src/lib/agent-tasks.ts` 给 `AgentTask` 增加 `lastEventAt: number`；在 `start()` 初始化、在 stdout / heartbeat / exit / error 回调中刷新；`Internal.unsubByRun` 存储 `{ unsubscribe, readyState }`
- [x] 在 `agent-tasks.ts` 增加 watchdog：常量 `STALE_AFTER_MS = 20_000` / `WATCHDOG_TICK_MS = 2_000`；存在活跃 `pending|streaming` 任务时启动 `setInterval`，无活跃任务时停；每 tick 把 `Date.now() - lastEventAt > STALE_AFTER_MS` 且 `readyState() !== EventSource.OPEN` 的任务切 `failed`、`error = 'Server 失联，任务可能已终止'`
- [x] 在 `agent-tasks.ts` 新增 `reconcileWithActive(activeIds: Set<string>)`：将本地 `pending|streaming` 但不在列表中的 task 标 `failed`、`error = 'Server 已重启，原任务未恢复'`；改造 `hydrateFromActiveRuns()` 先 reconcile 再 start
- [x] 为 `events.ts` 新增/扩展测试：用 vitest fake timers 断言连接后周期性触发 `server-heartbeat` 写入，断流后 interval 清理；放在 `src/service/__tests__/events-heartbeat.test.ts`
- [x] 为 `agent-tasks.ts` 新增单测：用 fake timers 模拟 SSE 静默 > 20s 且 readyState 非 OPEN，断言任务切 `failed`；模拟 `reconcileWithActive` 列表缺失断言切 `failed`
- [ ] 本地手测：`pnpm dev` 起一个 skill-run → `kill -9` Service 进程 → ~20s 内 GUI 任务切为「Server 失联」失败态，记录到执行记录

## 7. 执行记录

- Server 心跳：`src/service/routes/events.ts` 新增 `HEARTBEAT_INTERVAL_MS = 5000` 与 `attachHeartbeat(stream)` helper（每 5s 写 `: keep-alive\n\n` 注释 + `server-heartbeat` 命名事件，payload `{ ts }`），并在 `/events/specs`、`/specs/:id/events`、`/runs/:runId/events` 三条流的 `ready` 之后挂载、`onAbort` 中清理；`src/service/index.ts` 启动时新增日志 `agent heartbeat enabled (interval=5s)`
- GUI SSE 层：`src/gui/src/lib/sse.ts` 新增 `ServerHeartbeatEvent` / `SseSubscription`，`subscribeSpec` / `subscribeRun` 注册 `server-heartbeat` 监听，并在返回的 unsubscribe 函数上挂 `readyState()` 探针；签名兼容现有 `() => void` 调用方
- GUI agent-tasks：`src/gui/src/lib/agent-tasks.ts` 给 `AgentTask` 加 `lastEventAt`，导出常量 `STALE_AFTER_MS = 20_000` / `WATCHDOG_TICK_MS = 2_000`；新增 `tickWatchdog` / `ensureWatchdog` / `stopWatchdog`（活跃任务时启动 setInterval、全部结束时停），符合 stale + readyState != OPEN 条件即标 `failed` 并记 `error = 'Server 失联，任务可能已终止'`；新增 `reconcileWithActive(activeIds)` 把本地 `pending|streaming` 且不在列表中的 task 标 `failed`，`hydrateFromActiveRuns()` 先 reconcile 再 start；导出 `createAgentTasks` 工厂便于单测
- 测试：新增 `src/service/__tests__/events-heartbeat.test.ts`（vitest fake timers 验证 `attachHeartbeat` 周期写入与停止、写失败静默吞噬）与 `src/gui/src/lib/__tests__/agent-tasks.test.ts`（覆盖 stale flip、OPEN 时不误判、heartbeat 刷新 lastEventAt、reconcileWithActive 缺失/在列表两种分支）；`pnpm vitest run` 全量 119 用例通过；`npx tsc --noEmit` 清洁
- 阻塞：本地 `pnpm dev` + GUI + `kill -9` Service 的手测需在 GUI 操作环境执行，当前自动化 agent 环境无法验证；保留任务未勾选，待用户在 GUI 中验证后补勾
