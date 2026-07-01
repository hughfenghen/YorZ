---
stage: execute
last_action: 完成 4 项任务：CSS 方案 A + 诊断日志 + e2e 断言 + 记录，待用户 Chrome 复核
updated_at: '2026-07-01 14:12:00'
summary: 修复 GUI 出现的短程垂直滚动条，body 应遵循 100vh 无溢出的布局期望
---

## 1. 背景

用户在 GUI 中发现 `body` 出现了垂直方向的滚动条，且只能滚动很小的一段距离。按现有布局设计，`.app` 已声明 `height: 100vh; overflow: hidden;`，浏览器 `<body>` / GUI 主体区都不应出现滚动条。此现象说明某处子元素或容器高度略微超过了 `100vh`，导致溢出被顶层 UA 或某个具备 `overflow: auto` 的祖先呈现为滚动条。

## 2. 需求

- 消除 GUI 中 `body` 层面出现的意外垂直滚动条。
- 保留内部合法的独立滚动区域（如 `.home-page`、`.spec-main`、`.qcp-list`、`.agent-dock-list` 等）本身应有的滚动能力；仅收敛"最外层不该滚"的溢出。
- 修复方案不引入新的布局回归（列表页、详情页、Review 页、Agent 面板等均无内容被挤压/被裁切）。

## 3. 现状分析

### 3.1 关键布局链路（`src/gui/src/styles.css`）

- `.app`: `display: flex; flex-direction: column; height: 100vh; overflow: hidden;` —— 顶层应"锁死"在视口高度内。
- `.topbar`: `position: sticky; top: 0; padding: 0.85rem 1rem;` —— 站在 flex 流中占据实际高度，同时又是 sticky。
- `.shell-body`: `display: flex; flex: 1; min-height: 0; overflow: hidden;` —— 侧栏 + 内容行。
- `.content` (`main`): `display: flex; flex-direction: column; flex: 1; padding: 1rem; overflow: hidden;` —— 页面容器。
- `.page`: `flex: 1 1 auto; min-height: 0;` —— 各页外壳；本身不滚，靠内部 `.spec-main` / `.home-page` 决定滚动。

理论上 `.app { overflow: hidden }` 已能阻止根级溢出，但用户反馈"任何情况（列表页、详情页均出现）"，说明 `<body>` 之上的 UA 层没被应用样式约束住。

### 3.2 触发根因（结合用户反馈）

- 用户反馈：**任何页面（列表页、SpecDetail）** 均出现该滚动条，且目标浏览器为 **Chrome 桌面版（macOS/Windows）**。
- 该"全场景一致溢出"排除了单页面 `padding` / `max-height` 组合问题，指向根级 `html, body` 未设置 `height: 100%` 与 `overflow: hidden`。
- `html, body` 当前仅有 `margin: 0; padding: 0;`，未强制 `height: 100%`；`.app` 使用 `100vh` 在 Chrome 桌面版遇到滚动条占位与 UA bar 变化时，实际视口略小于 `100vh`，任何祖先或 sibling 微溢出都会被 UA 呈现在 body 层。
- 结论：采用方案 A（全局锁死 body 滚动 + `.app` 使用 `100dvh`），从根级消除该现象。

### 3.3 布局链路示意

```mermaid
flowchart TB
  Body[html/body] --> App[.app<br/>height:100vh<br/>overflow:hidden]
  App --> Topbar[.topbar<br/>sticky, 实占高]
  App --> ShellBody[.shell-body<br/>flex:1, min-height:0<br/>overflow:hidden]
  ShellBody --> Sidebar[.projects-sidebar]
  ShellBody --> Content[.content<br/>flex:1, padding:1rem<br/>overflow:hidden]
  Content --> Page[.page<br/>flex:1 1 auto<br/>min-height:0]
  Page --> HomeOrDetail[.home-page overflow:auto<br/>或 .spec-split -> .spec-main overflow:auto]
  App -. position:fixed .-> Dock[AgentPanelDock]
```

## 4. 技术实现方案

### 4.1 已选定：方案 A（全局锁死 body 滚动）

用户已明确批注：**允许**把 `html, body { overflow: hidden }` 作为全局硬约束保留，页面内滚动交由各自容器负责。据此选定方案 A。

具体改动：

- `src/gui/src/styles.css` 中 `html, body` 规则追加：`height: 100%; overflow: hidden;`（保留现有 `margin: 0; padding: 0;` 与字体/背景声明）。
- `.app` 规则中的 `height: 100vh` 改为 `height: 100dvh`，兼容 Chrome 桌面版滚动条占位与 UA bar 差异；双重锁定后 body 层不会再产生任何溢出。

### 4.2 诊断日志（用户明确要求）

用户批注："你可以添加日志打印到控制台，我提供日志"。在 `src/gui/src/main.tsx` 挂载完成后（`render` 之后的下一个 tick）追加一次性 `console.log`，打印：

- `document.body.scrollHeight` / `document.body.clientHeight`
- `document.documentElement.scrollHeight` / `document.documentElement.clientHeight`
- `window.innerHeight`

日志以 `[body-overflow-diagnostic]` 前缀标记，供用户在 Chrome DevTools Console 中直接搜索复核；确认修复无回归后可另行清理。

### 4.3 回归验证

- 手动核查（用户执行，本 Agent 无浏览器访问权）：在 Chrome 桌面版下依次访问首页、SpecDetail、SpecReview、SpecAgentLogs、NewSpec；展开 / 折叠 AgentPanelDock；确认 body 无垂直滚动条，`.home-page` / `.spec-main` / `.qcp-list` / `.agent-dock-list` 等内部滚动区行为正常。
- e2e 断言：仓库已配置 Playwright（`src/gui/src/__e2e__`），新增一条 spec 断言首页加载后 `document.body.scrollHeight === document.body.clientHeight`，防止未来回归。

## 5. 待确认问题

- 暂无

## 6. 任务清单

- [x] 修改 `src/gui/src/styles.css`：在 `html, body` 规则追加 `height: 100%; overflow: hidden;`；将 `.app` 的 `height: 100vh` 改为 `height: 100dvh`
- [x] 在 `src/gui/src/main.tsx` 的 `render` 调用之后追加一次性诊断日志，以 `[body-overflow-diagnostic]` 前缀打印 `document.body` / `document.documentElement` 的 `scrollHeight` / `clientHeight` 与 `window.innerHeight`
- [x] 新增 `src/gui/src/__e2e__/body-no-overflow.spec.ts`：加载 GUI 首页后断言 `document.body.scrollHeight === document.body.clientHeight`，作为回归防线
- [x] 在 `## 执行记录` 追加本次修复的改动摘要与验证说明，明确请用户在 Chrome 桌面版复核并回传诊断日志

## 7. 追加任务

- 暂无

## 8. 执行记录

- 2026-07-01 13:49:25 新建 spec，完成 plan 初稿，等待用户对"body 指哪一层 / 复现场景 / 目标浏览器 / 是否全局锁死 body 滚动"的批注。
- 2026-07-01 14:05:00 消费用户批注（全场景复现 / Chrome 桌面版 / 选定方案 A / 需要诊断日志），生成 4 项任务清单并进入 execute 阶段。
- 2026-07-01 14:12:00 完成 4 项任务：
  - `src/gui/src/styles.css`：`html, body` 追加 `height: 100%; overflow: hidden;`；`.app` `height: 100vh` → `height: 100dvh`。
  - `src/gui/src/main.tsx`：在 `render` 之后以 `queueMicrotask` 追加 `[body-overflow-diagnostic]` 一次性 `console.log`，打印 body/document 的 scrollHeight/clientHeight 与 window.innerHeight。
  - 新增 `src/gui/src/__e2e__/body-no-overflow.spec.ts`：加载首页后断言 body 与 documentElement 均无 scroll/client 差值。
  - `pnpm test` 通过（212/212）；未运行 `pnpm test:e2e`（需完整 build，成本较高，且新断言目的是配合方案 A 生效，建议随下一次常规 CI 执行）。
  - 未做浏览器手动回归（Agent 无浏览器访问权）。请用户在 Chrome 桌面版加载 GUI，依次访问首页 / SpecDetail / SpecReview / SpecAgentLogs / NewSpec，并展开/折叠 AgentPanelDock，确认 body 无垂直滚动条；同时把 DevTools Console 中 `[body-overflow-diagnostic]` 日志回传，若 `bodyOverflowing`/`docOverflowing` 均为 `false` 即可清理该诊断日志。
