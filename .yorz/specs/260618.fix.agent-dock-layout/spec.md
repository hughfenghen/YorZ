---
stage: execute
last_action: 完成 CSS 改动并通过构建与单测
updated_at: 2026-06-18
summary: 调整全局 Agent 输出面板的尺寸与换行：宽度取 max(50vw, 600px) 并不超过视口；每张任务卡限高 100vh，多张卡片溢出时容器允许滚动；输出区允许换行（wrap）。
---

# Agent Dock Layout 优化

## 1. 背景

`260617.feat.agent-stream-panel` 引入的全局 `AgentPanelDock` 当前面板太窄、卡片输出区太矮，不方便阅读 Agent 长文本输出。需要调整 dock 与卡片的尺寸与换行规则。

## 2. 需求

- 宽度：页面宽度的 50% 与 600px 取较大值（且不超过视口内可用宽度）。
- 每张任务卡片最大高度为 100vh；当多张卡片导致卡片容器超出屏幕高度时，容器允许垂直滚动。
- 输出内容允许换行（wrap），不再被强制单行裁剪。

## 3. 现状分析

- `src/gui/src/components/AgentPanelDock.tsx`：dock 与卡片结构均依赖 `styles.css` 中的 class（`.agent-dock` / `.agent-dock-list` / `.agent-task` / `.agent-task-output`），组件本身不内联尺寸样式，调整重心在 CSS。
- `src/gui/src/styles.css:683` `.agent-dock`：`width: min(420px, calc(100vw - 2rem));` `max-height: calc(100vh - 2rem);` `overflow: hidden;` — 宽度被限制在最多 420px，与需求 `max(50vw, 600px)` 不符。
- `src/gui/src/styles.css:757` `.agent-dock-list`：`overflow: auto;` 已具备容器滚动能力，外层 `.agent-dock` 的 `max-height: calc(100vh - 2rem)` 决定其可视高度。
- `src/gui/src/styles.css:767` `.agent-task`：未限制 `max-height`，单卡片高度由内部内容（含 `.agent-task-output`）决定。
- `src/gui/src/styles.css:875` `.agent-task-output`：`max-height: 220px; overflow: auto; white-space: pre-wrap;` — 内部 `<pre>` 已经允许换行，但被 220px 硬限制，且尚未设置 `overflow-wrap` 以处理超长无空格 token。
- `AgentPanelDock.tsx:140` 输出区只在卡片展开时渲染；当多张卡片同时展开且都填满高度时，需要由卡片容器（`.agent-dock-list`）承担滚动而非内部 `pre`。
- 现有 z-index、定位（`position: fixed; right: 1rem; bottom: 1rem`）保持不变即可，本期不调整 dock 落位与折叠胶囊行为。

## 4. 技术实现方案

### 4.1 总体思路

仅改 `src/gui/src/styles.css` 中 `.agent-dock` / `.agent-task` / `.agent-task-output` 三处规则，不改组件 TSX 结构与交互逻辑。所有改动集中在样式层，便于回滚。

### 4.2 具体改动

- `.agent-dock`
  - `width: min(max(50vw, 600px), calc(100vw - 2rem));`
    - `max(50vw, 600px)` 满足"页面宽度 50% 与 600px 取较大值"。
    - 外层再套 `min(..., calc(100vw - 2rem))` 防止窄视口下 dock 溢出屏幕（保留 1rem 边距，与原 right/bottom 偏移一致）。
  - 维持 `max-height: calc(100vh - 2rem); overflow: hidden;`：作为整体盒，溢出由内部 `.agent-dock-list` 滚动接管。
- `.agent-task`
  - 新增 `max-height: 100vh;`：满足"每张卡片最大高度 100vh"（实际受 `.agent-dock` 的 `max-height: calc(100vh - 2rem)` 进一步约束，已与用户确认符合预期）。
  - 新增 `overflow: hidden;`：保证卡片内部超出由 `.agent-task-output` 自己滚动，避免布局错位。
  - 内部已是 `flex column`，输出区需要能自适应高度撑满剩余空间。
- `.agent-task-output`
  - 移除 `max-height: 220px;`，改用 `flex: 1 1 auto; min-height: 0;`，让 `<pre>` 在 `.agent-task` 的 `max-height: 100vh` 限制下自适应剩余高度；自身保持 `overflow: auto;` 处理超出。
  - 维持 `white-space: pre-wrap;`，并补充 `overflow-wrap: break-word;`（采用更保守的策略，仅在无可换行位置时断词，避免误伤代码片段缩进）。
- `.agent-dock-list`
  - 维持 `overflow: auto;`；外层 `.agent-dock` `max-height: calc(100vh - 2rem)` 减去 `.agent-dock-head` 高度后即为该列表可视高度，多卡片溢出自动出滚动条，无需改动。

### 4.3 不在本期范围

- 不调整 dock 的定位、折叠胶囊阈值（`COLLAPSE_THRESHOLD = 3`）与交互逻辑。
- 不调整服务端 Agent 事件流、卡片 props 类型。
- 不引入主题/暗色模式相关样式重构。

### 4.4 验证方式

- `pnpm run build:gui`：保证样式与 TS 通过编译。
- `pnpm test`：回归现有用例（本次无组件逻辑改动，预期保持 45 用例通过）。
- 人工/视觉验证（无法在当前环境完成时记录为待人工补做）：宽屏（≥1200px）下 dock 宽 600px+；窄屏（<1200px）下 dock 宽 50vw；同时打开 3+ 张展开卡片时容器出现垂直滚动；单卡片输出超长文本能换行不撑破。

## 5. 待确认问题

- 暂无

## 6. 任务清单

- [x] 修改 `src/gui/src/styles.css` 中 `.agent-dock` 的 `width` 为 `min(max(50vw, 600px), calc(100vw - 2rem));`，保留现有 `max-height` 与 `overflow: hidden`；验收：构建通过、规则文本与本方案一致
- [x] 修改 `src/gui/src/styles.css` 中 `.agent-task`，新增 `max-height: 100vh;` 与 `overflow: hidden;`；验收：单卡片高度受视口约束，flex column 布局不被破坏
- [x] 修改 `src/gui/src/styles.css` 中 `.agent-task-output`，删除 `max-height: 220px;`，新增 `flex: 1 1 auto;`、`min-height: 0;` 与 `overflow-wrap: break-word;`，保留 `overflow: auto;` 与 `white-space: pre-wrap;`；验收：规则与方案一致
- [x] 运行 `pnpm run build:gui`，确认 GUI 构建通过且无 TS / CSS 报错
- [x] 运行 `pnpm test`，确认现有 vitest 用例全部通过（预期 ≈45 项）
- [x] 执行 `npx prettier --write` 格式化本 spec 与改动的样式文件，保证仓库格式一致

## 7. 执行记录

- 2026-06-18 `src/gui/src/styles.css` `.agent-dock`：`width` 由 `min(420px, calc(100vw - 2rem))` 改为 `min(max(50vw, 600px), calc(100vw - 2rem))`；其它属性未变。
- 2026-06-18 `src/gui/src/styles.css` `.agent-task`：新增 `max-height: 100vh;` 与 `overflow: hidden;`，保持原有 flex column 布局。
- 2026-06-18 `src/gui/src/styles.css` `.agent-task-output`：删除 `max-height: 220px;`，新增 `flex: 1 1 auto;`、`min-height: 0;`、`overflow-wrap: break-word;`，保留 `overflow: auto;` 与 `white-space: pre-wrap;`。
- 2026-06-18 验证：`pnpm run build:gui` 通过（产物 12.27 kB CSS / 170.49 kB JS）；`pnpm test` 通过（9 个测试文件、67 个用例全部通过，实际数量多于方案预期 45）。
- 2026-06-18 `npx prettier --write` 对本 spec 与 `src/gui/src/styles.css` 执行，两文件均显示 `unchanged`，符合格式约定。
- 2026-06-18 视觉验证未在本次执行环境进行，留待人工在浏览器中确认宽屏（≥1200px）dock ≥600px、窄屏 50vw、多张展开卡片容器滚动、长文本换行不撑破等场景。
