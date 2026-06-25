---
stage: execute
last_action: 提交 git
updated_at: 2026-06-25
summary: 移除项目列表 30s 轮询并在折叠图标左侧新增手动刷新按钮；刷新期间保留旧列表显示，避免高度跳变。
---

# 停止项目列表轮询并新增手动刷新按钮

## 1. 背景

左侧的项目列表不需要轮询调用后端接口 `http://localhost:7423/api/projects`；在项目列表折叠 icon 的左侧新增一个刷新按钮，仅在刷新页面或用户手动点击刷新按钮才刷新项目列表。

## 2. 需求

- 移除当前 GUI 中对 `/api/projects` 的周期性轮询。
- 在项目列表 header 的折叠/展开 icon 左侧新增一个手动刷新按钮，点击后调用一次列表刷新。
- 页面初次加载（含刷新页面）时仍正常拉取一次列表，保持当前行为。
- 不影响项目移除 / 配置保存等场景下原有的主动 refetch 调用。
- 手动刷新期间，已渲染的项目列表必须继续显示，待接口返回后再原地覆盖，避免列表瞬时清空导致 UI 高度跳变。

## 3. 现状分析

- `src/gui/src/components/ProjectsSidebar.tsx:72` 通过 `createResource` 初始化项目列表，并在 `:167` 安装了一个 `setInterval(() => void refetch(), 30_000)` 轮询，组件卸载时 `clearInterval`。注释明确指出该轮询是为了让 agent run 触发的 `lastActivityAt` 能够及时刷新到 UI。
- `refetch()` 还在 `onRemove`（`:157`）中被显式调用；项目配置保存后由 `ProjectConfigDialog` 通过自身回调展示 toast，但并不强制刷新项目列表（依赖下一次轮询）。
- header 区域结构（`:177-203`）：
  - 折叠态：仅渲染一个 `«»` 切换按钮，水平居中（CSS：`.projects-sidebar.collapsed .projects-sidebar-head { justify-content: center }`）。
  - 展开态：左侧为「项目」标题文本，右侧为 `«` 折叠按钮，整体 `justify-content: space-between`。
- 现有按钮样式 `.projects-sidebar-toggle`（`styles.css:178`）：透明背景、1px 边框、4px 圆角，可直接复用相同视觉规范以避免视觉跳变。
- `api.listProjects()` 定义于 `src/gui/src/lib/api.ts`，没有自带缓存层；refetch 即一次 fetch。
- 后端 `/api/projects` 接口未在本 spec 范围内变更。
- 列表渲染门控（`ProjectsSidebar.tsx:219-222`）当前写作 `<Show when={!projects.loading} fallback={<p>加载中…</p>}>`：手动点击 `⟳` 触发 `refetch()` 后，`projects.loading` 立即切为 `true`，`<ul class="projects-sidebar-list">` 整段被卸载并替换为「加载中…」占位段，原列表高度坍缩；请求返回后 `loading` 复位，`<ul>` 重新挂载，可见明显的高度跳变与闪烁。
- SolidJS `createResource` 在 refetch 期间会保留上一次的 `projects()` 数据，仅 `.loading` 字段切为 `true`；当前实现用 `loading` 而非"数据是否就绪"作为门控，因此丢失了"保留旧数据继续渲染"的天然能力。仅在初次渲染（`projects()` 仍为 `undefined`）时才需要展示「加载中…」。

## 4. 技术实现方案

### 4.1 移除轮询

- 删除 `ProjectsSidebar.tsx` 中第 167 行附近的 `setInterval` 及配套 `onCleanup(() => clearInterval(timer))`。
- 保留 `createResource` 的初始拉取行为：页面加载（含浏览器刷新）时仍会拉取一次。
- 保留 `onRemove` 中的 `refetch()` 调用，保证移除后的列表即时更新。

### 4.2 新增刷新按钮

- 仅在展开态 header 中渲染刷新按钮 `projects-sidebar-refresh`：放置于「项目」标题与 `«` 折叠按钮之间，靠右紧邻折叠按钮；右侧两按钮之间留 4px 间距。
- 折叠态保持现状：仅渲染 `»` 展开按钮，水平居中；不显示刷新按钮（用户先展开再刷新）。
- 视觉规范：复用 `.projects-sidebar-toggle` 的边框/圆角/字体/hover 行为；按钮文本使用 `⟳` 字符，不引入图标库。
- 交互：
  - 点击调用 `refetch()`。
  - 进行中（`projects.loading === true`）时禁用按钮，并对按钮内 `⟳` 元素应用 `@keyframes spin` 1s linear infinite 动画。
  - 调用失败时沿用现有 `error` 信号的展示链路（footer 区域的 `.projects-sidebar-error`），不另起 toast。
- 无障碍：`aria-label="刷新项目列表"`、`title="刷新项目列表"`。

### 4.3 兼容/边界

- 不再有后台轮询，意味着另一个客户端新增/移除项目、或 agent 写入导致的 `lastActivityAt` 变化，不会自动反映到当前会话——这是显式的产品取舍，由"手动刷新"承担。
- 不在本 spec 中引入"自动刷新开关"或推送通道；如需活跃度自动刷新，留待后续 spec 单独评估。
- 保存项目配置不主动 refetch（配置变化不影响列表展示字段）。

### 4.4 文件改动清单（预期）

- `src/gui/src/components/ProjectsSidebar.tsx`：删除轮询、调整展开态 header JSX、新增刷新按钮处理函数、调整列表渲染门控。
- `src/gui/src/styles.css`：新增 `.projects-sidebar-refresh` 规则（复用 toggle 样式）、新增 `@keyframes spin`、为展开态右侧两按钮设置 4px 间距。
- 无需后端、API、类型层改动。

### 4.5 刷新期间保留列表显示

- 将列表渲染门控由 `<Show when={!projects.loading} fallback={…}>` 改为 `<Show when={projects() !== undefined} fallback={…}>`：
  - 初次渲染（尚未拿到任何数据，`projects()` 为 `undefined`）继续展示「加载中…」占位，保持现有首屏体验。
  - 手动 `refetch()` 期间 `projects.loading === true` 但 `projects()` 已有上一次的数组，`<Show>` 维持 `true`，`<ul>` 不卸载，旧条目继续渲染；接口返回后 SolidJS 用新数据原地驱动 `<For>` 的 diff，无整体卸载、无高度跳变。
- 刷新按钮的 `disabled` 与 `⟳` 图标的 `spinning` 动画继续基于 `projects.loading`，保持点击后的进度反馈不变。
- 该改动只影响 `ProjectsSidebar.tsx` 的列表条件渲染，不涉及 CSS、接口、状态结构。

## 5. 待确认问题

- 暂无

## 6. 任务清单

- [x] 移除 ProjectsSidebar.tsx 中的 setInterval(refetch, 30_000) 轮询及对应 onCleanup(clearInterval)，保留 createResource 初始拉取与 onRemove 中的 refetch；验收：组件挂载/卸载后无遗留 timer，运行后浏览器网络面板不再出现周期性 /api/projects 请求。
- [x] 在 ProjectsSidebar.tsx 展开态 header 中新增刷新按钮 `.projects-sidebar-refresh`（紧邻 `«` 折叠按钮左侧），onClick 调用 refetch()，在 projects.loading 时 disabled；折叠态保持仅 `»` 不渲染刷新按钮；验收：展开态显示「项目 … ⟳ «」三段，按钮带 aria-label/title="刷新项目列表"，折叠态布局与现状一致。
- [x] 在 styles.css 中新增 `.projects-sidebar-refresh`（视觉复用 .projects-sidebar-toggle 的边框/圆角/字体/hover）、`@keyframes spin`，并为展开态 header 右侧两按钮设置 4px 间距；loading 时按钮内 `⟳` 应用 spin 动画；验收：点击后按钮 disabled 且 `⟳` 持续旋转，请求结束后恢复静止。
- [x] 在仓库中执行可用的构建/类型检查命令（如 pnpm/npm 对应 lint+typecheck）并记录结果；验收：本 spec 改动不引入新增 lint/类型错误。
- [x] 将 ProjectsSidebar.tsx 列表渲染门控从 `<Show when={!projects.loading}>` 改为 `<Show when={projects() !== undefined}>`，fallback 保留「加载中…」；不改动刷新按钮 disabled 与 spinning 动画逻辑；验收：手动点击 ⟳ 后 `<ul>` 不被卸载、原列表条目持续可见至新数据返回再原地覆盖，列表高度不出现坍缩跳变；首屏（无任何数据）仍展示「加载中…」。
- [x] 复跑 `pnpm run build:gui` 与 `npx prettier --write` 校验该改动；验收：构建通过且 prettier 无格式偏差。

## 7. 追加任务

- [fixed] [fix] 2026-06-25 22:07 | 刷新任务时不要清空列表，获取到接口返回之后再覆盖；
  - 描述：刷新任务时不要清空列表，获取到接口返回之后再覆盖；避免加载过程中列表为空，出现高度跳变现象。

## 8. 执行记录

- 2026-06-25 新建 spec，进入 plan 阶段并产出 `现状分析` / `技术实现方案` / `待确认问题`。
- 2026-06-25 消费 5 条用户批注：折叠态不显示刷新按钮、使用 `⟳` 字符、loading 时禁用 + spin 动画、保存配置不主动 refetch、不引入自动刷新开关；更新 4.2/4.3/4.4 并拆分任务清单，进入 execute。
- 2026-06-25 修改 `src/gui/src/components/ProjectsSidebar.tsx`：删除 30s `setInterval(refetch)` 及配套 `onCleanup`，新增 `onRefresh` 句柄；保留 createResource 初始拉取与 onRemove 中的 refetch。
- 2026-06-25 同文件展开态 header 包裹 `.projects-sidebar-head-actions`，新增 `.projects-sidebar-refresh` 按钮（`⟳`，aria-label/title="刷新项目列表"），`projects.loading` 时 `disabled` 且图标加 `spinning` class；折叠态保持仅 `»` 不变。
- 2026-06-25 修改 `src/gui/src/styles.css`：将 `.projects-sidebar-toggle` 视觉规则与 `.projects-sidebar-refresh` 合并复用；新增 `.projects-sidebar-head-actions { display:flex; gap:4px }`、`@keyframes yorz-spin` 与 `.spinning` 旋转动画，并处理 `:disabled` 态。
- 2026-06-25 验证：`pnpm run build:gui` 通过（vite 6.4.3，123 modules，0 error）；`npx prettier --write` 三个文件均 unchanged。仓库未配置 lint/typecheck 独立脚本，构建过程即覆盖类型检查。
- 2026-06-25 变更重开流程（追加任务：fix）：接收 `[open] [fix]` 条目「刷新任务时不要清空列表」；定位根因为 `ProjectsSidebar.tsx:219` 列表门控写作 `when={!projects.loading}`，refetch 期间会卸载 `<ul>` 导致高度坍缩。补充 `## 3 现状分析` 末段与 `### 4.5 刷新期间保留列表显示`；合并文末游离的 `## 追加任务` 段到 `## 7 追加任务`；保持 `[open]` 状态不变，等待 tasks 阶段拆分最小修复任务。
- 2026-06-25 tasks 阶段：依据 §4.5 在 `## 6 任务清单` 末尾追加两条最小修复任务（门控改写 + 构建/prettier 复核），无新待确认问题与冲突，同轮继续进入 execute。
- 2026-06-25 execute 修改 `src/gui/src/components/ProjectsSidebar.tsx`：将列表渲染 `<Show when={!projects.loading}>` 改为 `<Show when={projects() !== undefined}>`，fallback 与刷新按钮的 disabled/spinning 行为均不动；refetch 期间 SolidJS 保留上次 `projects()` 数组，`<ul>` 不再卸载，避免高度坍缩。
- 2026-06-25 验证：`pnpm run build:gui` 通过（vite 6.4.3，123 modules，0 error，618ms）；`npx prettier --write` 对 ProjectsSidebar.tsx 与 spec.md 均 unchanged。追加任务条目 `刷新任务时不要清空列表` 状态置为 `[fixed]`。

## 执行记录

- 2026-06-25 提交 f64753d：feat(260625.feat.stop-project-list-polling): 移除项目列表 30s 轮询并在折叠图标左侧新增手动刷新按钮；刷新期间保留旧列表显示，避免高度跳变。（3 个文件）
