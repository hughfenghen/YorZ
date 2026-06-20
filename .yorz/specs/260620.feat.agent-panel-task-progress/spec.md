---
stage: execute
last_action: 完成 3 段彩色计数实现并通过测试
updated_at: 2026-06-20
summary: Agent 任务 Dock header 用「进行中 / 已完成 / 失败」三段彩色计数替代原任务总数气泡。
---

# Agent 任务弹窗 header 任务进度展示

## 1. 背景

右下角 Agent 任务 Dock 当前 header 仅展示一个总数气泡（`.agent-dock-badge`），无法体现任务进度，用户难以一眼判断"还有多少在跑、多少成功、多少失败"。

## 2. 需求

右下角的 Agent 任务弹窗 header 中需要展示「进行中 / 已完成 / 失败」三个数字，使用不同颜色区分，替代当前的总数气泡元素。

## 3. 现状分析

- 组件文件：`src/gui/src/components/AgentPanelDock.tsx`（SolidJS），header 见第 44-63 行。
- 当前 header 内的气泡：
  ```tsx
  <span class="agent-dock-badge">{visibleTasks().length}</span>
  ```
  仅展示 `visibleTasks` 总数，绑定 CSS 类 `.agent-dock-badge`（`styles.css` 第 765-776 行，圆形 pill 样式）。
- 数据源 `visibleTasks`（AgentPanelDock.tsx:23-27）：过滤掉 `dismissed` 的任务集合。
- 任务状态字段：`AgentTask.status: 'pending' | 'streaming' | 'done' | 'failed'`（`src/gui/src/lib/agent-tasks.ts:11`）。
- 现有派生 `hasFinished`（AgentPanelDock.tsx:29-31）：`status === 'done' || status === 'failed'`，用于显示「清理已完成」按钮，本次不动。
- 自动折叠阈值 `COLLAPSE_THRESHOLD = 3` 复用 `visibleTasks().length`，保持不变。
- 现有颜色 token 已覆盖三态语义：`--plan`（streaming）、`--execute`（done）、`--error`（failed），见 `styles.css` `.status-streaming/.status-done/.status-failed`，可直接复用。

## 4. 技术实现方案

1. **新增派生计数**：在 `AgentPanelDock.tsx` 内基于 `visibleTasks()` 派生
   - `runningCount = visibleTasks().filter(t => t.status === 'pending' || t.status === 'streaming').length`
   - `doneCount = visibleTasks().filter(t => t.status === 'done').length`
   - `failedCount = visibleTasks().filter(t => t.status === 'failed').length`
   - 按用户批注，三类分别独立计数；`pending` 与 `streaming` 同视为"进行中"。
2. **替换 header DOM**：把
   ```tsx
   <span class="agent-dock-badge">{visibleTasks().length}</span>
   ```
   替换为三段彩色计数：
   ```tsx
   <span
     class="agent-dock-progress"
     aria-label={`进行中 ${runningCount()} / 已完成 ${doneCount()} / 失败 ${failedCount()}`}
   >
     <span class="agent-dock-progress-running">{runningCount()}</span>
     <span class="agent-dock-progress-sep">/</span>
     <span class="agent-dock-progress-done">{doneCount()}</span>
     <span class="agent-dock-progress-sep">/</span>
     <span class="agent-dock-progress-failed">{failedCount()}</span>
   </span>
   ```
3. **样式调整**（`src/gui/src/styles.css`）：
   - 删除 `.agent-dock-badge` 规则块（第 765-776 行）。
   - 新增 `.agent-dock-progress` 容器：`display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.8rem; font-variant-numeric: tabular-nums;`。
   - 新增三个子段：
     - `.agent-dock-progress-running { color: var(--plan); font-weight: 600; }`
     - `.agent-dock-progress-done { color: var(--execute); font-weight: 600; }`
     - `.agent-dock-progress-failed { color: var(--error); font-weight: 600; }`
   - 新增 `.agent-dock-progress-sep { color: var(--muted); }`，与现有 chevron `--muted` 一致。
4. **可访问性**：用容器 `aria-label` 提供完整语义文本（"进行中 X / 已完成 Y / 失败 Z"），单独数字段保持视觉表现。
5. **不改动**：
   - `visibleTasks` 过滤逻辑、`COLLAPSE_THRESHOLD` 折叠规则、`clearFinished` 行为。
   - `agent-tasks.ts` 任务状态机与 store 结构。
   - 已有 `.status-streaming/.status-done/.status-failed` 现有颜色定义。
6. **验证方式**：
   - 运行 `pnpm test` 确认无回归。
   - 运行 `pnpm format` 对改动文件做 prettier 格式化。
   - 人工启动 GUI（如可）观察 header 文案：全部进行中显示 `N / 0 / 0`，部分完成显示对应颜色数字。

## 5. 待确认问题

- 暂无

## 6. 任务清单

- [x] 在 `src/gui/src/components/AgentPanelDock.tsx` 中基于 `visibleTasks()` 新增 `runningCount`、`doneCount`、`failedCount` 三个 `createMemo`，分别统计 `pending+streaming`、`done`、`failed`；验收：函数定义存在且类型为 `number`。
- [x] 在 `AgentPanelDock.tsx` 的 header 中，将原 `<span class="agent-dock-badge">{visibleTasks().length}</span>` 替换为 `.agent-dock-progress` 三段计数 DOM（含 `aria-label`、三色子段、`/` 分隔符）；验收：构建后 header 渲染为「进行中/已完成/失败」三个数字。
- [x] 在 `src/gui/src/styles.css` 删除原 `.agent-dock-badge` 规则块（约 765-776 行），新增 `.agent-dock-progress` 容器及 `.agent-dock-progress-running/-done/-failed/-sep` 四条规则，颜色分别引用 `--plan`/`--execute`/`--error`/`--muted`；验收：grep 不再命中 `agent-dock-badge`，新规则存在。
- [x] 运行 `pnpm test` 验证测试通过；运行 `pnpm format` 对改动文件做 prettier 格式化；将结果记录到执行记录。

## 7. 执行记录

- 2026-06-20 在 `src/gui/src/components/AgentPanelDock.tsx:29-37` 新增 `runningCount`/`doneCount`/`failedCount` 三个 `createMemo`，分别覆盖 `pending+streaming`、`done`、`failed` 状态。
- 2026-06-20 在 `AgentPanelDock.tsx` header 中将原 `.agent-dock-badge` DOM 替换为 `.agent-dock-progress` 容器 + 三色子段 + `/` 分隔符，并在容器上挂 `aria-label="进行中 X / 已完成 Y / 失败 Z"`。
- 2026-06-20 在 `src/gui/src/styles.css` 删除原 `.agent-dock-badge` 规则块（旧 765-776 行），新增 `.agent-dock-progress`、`.agent-dock-progress-running/-done/-failed/-sep` 五条规则，颜色复用 `--plan`/`--execute`/`--error`/`--muted` token；全仓 grep `agent-dock-badge` 仅命中本 spec 文档（历史描述），代码中已无残留。
- 2026-06-20 `pnpm test` 14 个测试文件、110 条用例全部通过；`npx prettier --write` 对 3 个改动文件检查，均为 unchanged（已合规）。
- 阻塞项：本环境无法启动 GUI 做人工视觉验证，三色与 layout 仍需用户运行 `pnpm dev` 在浏览器中确认。
