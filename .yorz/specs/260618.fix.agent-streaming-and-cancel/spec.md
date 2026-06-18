---
stage: execute
last_action: 完成全部任务，单测与 GUI 构建通过
updated_at: 2026-06-18
summary: 修复 Agent 任务面板三处问题：CLI 子进程输出未真正流式，关闭卡片不会中止 cli server 中正在运行的 AI 任务，任务卡片在完成后会自动消失。
---

# Agent Streaming & Cancel

## 1. 背景

[[260617.feat.agent-stream-panel]] 上线后，全局 dock 已能展示多任务并跨页面续流，但在真实使用中暴露 3 个体验/正确性问题，影响用户对长任务的可观察性与可控性：

1. Agent 卡片在任务完成之前几乎没有内容，进度条只能"等到 exit 才一次性回填"，与"流式输出"的预期不符。
2. 用户点击卡片右上角 `×` 时只移除了 UI，cli server 中的 Agent 子进程仍在继续消耗资源，与"关闭即取消"的心智模型不符。
3. 完成态卡片 30 秒后自动消失（[[260617.feat.agent-stream-panel]] §4.6），导致用户来不及阅读结果，需要改为只在用户显式关闭时移除。

## 2. 需求

- Agent 标准输出必须在子进程持续运行过程中流式投递到 GUI，而不是等到进程退出时一次性出现。
- dock 中卡片点击 `×` 时：cli server 必须立即中断该 runId 对应的 Agent 子进程（含子孙进程），并将其在内存中的 handle 清理掉；前端在收到服务端确认后才把卡片从 dock 上移除（或先乐观移除并由 SSE 关闭确认）。
- 任务卡片在 `done` / `failed` 后不再自动消失，仅当用户点击 `×` 或调用 `clearFinished()` 时才从 dock 中移除。

## 3. 现状分析

### 3.1 流式输出

- `src/service/agent.ts` 的 `spawn(input)` 用 `child_process.spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })` 启动 Agent 进程，通过 `child.stdout.on('data', ...)` 把每个 chunk 直接 `emitter.emit('stdout', text)`。该环节本身是流式的，**chunk 多大 / 多频，取决于子进程**。
- `src/service/agent-config.ts` 默认命令为 `claude --permission-mode bypassPermissions -p <prompt>`（builtin）或 `opencode -p <prompt>`。
  - `claude -p <prompt>`（默认 text 输出）在非交互场景下会缓冲整个对话回复，**只在结束前 flush 一次**，外观就是"任务完成后才出现内容"。
  - `claude` CLI 支持 `--output-format stream-json --verbose`，会以 JSONL 形式在每个增量 token / 工具事件时 flush，可被我们当作真正的 token-by-token 流。
  - `opencode -p` 暂未确认是否有等价的流式开关（待确认）。
- `src/service/routes/events.ts` 的 `attachAgent`（specs SSE）与 `GET /runs/:runId/events` 已在收到 `onStdout` 后立即 `nudge()` 推流，**服务端→前端的链路是流式的**，不是瓶颈。
- 前端 `src/gui/src/lib/agent-tasks.ts` `onAgentStdout` 直接把 chunk 追加到 `task.output`，UI `AgentPanelDock.tsx` 用 `pre` 显示并自动滚动到底，也是流式的。

> 结论：阻塞点在 **Agent CLI 自身缓冲**。我们必须切换到 stream-json 输出形态，并在服务端把 JSONL 解析回"人类可读文本"喂给现有的 `agent-stdout` 事件，前端无需改动；wire format 仍保持 `chunk: string` 的可读文本（响应批注：「不需要转成 JSON」指的是 GUI 看到的内容，不是服务端内部的解析路径）。

### 3.2 关闭即中断

- `src/service/agent.ts` 的 `AgentRunHandle` 已暴露 `kill()`：内部执行 `child.kill('SIGTERM')`，并在 `child.on('exit')` 时把 handle 从 `handlesById` / `skillRunBySpec` 移除，同时通过 `emitter.emit('exit', code)` 推送到所有订阅者。
- 当前没有 HTTP 入口能从外部触发 `handle.kill()`。`src/service/routes/events.ts` 仅有 `GET /runs/:runId/events`，未注册 `DELETE` 或 `POST /runs/:runId/cancel`。
- 前端 `AgentPanelDock.tsx` 关闭按钮：

  ```tsx
  onClick={() => agentTasks.dismiss(props.task.runId)}
  ```

  `agentTasks.dismiss(runId)` 只把 `task.dismissed = true`，没有任何网络请求；订阅器对该 runId 仍然存活直到 SSE 收到 `agent-exit`。

- `claude` 进程在 `--permission-mode bypassPermissions` 下可能 spawn 子进程（工具执行、子 shell）。`child.kill('SIGTERM')` 只 kill 直接子进程；若子进程持有子孙，需要用 `detached: true` + `process.kill(-pid)` 把整个进程组干掉，否则 stdout pipe 关闭后仍可能有孤儿进程。

### 3.3 自动消失

- `src/gui/src/lib/agent-tasks.ts:37` 定义 `DONE_AUTO_DISMISS_MS = 30_000`，`scheduleAutoDismiss(runId)` 在 `onAgentExit` 中当 `status === 'done'` 时被调用，30 秒后将 `task.dismissed = true`。
- `dismiss(runId)` 会清除该定时器；`internal.autoDismissTimers` 仅用于这一处。
- 没有其他逻辑依赖"完成后自动隐藏"。`clearFinished()` 仍可作为用户主动清理入口。

## 4. 技术实现方案

### 4.1 总体思路

- **服务端**：让 Agent CLI 真正按事件流输出 → 在 Runner 内对 JSONL 流做解析/转文本 → 新增 `POST /runs/:runId/cancel` 触发 `handle.kill()`，并保证 kill 时杀掉整个进程组。
- **前端**：关闭按钮先 `POST /api/runs/:runId/cancel`（不等 exit），再 `dismiss(runId)`；同时移除 `scheduleAutoDismiss` 相关代码。

### 4.2 服务端：流式输出

约束：保留 `agent-stdout` SSE 事件的 wire format 不变（仍是 `{ runId, mode, specId, chunk }`），`chunk` 始终是给人看的可读文本，前端零改动。

- 修改 `src/service/agent-config.ts`：
  - `AgentCmd` 类型新增 `streamFormat: 'json' | 'text'`。
  - 对 builtin `claude`：默认参数改为 `['--permission-mode', 'bypassPermissions', '--output-format', 'stream-json', '--verbose', '-p', prompt]`，`streamFormat: 'json'`。
  - 对 builtin `opencode`：保持 `-p`，`streamFormat: 'text'`（直至确认其等价流式开关）。
  - `YORZ_AGENT_CMD` 覆盖路径：保持 `text`，作为兜底。
- 在 `src/service/agent.ts`：
  - `resolveAgentCmd()` 返回值带上 `streamFormat`。
  - 在 `spawn(input)` 内根据 `streamFormat` 决定 stdout 处理：
    - `text`：维持现有行为，`emit('stdout', chunk)` 直接转发。
    - `json`：在 stdout 上挂一个 line-by-line 解析器（手写：维护残段 `pending`，按 `\n` 切分，逐行 `JSON.parse`，失败时按 raw 行输出），对每条事件调用 `formatStreamEvent(ev)` 转成人类可读字符串后再 `emit('stdout', text)`。
  - `formatStreamEvent` 采用默认选项 (b)：
    - `system` → 单行 `[system] subtype=...`（init/end 等元信息）。
    - `assistant` / `message_delta` → 提取 `message.content[].text` 拼成文本。
    - `tool_use` → 单行 `[tool] name(args 缩略 JSON)`。
    - `tool_result` → 单行 `[tool-result] ...`（长内容截断到 ~400 字符 + 省略号）。
    - `result` → 单行 `[result] status=...` 摘要。
    - 未知类型 → `JSON.stringify(ev)`。
  - `BUFFER_MAX` 与 buffer 行为不变（拼接的是格式化后的文本）。
- 失败回退：JSONL 解析异常单行不应导致整体崩溃，只发出 `agent-error` warning + 原始行作为 stdout。

### 4.3 服务端：取消接口与进程组 kill

- `src/service/agent.ts`：
  - `spawn()` 增加 `detached: true`，让子进程独立成进程组（父进程仍持有 stdio pipe）。
  - 给 `AgentRunHandle` 的 `kill()` 改为：尝试 `process.kill(-child.pid, 'SIGTERM')` 整组终止；失败回退到 `child.kill('SIGTERM')`；2 秒后若未 exit，再发 `SIGKILL`（先尝试 `-pid` 整组、失败回退到 `child.kill('SIGKILL')`）。
  - 新增 `AgentRunner.cancel(runId): boolean`：取出 handle 调用 `kill()`，返回是否找到。
- `src/service/routes/events.ts`：
  - 新增 `app.post('/runs/:runId/cancel', ...)`：

    ```ts
    const ok = deps.runner.cancel(c.req.param('runId'))
    return c.json({ ok }, ok ? 200 : 404)
    ```

  - 在该处理结束前不需要等待 exit；前端通过现有 `GET /runs/:runId/events` SSE 自动收到 `agent-exit`。

- 安全：取消是幂等的；重复 cancel 第二次时 handle 已被 `handlesById` 移除，返回 404 即可，前端忽略。

### 4.4 前端：关闭按钮触发取消

- 新增 `src/gui/src/lib/sse.ts`：

  ```ts
  export async function cancelRun(runId: string): Promise<void> {
    await fetch(`/api/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' })
  }
  ```

  忽略响应错误（404 视为已结束）。

- 修改 `src/gui/src/lib/agent-tasks.ts`：
  - `dismiss(runId)` 改为：若 task `status` 仍是 `pending` / `streaming`，先 `void cancelRun(runId)` 再继续设置 `dismissed = true`；已结束态直接 dismiss。
  - 删除 `DONE_AUTO_DISMISS_MS`、`scheduleAutoDismiss`、`clearAutoDismiss` 与 `internal.autoDismissTimers`，以及 `onAgentExit` 中调用 `scheduleAutoDismiss(input.runId)` 的分支。
- `AgentPanelDock.tsx`：关闭按钮已经在调用 `agentTasks.dismiss(runId)`，无需改动；在 dock header 增加「清理已完成」按钮调用 `agentTasks.clearFinished()`。

### 4.5 测试与验证

- 服务端单测（`src/service/__tests__/agent.test.ts` 增补）：
  - JSONL 解析：注入 mock `resolveAgentCmd` 让 child 跑一个 node 一行一行打印 JSON 的小脚本，断言 `onStdout` 收到的是格式化后的文本而不是原始 JSON。
  - cancel：spawn 一个 sleep 子进程，调用 `runner.cancel(runId)` 后断言 `handle.done` 在 2 秒内 resolve，且 `handlesById` 已清空。
- 服务端单测（`src/service/__tests__/service.test.ts` 增补）：
  - `POST /api/runs/:runId/cancel` 命中返回 200/`{ok:true}`，未命中返回 404/`{ok:false}`。
- GUI：暂无前端单测基础设施；通过 `npm run build:gui` + 人工冒烟（启动一个长 prompt 任务，观察 dock 内文本是否在过程中逐步出现，点 × 立刻消失且 service 日志无 spawn 残留）。

### 4.6 不在本期范围

- `opencode` 的真正流式开关：本期只保证 `claude` 链路流式；`opencode` 按现状（text 模式）继续，由后续 spec 跟进。
- 已结束任务的"历史浏览"入口：本期只暴露 `clearFinished()` 按钮，不做"已完成任务抽屉"。
- 跨平台进程组 kill 的 Windows 兼容：YorZ 目前主支持 macOS/Linux，Windows 上 `process.kill(-pid)` 不可用，本期不做兼容（必要时记录 TODO）。

## 5. 待确认问题

- 暂无

## 6. 任务清单

- [x] 在 `src/service/agent-config.ts` 扩展 `AgentCmd` 类型增加 `streamFormat: 'json' | 'text'`；builtin `claude` 默认参数加入 `--output-format stream-json --verbose` 并标记 `streamFormat: 'json'`；`opencode` 与 `YORZ_AGENT_CMD` 覆盖路径标记 `streamFormat: 'text'`；验收：`resolveAgentCmd` 返回值类型与值均带 streamFormat 字段。
- [x] 在 `src/service/agent.ts` 实现 `formatStreamEvent(ev)`：按默认 (b) 处理 `system` / `assistant` / `message_delta` / `tool_use` / `tool_result` / `result`，未知类型回退到 `JSON.stringify(ev)`；验收：可由单测覆盖各类型映射。
- [x] 在 `src/service/agent.ts` 的 `spawn(input)` 根据 `streamFormat` 分支处理 stdout：text 维持现状；json 挂行级 JSONL 解析器（残段拼接 + `\n` 切分 + `JSON.parse`，解析失败时按原始行输出并发 `agent-error` warning），解析成功后调用 `formatStreamEvent` 再 `emit('stdout', text)`；验收：单测注入跑 JSONL 输出的子进程后，`onStdout` 收到的是格式化文本。
- [x] 在 `src/service/agent.ts` 的 `spawn()` 增加 `detached: true`；改写 `kill()`：优先 `process.kill(-child.pid, 'SIGTERM')`、失败回退 `child.kill('SIGTERM')`，2 秒后未 exit 则同样策略发 `SIGKILL`；验收：单测中 spawn `sleep` 子进程后 `runner.cancel()` 能在 2 秒内 resolve `done`。
- [x] 在 `AgentRunner` 新增 `cancel(runId: string): boolean`：取 handle，存在则 `kill()` 返回 true，否则返回 false；验收：单测覆盖命中/未命中两条路径。
- [x] 在 `src/service/routes/events.ts` 注册 `app.post('/runs/:runId/cancel', ...)`：调用 `deps.runner.cancel(runId)`，命中 200 / 未命中 404，body `{ ok: boolean }`；验收：service 集成测试覆盖。
- [x] 在 `src/gui/src/lib/sse.ts` 新增并导出 `cancelRun(runId)`：POST `/api/runs/:runId/cancel`，吞掉网络/非 ok 错误；验收：TS 编译通过、类型导出可被 `agent-tasks.ts` 使用。
- [x] 在 `src/gui/src/lib/agent-tasks.ts` 删除 `DONE_AUTO_DISMISS_MS` / `scheduleAutoDismiss` / `clearAutoDismiss` / `autoDismissTimers` 与 `onAgentExit` 中调用；`dismiss(runId)` 在 task `status` 为 `pending`/`streaming` 时先 `void cancelRun(runId)` 再设 `dismissed = true`；验收：grep 确认 `scheduleAutoDismiss` 等符号无残留，`dismiss` 行为按状态分支。
- [x] 在 `src/gui/src/components/AgentPanelDock.tsx` 的 dock header 增加「清理已完成」按钮，点击触发 `agentTasks.clearFinished()`，仅当存在 `done`/`failed` 卡片时才显示；验收：构建通过、本地启动可见按钮。
- [x] 在 `src/service/__tests__/agent.test.ts` 增补单测：①注入自定义 `resolveAgentCmd`（使用 `node -e` 输出多行 JSON）验证 `onStdout` 收到格式化文本；②`runner.cancel(runId)` 后 `handle.done` 2 秒内 resolve，`handlesById` 无残留。
- [x] 在 `src/service/__tests__/service.test.ts` 增补单测：`POST /api/runs/:runId/cancel` 命中返回 200/`{ok:true}`、未命中返回 404/`{ok:false}`。
- [x] 运行 `npm test` 确认全部通过；记录到执行记录。
- [x] 运行 `npm run build:gui` 验证前端构建通过；记录到执行记录。

## 7. 执行记录

- 2026-06-18 plan 阶段：完成现状分析、技术实现方案与待确认问题；阻塞在 §5 待用户批注后再进入 tasks/execute。
- 2026-06-18 tasks 阶段：消费 4 条 `！！！` 批注；批注 #1（"不需要转成 JSON"）解读为"GUI 看到的 chunk 必须是可读文本，服务端可以内部用 JSONL 解析"，与原方案 §4.2 的 wire format 约束一致；其余 3 条均接受默认；待确认问题清空，拆出 13 项任务，准备进入 execute。
- 2026-06-18 execute 阶段：
  - 服务端：`src/service/agent-config.ts` 加入 `streamFormat`；claude 默认拼上 `--output-format stream-json --verbose`；`src/service/agent.ts` 重写 `spawn()`：`detached: true` + JSONL 行级解析器 + `formatStreamEvent`（按默认 b 映射 `system`/`assistant`/`user`/`message_delta`/`result`/`tool_use`/`tool_result`，未知类型回退 `JSON.stringify`，tool 内容截断到 ~400 字符）；`kill()` 改为 `process.kill(-pid, 'SIGTERM')` → 2s 兜底 `SIGKILL`，均带 `child.kill()` 回退；新增 `AgentRunner.cancel(runId)`。
  - HTTP：`src/service/routes/events.ts` 注册 `POST /runs/:runId/cancel`，命中 200/`{ok:true}` 未命中 404/`{ok:false}`。
  - 前端：`src/gui/src/lib/sse.ts` 新增 `cancelRun(runId)`；`src/gui/src/lib/agent-tasks.ts` 删除 `DONE_AUTO_DISMISS_MS` / `scheduleAutoDismiss` / `clearAutoDismiss` / `autoDismissTimers`，`dismiss()` 在任务仍在进行时先 `void cancelRun()`；`src/gui/src/components/AgentPanelDock.tsx` dock header 增加「清理已完成」按钮（仅当存在 `done`/`failed` 卡片时显示），`src/gui/src/styles.css` 把 head 改为 flex 容器并新增 `.agent-dock-clear` 样式。
  - 测试：`src/service/__tests__/fixtures/fake-claude-jsonl.js` 新增 JSONL fixture；`agent.test.ts` 增补 4 个用例（JSONL 流式解析、cancel 成功路径、cancel 未命中、`formatStreamEvent` 单元）；`service.test.ts` 增补 1 个用例（cancel 命中→200，二次→404）；同时回填 `agent-config.test.ts` 中受 `streamFormat` 字段影响的断言。
  - 验证：`npm test` 全部通过（6 个文件 / 50 个用例）；`npm run build:gui` 构建通过（165 kB / gzip 68.84 kB）；未在真实 `claude` 上跑端到端冒烟（环境限制），人工冒烟由用户在本地完成。
