---
stage: plan
last_action: 新建 spec
updated_at: 2026-06-21
summary: 为 GUI 新增 Settings 页面并实现夜间模式开关，支持浅色/深色/跟随系统三态切换
---

# 给 GUI 加夜间模式开关（Settings 页面）

## 1. 背景

YorZ GUI 当前使用 SolidJS + 全局 CSS 变量方案管理主题。暗色模式通过 `@media (prefers-color-scheme: dark)` 自动跟随操作系统，用户无法在应用内手动切换。用户希望新增一个 Settings 页面，在其中放置夜间模式开关，让用户可自由控制主题。

## 2. 需求

- 新建 GUI Settings 页面，挂载在 `/settings` 路由。
- 在 Settings 页面中提供夜间模式开关，用户可在浅色 / 深色 / 跟随系统三种模式间切换。
- 切换后主题立即生效，并通过 `localStorage` 持久化，刷新后保持选择。
- 在顶栏提供进入 Settings 页面的导航入口。
- 默认行为为"跟随系统"，与现有 `prefers-color-scheme` 体验一致。

## 3. 现状分析

### 3.1 前端架构

- 框架：**SolidJS**（非 React），构建工具 Vite。
- 路由：`@solidjs/router`，当前 4 条路由定义于 `src/gui/src/main.tsx:15-20`，无 `/settings` 路由。
- 全局布局：`src/gui/src/AppShell.tsx`，顶栏仅包含 `YorZ` 品牌链接和"新建 spec"按钮（`AppShell.tsx:16-37`），无 Settings 入口。

### 3.2 主题 / 样式机制

- 样式方案：**单一全局 CSS 文件** `src/gui/src/styles.css`（1119 行），通过 `<link>` 全局引入，无 Tailwind / CSS-in-JS。
- CSS 变量定义于 `:root`（`styles.css:1-16`），包含 `--bg`、`--surface`、`--border`、`--text`、`--muted`、`--primary`、`--primary-fg`、`--accent`、`--plan`、`--tasks`、`--execute`、`--error`、`--radius` 共 13 个。
- 暗色模式：通过 `@media (prefers-color-scheme: dark)`（`styles.css:18-27`）覆盖 6 个变量（`--bg`、`--surface`、`--border`、`--text`、`--muted`、`--primary`），但未覆盖 `--primary-fg`、`--accent`、`--plan`、`--tasks`、`--execute`、`--error`。
- `color-scheme: light dark`（`styles.css:2`）使浏览器原生控件也跟随系统。
- **无任何手动主题切换 JS 逻辑**，无 `data-theme` / `class="dark"` 标记机制。

### 3.3 状态管理

- 使用 SolidJS 原语，无外部状态库。
- 全局共享状态仅一个 store：`src/gui/src/lib/agent-tasks.ts`，通过 `createRoot` 创建模块级单例。
- **无任何 UI 偏好 store**，GUI 代码中未使用 `localStorage`。

### 3.4 现有可复用交互模式

- **无独立的 Toggle / Switch 组件**。
- 有两种近似单选模式可参考：
  - Radio 单选组（`AppendTaskDialog.tsx`、`QuestionConfirmPanel.tsx`）。
  - Pill 按钮组（`NewSpec.tsx` 的 `.type-pill`，`styles.css` 中 `.type-pill.active` 高亮选中态）。

## 4. 技术实现方案

### 4.1 CSS 变量方案改造

将现有 `@media (prefers-color-scheme: dark)` 驱动的暗色变量改为 `data-theme` 属性驱动，消除 CSS 中暗色变量重复定义：

```css
/* 浅色（默认） */
:root,
:root[data-theme='light'] {
  color-scheme: light;
  /* 现有 :root 内的浅色变量保持不变 */
}

/* 深色（手动指定） */
:root[data-theme='dark'] {
  color-scheme: dark;
  /* 原 @media 内的暗色变量 */
}
```

移除 `@media (prefers-color-scheme: dark)` 块。"跟随系统"模式的系统检测改由 JS 层处理（见 4.2），JS 解析后写入 `data-theme="light"` 或 `data-theme="dark"`，CSS 不再需要 `@media` 规则。

同时补充暗色模式下缺失的变量覆盖（`--primary-fg`、`--accent` 等），确保深色模式视觉一致性。

### 4.2 设置 Store

新建 `src/gui/src/lib/settings.ts`，仿 `agent-tasks.ts` 的 `createRoot` + `createSignal` 单例模式：

```typescript
type ThemeMode = 'light' | 'dark' | 'auto'
```

核心职责：

- **初始化**：从 `localStorage` 读取 `yorz:theme`（默认 `'auto'`），立即调用 `applyTheme()`。
- **`applyTheme(mode)`**：当 `mode === 'auto'` 时，用 `window.matchMedia('(prefers-color-scheme: dark)')` 判断当前系统主题；否则直接使用 `mode`。将解析结果写入 `document.documentElement.dataset.theme`。
- **系统变化监听**：当当前模式为 `'auto'` 时，监听 `matchMedia` 的 `change` 事件，系统切换时自动更新。
- **`setTheme(mode)`**：更新 signal、写入 `localStorage`、重新调用 `applyTheme()`。

### 4.3 Settings 页面

新建 `src/gui/src/pages/Settings.tsx`：

- 页面结构：标题"设置" + "外观"区域。
- 外观区域：主题模式选择器，采用三选一 Pill 按钮组（与 `NewSpec.tsx` 的 `.type-pill` 风格一致），选项为：
  - ☀️ 浅色（`light`）
  - 🌙 深色（`dark`）
  - 💻 跟随系统（`auto`）
- 点击后立即调用 `settings.setTheme(mode)`。

### 4.4 路由与导航

- **路由**：在 `main.tsx` 新增 `<Route path="/settings" component={Settings} />`。
- **顶栏入口**：在 `AppShell.tsx` 的 `topbar` 右侧（"新建 spec"按钮之前或之后）添加齿轮图标链接，指向 `/settings`。
- 图标使用内联 SVG（与项目无 UI 图标库的现状一致）。

### 4.5 FOUC（闪屏）防护

在 `index.html` 的 `<head>` 中添加一段内联脚本，在 SolidJS 应用加载前读取 `localStorage` 并设置 `data-theme`，避免页面加载瞬间的主题闪烁。

## 5. 待确认问题

- 主题模式粒度：推荐三选一（浅色 / 深色 / 跟随系统），可保留现有 `prefers-color-scheme` 自动跟随能力；若仅需二态开关（浅色 / 深色），实现更简单但丢失自动跟随。请确认采用哪种方案。
- Settings 页面是否需要预留后续设置项的空间（如语言、字体大小等）？推荐采用可扩展结构，但目前仅实现主题切换。

## 6. 任务清单

（待 tasks 阶段生成）

## 7. 执行记录

（暂无）
