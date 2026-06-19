---
stage: execute
last_action: 完成代码改动并通过 GUI 构建
updated_at: 2026-06-19
summary: Agent 任务面板（agent-dock）折叠态收窄宽度以避免遮挡正文内容，展开态保持现有宽高布局不变。
---

# Agent Dock 折叠态收窄宽度

## 1. 背景

[[260618.fix.agent-dock-size]] 把 `.agent-dock` 的宽度调到 `min(max(50vw, 600px), calc(100vw - 2rem))`，方便展开时阅读 Agent 流式输出；但折叠态下面板只剩一个 header bar，仍占据 ≥50vw 的宽度横在右下角，会盖住底栏附近的正文、批注或操作区，体验比"小胶囊"差。

需求：折叠态 = 一个紧凑的胶囊/按钮宽度，仅承载标题 + 计数 + 收/展按钮 + 清理已完成；展开态 = 与现状完全一致。

## 2. 需求

1. `AgentPanelDock` 处于折叠态（`collapsed() === true`）时，`.agent-dock` 宽度收窄到"内容自适应"或与之等价的明显更小尺寸，不再占据 50vw。
2. 展开态（`collapsed() === false`）下，宽高/位置/阴影/动画与当前一致，不出现明显的视觉跳变（位置仍然贴在右下）。
3. 折叠态 header 内的元素（标题"Agent 任务"、计数徽章、▲/▼ 箭头、"清理已完成"按钮）仍可见、可点击；不允许文字被裁切。
4. 折叠 ↔ 展开切换不产生抖动错位（右下角对齐保持稳定）。
5. 仅改样式/类名，不调整 dock 的业务逻辑、状态管理或挂载位置；与 [[260618.feat.confirm-panel-left-dock]] 引入的左侧 dock 不冲突。

显式不在范围内：

- 折叠态独立"迷你列表"或"任务徽章红点"等新视觉。
- 展开态宽度的进一步调整。
- 折叠默认值与 `COLLAPSE_THRESHOLD` 的策略调整。

## 3. 现状分析

### 3.1 组件结构

- `src/gui/src/components/AgentPanelDock.tsx`：
  - 顶层 `<aside class="agent-dock">`，固定挂在 `AppShell`（`src/gui/src/AppShell.tsx:22`）。
  - `collapsed` 由 `createSignal(false)` 维护，超出 `COLLAPSE_THRESHOLD = 3` 自动切到折叠。
  - header 内是一个 `<button class="agent-dock-toggle">` 占满主区，可选 `<button class="agent-dock-clear">` 放在右侧。
  - 折叠态：`<Show when={!collapsed()}>` 隐藏 `<ul class="agent-dock-list">`，仅 header 渲染。
  - 当前 DOM 上没有"是否折叠"的标记类/属性供 CSS 选择；只有 toggle 按钮自身写了 `aria-expanded={!collapsed()}`。

### 3.2 当前样式（src/gui/src/styles.css）

- `.agent-dock`（698–712 行）：
  - `position: fixed; right: 1rem; bottom: 1rem;`
  - `width: min(max(50vw, 600px), calc(100vw - 2rem));`（无 `min-width`）
  - `max-height: calc(100vh - 2rem); display: flex; flex-direction: column;`
- `.agent-dock-head`（714 行起）：`display: flex; align-items: stretch; border-bottom: 1px solid var(--border)`。
- `.agent-dock-toggle`（721 行起）：`flex: 1`，吃满主区宽度——所以即便整体收窄到 fit-content，toggle 自身也不会反过来撑宽容器。
- `.agent-dock-chevron`：`margin-left: auto`，目前依赖宽容器把 chevron 推到最右。收窄后仍可工作（弹性容器内 `margin-left:auto` 与容器宽度无关）。

结论：宽度由 `.agent-dock` 唯一决定；折叠态收窄不会破坏 header 内部布局，只需新增"折叠态"的 CSS 选择子并覆写 `width`。

### 3.3 折叠切换的视觉锚点

- `.agent-dock` 贴右下角（`right: 1rem; bottom: 1rem`），右下角是固定锚点；宽度变化只会让左边沿向右收缩，不会移动右下角，天然不会产生位置抖动。
- 当前没有 `transition`，宽度切换是瞬时的；引入 `transition: width` 是可选锦上添花，不强求。

## 4. 技术实现方案

### 4.1 选择折叠态的 CSS 选择子

为 `.agent-dock` 增加一个折叠态标记，使样式可由 CSS 直接命中，避免在 TSX 里写内联 `style`：

- 方案 A（采用）：在 `<aside class="agent-dock">` 上根据 `collapsed()` 追加 `agent-dock--collapsed` 类。
  - 实现：`class={`agent-dock${collapsed() ? ' agent-dock--collapsed' : ''}`}`。
  - 与现有 BEM-ish 命名（`agent-dock-head`、`agent-dock-clear` 等）一致；可直接写 `.agent-dock--collapsed { width: ... }`。
- 方案 B：在 `<aside>` 上加 `aria-expanded={!collapsed()}`，CSS 用 `.agent-dock[aria-expanded='false']` 选择。
  - 语义更弱（`aside` 本身不是 disclosure），且与 toggle 按钮上已有的 `aria-expanded` 形成重复语义。

采纳 A。

### 4.2 折叠态宽度策略

- `.agent-dock--collapsed { width: auto; min-width: 0; max-width: min(320px, calc(100vw - 2rem)); }`
  - `width: auto` 让容器按内容自适应（header 一行：标题 + 徽章 + chevron + 可选清理按钮）。
  - `max-width: min(320px, ...)` 兜底，防止某些极端文案把宽度撑过 320px。
  - `min-width: 0` 显式覆写，避免后续若引入 `min-width` 时被继承。
- 展开态：`.agent-dock` 现有规则保持不变。

### 4.3 兜底：避免 `flex:1` 把 header 撑宽

`.agent-dock-toggle` 当前 `flex: 1`，在 `width: auto` 的父容器里，flex item 的 `flex: 1` 默认 `flex-basis: 0`，会请求"剩余空间"，但父容器在 `width: auto` 时本身就按内容算宽度——理论上不会反向撑宽。为稳妥起见，给折叠态写：

- `.agent-dock--collapsed .agent-dock-toggle { flex: 0 0 auto; }`

确保 toggle 只占自身内容宽度。

### 4.4 可选：过渡动画

- 在 `.agent-dock` 上加 `transition: width 120ms ease-out;`，让折叠/展开有轻微过渡。
- 风险：`width: auto ↔ 具体值` 之间的 transition 在多数浏览器不平滑（auto 不能直接动画），可能视觉上仍是瞬时。
- 决策：默认不加 transition；待确认问题里向用户确认。

### 4.5 改动点清单（预估）

- `src/gui/src/components/AgentPanelDock.tsx`：`<aside>` 的 `class` 改为动态拼接。
- `src/gui/src/styles.css`：新增 `.agent-dock--collapsed` 与 `.agent-dock--collapsed .agent-dock-toggle` 两条规则；其它规则不动。
- 不涉及任何 TS 类型、状态、路由、API、tests 改动。

### 4.6 验收

- 手动验证（仓库 dev 启动后）：
  - 触发 ≥ 1 个 Agent 任务，折叠面板，确认右下角宽度明显收窄（目测 < 360px），不再覆盖左侧内容；切回展开，宽高与现状一致。
  - 触发 ≥ 4 个任务，自动折叠后确认表现一致；点击"清理已完成"按钮仍可点中。
  - 在窄视口（如 600px）下，折叠态不超过视口宽度且不出现横向滚动条。
- 自动化：现有 e2e（`src/gui/src/__e2e__/*.spec.ts`）未覆盖 dock 折叠态宽度；本次不新增 e2e，避免无意义扩张测试面。

## 5. 待确认问题

- 暂无

## 6. 任务清单

- [x] 在 `src/gui/src/components/AgentPanelDock.tsx` 的 `<aside>` 上根据 `collapsed()` 动态拼接 `agent-dock--collapsed` 类（验收：折叠态 DOM 上同时有 `agent-dock` 与 `agent-dock--collapsed` 两个类；展开态仅 `agent-dock`）。
- [x] 在 `src/gui/src/styles.css` 紧随 `.agent-dock` 现有规则之后新增 `.agent-dock--collapsed { width: auto; min-width: 0; max-width: min(320px, calc(100vw - 2rem)); }`（验收：选择子可命中折叠态 aside，宽度规则按 4.2 节生效）。
- [x] 在同文件新增 `.agent-dock--collapsed .agent-dock-toggle { flex: 0 0 auto; }`，避免 toggle 的 `flex:1` 反向撑宽（验收：折叠态 toggle 仅占自身内容宽度）。
- [x] 运行项目已有的 typecheck / build 命令（`npm run -w src/gui build` 或仓库根的等价脚本）确认本次改动不破坏构建；若仓库未提供则记录跳过原因（验收：执行记录里写明命令与结果）。

## 7. 执行记录

- 2026-06-19 改动 `src/gui/src/components/AgentPanelDock.tsx`：`<aside>` 的 `class` 改为按 `collapsed()` 动态拼接 `agent-dock--collapsed`；`aria-label` 保留。
- 2026-06-19 改动 `src/gui/src/styles.css`：在 `.agent-dock` 规则之后新增 `.agent-dock--collapsed`（`width:auto; min-width:0; max-width: min(320px, calc(100vw - 2rem))`）与 `.agent-dock--collapsed .agent-dock-toggle { flex: 0 0 auto }`。
- 2026-06-19 验证：`pnpm run build:gui` 成功（vite 6.4.3，118 modules，CSS 13.88 kB，JS 177.72 kB）。
- 阻塞：可视化验收需要在浏览器中触发 Agent 任务并切换折叠态，Agent 环境无法运行浏览器，留待用户在本地 `pnpm run dev` 中确认右下角折叠态宽度变窄、展开态布局不变。
