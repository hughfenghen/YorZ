---
stage: execute
last_action: 落地 C1 完成 — api/sse/project/agent-tasks/AppShell + 4 个页面 + 单测全部改造，build & test 通过
updated_at: 2026-06-25
summary: 修复 YorZ GUI 左侧项目列表三处问题：切换项目时 specs API 仍带旧项目 ID（落地 C1：所有 project-scoped api 显式传 pid）、侧栏随主面板滚动、移除 Sidebar/Welcome 的"添加项目"按钮改为提示使用 `yorz add <path>`。
---

# 修复 GUI 左侧项目列表的三处问题

## 1. 背景

`260624.feat.multi-project-management` 已上线多项目管理：YorZ 在全局配置中托管多个项目，左侧 `ProjectsSidebar` 用于在不同项目间切换；新建项目通过浏览器 `showDirectoryPicker` + 手动粘贴路径接入。
联调阶段发现以下三个体感问题，影响日常切换与新增项目的流程。

## 2. 需求

1. 左侧项目点击列表项，发起的 API 请求项目 ID 是当前选项而不是目标项的 ID，比如：点击 `storify-editor-14e466`，访问的 API 是 `http://localhost:7423/api/projects/yorz-6f1f9f/specs`。
2. 左侧项目列表应该使用 flex 布局，不应该跟随右侧页面滚动。
3. 暂时移除"添加项目"入口，改为提示用户使用 `yorz add <path>` —— 因为 Web 没有权限访问文件系统。

## 3. 现状分析

### 3.1 路由 → 全局 `activeProjectId` 同步链路

- `src/gui/src/lib/project.ts` 维护一个 module-scope 信号 `activeProjectId`，初始值由 `window.location.pathname` 解析得来。
- `src/gui/src/AppShell.tsx:13-16` 在 `createEffect` 内监听 `useLocation().pathname`，匹配 `^/([^/]+)` 并写回 `setActiveProjectId(...)`。
- 所有 API 请求构造统一通过 `src/gui/src/lib/api.ts` 的 `projectBase()`：

  ```ts
  function projectBase(): string | null {
    const pid = currentProjectId()
    return pid ? `/api/projects/${encodeURIComponent(pid)}` : null
  }
  ```

  即"读取全局信号 → 拼 URL"，**未通过参数显式传入** project id。

### 3.2 Home 页面的 specs 资源

- `src/gui/src/pages/Home.tsx:7-10`：

  ```ts
  const projectId = useCurrentProjectId()
  const [specs, { refetch }] = createResource<SpecListItem[], string>(projectId, (pid) =>
    pid ? api.listSpecs() : Promise.resolve([]),
  )
  ```

  Source 用的是路由层 `useParams().projectId`，已能正确感知 URL 变化；但 fetcher **拿到了正确的 `pid` 却又丢弃**，最终调用 `api.listSpecs()` —— 该方法内部读取的是全局信号 `activeProjectId`。

### 3.3 时序：路由信号 vs 全局信号 vs 资源 fetch

URL 切到 `/storify-editor-14e466` 时：

1. SolidRouter 把 `location.pathname` 与 `useParams()` 同步更新为新值。
2. Home 的 `createResource` source 立即变化 → 调度 fetcher，把 `pid="storify-editor-14e466"` 传入。
3. fetcher 调用 `api.listSpecs()` → `projectBase()` → `currentProjectId()` → 读 `activeProjectId` 信号；该信号由 AppShell 的 `createEffect` 异步更新，**fetcher 微任务执行时仍是旧值 `yorz-6f1f9f`**。
4. 因此 `GET /api/projects/yorz-6f1f9f/specs` 被发出，对应 Bug 1。
   - 旁证：`SpecDetail` / `NewSpec` 等页面也都通过 `api.xxx()` 间接读全局信号；只要进入"切换项目刚刚发生但 AppShell effect 还未跑完"的窗口，都会复现同类问题。
   - 该 race 只对"切换项目时立刻触发的资源 / 操作"显著，单页内导航大多在 effect 已稳定后才操作，所以容易被忽略。

### 3.4 布局现状（`src/gui/src/styles.css`）

- `.app { display: flex; flex-direction: column; min-height: 100vh; }` —— 用的是 `min-height`，**没有上限**，body 高度跟随内容增长。
- `.topbar` `position: sticky; top: 0;`，但其 sticky 容器是 `.app`（高度等于内容总高），所以 sticky 仅约束 `topbar` 自身贴顶，**侧栏不会贴住视口**。
- `.shell-body { display: flex; flex: 1; min-height: 0; }`，`.projects-sidebar { display: flex; flex-direction: column; flex-shrink: 0; }`，`.projects-sidebar-list { flex: 1; overflow-y: auto; }`。
- 侧栏 list 已经自带 `overflow-y: auto`，但因为 `.shell-body` 的高度跟着 `.content` 撑开，list 永远拿不到"需要内部滚动"的可视区上限，整页只能由 window 滚动 —— 滚动时侧栏一起被推走。

### 3.5 添加项目入口现状

- **Sidebar 入口**：`src/gui/src/components/ProjectsSidebar.tsx:277-292` 的 footer `<button class="projects-sidebar-add">`，禁用条件 `!pickerSupportedClient()`。
  - 行为：`onAdd()` → `promptAddProject()`（先 `showDirectoryPicker()`，再 `window.prompt(...)` 让用户粘贴绝对路径） → `api.addProject(path)` → `refetch()` → `navigate(\`/${entry.id}\`)`。
  - 限制：Web 端没有真正的文件系统访问，`showDirectoryPicker` 只能给一个建议名，最终仍要用户手动粘贴路径；且在 Safari / Firefox / 部分企业 Chrome 下 picker 不可用，按钮直接 disabled，但没给用户任何替代提示。
- **Welcome 页入口**：`src/gui/src/pages/Welcome.tsx:1-41` 同样消费 `promptAddProject` + `api.addProject`，提供「＋ 添加你的第一个项目」CTA，用于空项目列表时的首次接入。其 `onAdd()` 流程与 Sidebar 完全等价。
- 相关 CLI：`yorz add <path>` 已在 `260624.feat.multi-project-management` 落地，用作命令行入口。

### 3.6 SolidRouter v0.16 导航时序（实测源码确认）

读 `node_modules/@solidjs/router@0.16.1/dist/routing.js` 与 `routers/Router.js` 后确认：

- 用户点击 `<A href="/storify-editor-14e466">` → `navigateFromRoute` → `transition("navigate", target)`：
  1. `startTransition(() => { setReference(target.value); setState(target.state); ... })` —— `reference` 信号同步更新，`useLocation().pathname` / `useParams().projectId` **立即可见新值**。
  2. transition 完成的 `.finally(() => batch(() => { ...; navigateEnd(lastTransitionTarget); setIsRouting(false); ... }))` 中才调用 `navigateEnd` → `setSource(...)` → Router.js 的 `config.set` → **`window.history.pushState(state, '', value)`**。
- 关键结论：`useLocation`/`useParams` 由 `reference` 信号驱动（routing.js:387/389），**先于** `window.history.pushState` 完成（同 routing.js:374-385 / Router.js:25）。
- 也即：在 `createResource` 的 fetcher 中读 `window.location.pathname`，命中的仍是 **上一次导航后留下的旧 URL**，与 `useParams()` 返回的新 pid 错位。

### 3.7 前一轮方案 A 失效根因

`src/gui/src/lib/project.ts` 的 `currentProjectId()` 在前一轮被改为：

```ts
if (typeof window !== 'undefined') {
  const m = window.location.pathname.match(/^\/([^/]+)/)
  if (m && m[1] !== 'api') return m[1]!
}
return activeProjectId()
```

但按 3.6 的时序：

- `Home.tsx` 的 `createResource` source = `useCurrentProjectId()`（即 `params.projectId`）。点击切换时，`setReference` 先发生 → source 立即变为新 pid → fetcher 入队执行。
- fetcher 内调用 `api.listSpecs()` → `projectBase()` → `currentProjectId()` → 读 `window.location.pathname`，此时 `pushState` 尚未发生，**取到的仍是旧 URL 的 pid**。
- 因此最终发出 `GET /api/projects/<旧 pid>/specs`，Bug 1 复现。

旁证：`activeProjectId` 信号由 `AppShell.tsx` 的 `createEffect` 在 `useLocation().pathname` 变化时写入，依赖同一条 reactive 通道；它本身在切换瞬间也是滞后的，因此回退到该信号同样救不了 race（这也是当初转去读 URL 的原因，但前提是 URL 已落地，恰好不成立）。

### 3.8 影响面盘点（防回归）

- API：除 `listProjects` / `addProject` / `removeProject` 外，`api.ts` 中所有"项目级"方法都依赖 `projectBase()`。若改成显式传 pid，需同时调整所有调用点（Home / SpecDetail / SpecReview / NewSpec / AgentPanelDock 等）。
- 路由：`useCurrentProjectId()` 已经是基于 `useParams()` 的，路由层取值始终是当前 URL 的真值，可以作为新的"真相源"。
- CSS：固定页面高度后，原 `.spec-detail` / `.review` 等长内容页是否还能正常滚动需要回归确认。
- 其它使用 `activeProjectId` 的地方：`AppShell.tsx` 内 `agentTasks.hydrateFromActiveRuns()` 的"按 pid 去重 hydrate"也读它；如果改信号语义需要一并复核。
- `promptAddProject` / `api.addProject` 的 Web 端消费方共 2 处：`ProjectsSidebar.tsx` 自身 + `Welcome.tsx`；删除符号前必须同步处理两处调用。

## 4. 技术实现方案

### 4.1 Bug 1：切换项目时仍带旧 pid（落地 C1）

**真实根因（更新自 3.6 / 3.7）**：SolidRouter v0.16 在 `transition()` 中**先**通过 `setReference` 更新 `useLocation` / `useParams`，**后**在 `.finally → batch → navigateEnd → setSource` 中触发 `pushState`。`useParams` 驱动的 `createResource` fetcher 在 reactive 微任务中执行时，`window.location.pathname` 与 `activeProjectId` 信号都还停留在旧值，因此**前一轮方案 A 与 AppShell 的 `createEffect` 写信号同样救不了 race**。

**前一轮决策回滚**：方案 A（让 `currentProjectId()` 读 `window.location.pathname`）经实测无效。

**决策（已确认）**：采用 **方案 C1 — 显式传 pid**，根治隐式全局带来的时序错位。

- 所有 project-scoped api 方法签名增加 `pid: string` 作为首位参数，`projectBase(pid)` 直接拼 URL，不再读 `currentProjectId()`。
- `src/gui/src/lib/sse.ts` 内 `subscribeSpec` / `subscribeRun` / `fetchActiveRuns` / `cancelRun` / `subscribeSpecsList` 同步加 `pid` 首位参数（同样属于 race-prone 链路）。
- 调用点统一以 `useCurrentProjectId()`（由 `useParams().projectId` 驱动，是 SolidRouter 中唯一先于 `pushState` 同步更新的真相源）取 pid，再显式传入 api。
- `src/gui/src/lib/project.ts` 删除命令式 `currentProjectId()`；`projectHref(sub, projectId?)` 未传 pid 时回退到 `activeProjectId` 信号（不再走 URL 解析）；`activeProjectId` / `setActiveProjectId` / `useCurrentProjectId` 保留。
- `src/gui/src/AppShell.tsx` 保留 `setActiveProjectId` effect，专用于驱动 `hydrateFromActiveRuns` 去重以及组件级响应式 UI（如 `hasProject` 判断）；`hydrateFromActiveRuns(pid)` 增加 pid 显式入参。
- `src/gui/src/lib/agent-tasks.ts` 内任务对象增持 `projectId`：`AgentTaskInput.projectId` 传入后存到 `AgentTask.projectId`，watchdog 的 `cancelRun` / 订阅 `subscribeRun` 均按任务自带 pid 调用；`hydrateFromActiveRuns(pid)` 把 pid 透传给 `fetchActiveRuns(pid)`。
- `ProjectsSidebar.tsx` 仅调用 `api.listProjects()` / `api.removeProject(id)`（非 project-scoped），本轮不动。

**统一约束**：

- `useParams` / `useLocation` 是切换瞬间唯一**先于** `pushState` 同步更新的 reactive 真相源 —— pid 必须从它派生信号取，禁止再回退 `window.location.pathname` 或 `activeProjectId` 用作"主路径"。
- `activeProjectId` 信号 + AppShell `createEffect` 仅作为非 race-critical 的响应式订阅源（如 `hydrateFromActiveRuns` 去重 key、`AppShell` 的 `hasProject` UI 判断）。

### 4.2 Bug 2：左侧栏跟随右侧滚动

**根因**：`.app` 用 `min-height: 100vh` 让整页可随内容增高，window 滚动时侧栏（位于 `.app` 内部）一起被滚走。

**决策（已确认）**：把 viewport 高度作为硬上限，让 `.content` 内部滚动而非 window 滚动；**保留** `.topbar` 的 `position: sticky` 以避免 diff 噪声。

- `.app`：`min-height: 100vh` → `height: 100vh`，并加 `overflow: hidden` 防止内部 flex 子项突破上限。
- `.shell-body`：保留 `display: flex; flex: 1; min-height: 0;`；增加 `overflow: hidden`（兜底）。
- `.content`：`overflow-y: auto`，让"右侧主面板"自己滚动；`.projects-sidebar` 已经是 column flex + list `overflow-y: auto`，不需要改。
- `.topbar` 的 `position: sticky; top: 0;` 保留不变。
- 验证视角：长 spec body 在 `.content` 内能纵向滚动；侧栏在切换项目 / 滚动 spec 时始终贴顶；窗口缩放时 list 自身按 `overflow-y: auto` 滚动而不撑爆视口。

### 4.3 Bug 3：移除"添加项目"入口，改为 CLI 提示

**决策（已确认）**：

- 提示文案统一为 `添加项目请在终端执行：yorz add <path>`。
- `promptAddProject`（`ProjectsSidebar.tsx` 导出）与 `api.addProject`（`api.ts` 方法）作为仅 Web 侧使用的导出符号一并删除，最小留痕。前提是先同步清理所有 Web 端调用点（Sidebar + Welcome 两处，见 3.5）。

**实现要点**：

- `ProjectsSidebar.tsx`：删除 footer 的 `<button class="projects-sidebar-add">` 及其依赖 `onAdd()` / `adding` / `error`（仅 add 流程消费部分）/ `promptAddProject` 函数体与导出 / `pickerSupported` / `pickerSupportedClient`；保留 `removeProject` 流程（hover ✕ 仍可用）。
- `Welcome.tsx`：采用方案 A —— 移除 `+ 添加你的第一个项目` CTA 按钮及其 `onAdd` 处理，改为与 Sidebar 一致的静态 CLI 提示 `添加项目请在终端执行：yorz add <path>`；同步删除对 `promptAddProject` / `api.addProject` 的依赖。
- `api.ts`：删除 `addProject` 方法；确认 `listProjects` / `removeProject` 不受影响。
- 在原 Sidebar footer 区域改为一行常驻提示：
  ```
  添加项目请在终端执行：
  yorz add <path>
  ```
  - 展开态：文案 + 命令字段用等宽 `<code>` 包裹。
  - 折叠态：显示一个小图标 + tooltip 文案 `yorz add <path>`，避免占用横向空间。
  - 提示样式复用现有 `.projects-sidebar-foot`，新增 `.projects-sidebar-hint`（小号字、`color: var(--muted)`）。
- 测试：`__e2e__` 中若有 "add project" 用例需要同步移除或改为校验提示文案存在；CLI 路径不受影响。

### 4.4 改动文件清单

> Bug 2 / Bug 3 的文件清单维持上一轮，已落地（见 §6 任务清单）。下面列出 **Bug 1 第二轮修复（C1）** 的最终清单。

- `src/gui/src/lib/api.ts` —— `projectBase(pid)` 直接接受 pid；所有 project-scoped 方法首位参数新增 `pid: string`（`listSpecs` / `getSpec` / `createSpec` / `appendAnnotation` / `submitQuestionAnswers` / `runAgent` / `appendItem` / `explain` / `listSpecChanges` / `commitSpecChanges` / `createDraft` / `uploadAttachment` / `deleteAttachment` / `renameAttachment` / `draftAttachmentUrl` / `specAttachmentUrl`）；`listProjects` / `removeProject` 保持不变；移除对 `currentProjectId` 的 import。
- `src/gui/src/lib/sse.ts` —— `subscribeSpec` / `subscribeRun` / `fetchActiveRuns` / `cancelRun` / `subscribeSpecsList` 首位参数新增 `pid: string`；移除对 `currentProjectId` 的 import。
- `src/gui/src/lib/project.ts` —— 删除命令式 `currentProjectId()`；`projectHref(sub, projectId?)` 改为未传 pid 时回退 `activeProjectId` 信号；保留 `activeProjectId` / `setActiveProjectId` / `useCurrentProjectId` 导出。
- `src/gui/src/AppShell.tsx` —— `setActiveProjectId` effect 保留；新增传递 pid 给 `hydrateFromActiveRuns(pid)`。
- `src/gui/src/lib/agent-tasks.ts` —— `AgentTask` / `AgentTaskInput` 增加 `projectId: string`；`start` 内 `subscribeRun(projectId, runId, ...)`；`dismiss` 按已存任务的 `projectId` 调 `cancelRun`；`hydrateFromActiveRuns(pid)` 把 pid 透传给 `fetchActiveRuns(pid)`。
- 调用点：`src/gui/src/pages/Home.tsx`、`src/gui/src/pages/SpecDetail.tsx`、`src/gui/src/pages/SpecReview.tsx`、`src/gui/src/pages/NewSpec.tsx` 全部以 `useCurrentProjectId()` 取 pid 后显式传入 api / sse。
- 测试：`src/gui/src/lib/__tests__/agent-tasks.test.ts` 中 mock 的 `subscribeRun` / `cancelRun` / `fetchActiveRuns` 签名同步更新；`src/gui/src/__e2e__/*` 无 race 相关断言用例可加（受 jsdom EventSource 限制），以单元构造覆盖。

### 4.5 不在范围内

- 不调整 `260624.feat.multi-project-management` 已交付的 CLI `yorz add`。
- 不改 `.topbar` 与 `AgentPanelDock` 布局。
- 不重构 `activeProjectId` 信号在非 race-critical 场景下的语义（保留它用于响应式订阅副作用）。
- 不再坚持"绝不改 api.ts 函数签名" —— 该硬约束在 Bug 1 第一轮修复时为最小改动而设定，现实测方案 A 失效，本轮以方案 C1 / C2 / C3 的最终选择为准。

## 5. 待确认问题

- 暂无

## 6. 任务清单

- [x] 改写 `src/gui/src/lib/project.ts` 的 `currentProjectId()`：优先用 `^/([^/]+)` 解析 `window.location.pathname` 第一段；解析失败时回退到 `activeProjectId` 信号；保留 `activeProjectId` / `useCurrentProjectId` 的现有导出与订阅链路。验收：切换项目后立即触发的 `api.listSpecs()` 命令式调用使用新 pid，不再发出旧 pid 请求。
- [x] 调整 `src/gui/src/styles.css`：`.app` 由 `min-height: 100vh` 改为 `height: 100vh` 并加 `overflow: hidden`；`.shell-body` 增补 `overflow: hidden`；`.content` 增补 `overflow-y: auto`；`.topbar` 的 `position: sticky; top: 0;` 保持不变。验收：长内容 spec 在 `.content` 内纵向滚动，左侧 `ProjectsSidebar` 始终贴顶；窗口缩放时侧栏 list 自身 `overflow-y: auto` 生效不撑爆视口。
- [x] 在 `src/gui/src/styles.css` 新增 `.projects-sidebar-hint` 样式（小号字、`color: var(--muted)`，等宽 `<code>` 子元素的间距）以承载新 CLI 提示。验收：展开态文案与命令对齐美观；折叠态图标 tooltip 可见。
- [x] 改造 `src/gui/src/components/ProjectsSidebar.tsx`：删除 footer `<button class="projects-sidebar-add">`、`onAdd` / `adding` / 仅 add 相关 `error` 状态、`promptAddProject` 函数体与导出、`pickerSupported` / `pickerSupportedClient`；在 footer 渲染常驻 CLI 提示（展开态：`添加项目请在终端执行：` + `<code>yorz add &lt;path&gt;</code>`；折叠态：图标 + tooltip `yorz add <path>`）；保留 `removeProject` hover ✕ 流程不变。验收：组件无 add 相关代码残留，提示文案在展开/折叠两态均渲染正确，TypeScript 编译通过。
- [x] 改造 `src/gui/src/pages/Welcome.tsx`：移除「＋ 添加你的第一个项目」CTA 按钮及其 `onAdd` 处理与 `promptAddProject` / `api.addProject` 调用；改为与 Sidebar 一致的静态 CLI 提示行（文案 `添加项目请在终端执行：` + `<code>yorz add <path></code>`）。验收：空项目列表态下页面不再触发 `addProject`，提示文案与 Sidebar 一致。
- [x] 删除 `src/gui/src/lib/api.ts` 的 `addProject` 方法；确认 `listProjects` / `removeProject` 不受影响。验收：grep 全仓无 `api.addProject` 残留引用；类型检查通过。
- [x] 同步检查并更新 `src/gui/src/__e2e__/*` 中涉及 "add project" 的用例：移除被删除的交互断言，或改为校验新 CLI 提示文案存在；CLI 路径用例不动。验收：相关 e2e 文件不再引用 `addProject` / `promptAddProject` 符号；测试编译通过。
- [x] 收尾验证：运行项目可用的类型检查与测试（如 `pnpm typecheck` / `pnpm test` 等），记录结果；若环境不可执行则在执行记录中标注阻塞。
- [x] 重构 `src/gui/src/lib/api.ts`：`projectBase(pid)` 直接接受 pid 拼 URL；所有 project-scoped 方法（`listSpecs` / `getSpec` / `createSpec` / `appendAnnotation` / `submitQuestionAnswers` / `runAgent` / `appendItem` / `explain` / `listSpecChanges` / `commitSpecChanges` / `createDraft` / `uploadAttachment` / `deleteAttachment` / `renameAttachment` / `draftAttachmentUrl` / `specAttachmentUrl`）首位参数新增 `pid: string`；删除对 `currentProjectId` 的 import；`listProjects` / `removeProject` 保持原状。验收：`api.ts` 不再 import `currentProjectId`；所有 project-scoped 方法签名带 `pid: string`；TypeScript 编译通过。
- [x] 重构 `src/gui/src/lib/sse.ts`：`subscribeSpec` / `subscribeRun` / `fetchActiveRuns` / `cancelRun` / `subscribeSpecsList` 首位参数新增 `pid: string`；`projectBase(pid)` 直接拼 URL；删除对 `currentProjectId` 的 import。验收：模块不再依赖隐式全局；导出函数签名全部携带 `pid: string`；TypeScript 编译通过。
- [x] 调整 `src/gui/src/lib/project.ts`：删除命令式 `currentProjectId()` 函数；`projectHref(sub, projectId?)` 未传 pid 时回退到 `activeProjectId` 信号（不再走 `window.location.pathname` 解析）；保留 `activeProjectId` / `setActiveProjectId` / `useCurrentProjectId` / `initialProjectIdFromUrl` 现有导出。验收：`grep -n currentProjectId src/gui/src` 仅剩本文件外的零引用；`projectHref` 在 `AppShell.tsx` 当前调用方式下行为不变。
- [x] 更新 `src/gui/src/pages/Home.tsx`：`createResource` fetcher 内显式调用 `api.listSpecs(pid)`（fetcher 参数已是当前 pid）；如订阅了 `subscribeSpecsList`，传入 pid。验收：切换项目后立即触发的请求 URL 中 pid 与 `useCurrentProjectId()` 一致；不再出现旧 pid 请求。
- [x] 更新 `src/gui/src/pages/SpecDetail.tsx`：以 `useCurrentProjectId()` 取 pid，`api.getSpec` / `api.runAgent` / `api.appendAnnotation` / `api.submitQuestionAnswers` / `api.appendItem` / `api.explain` 调用全部显式传 pid；`subscribeSpec` 同步首位传 pid；`agentTasks.start(...)` 调用增加 `projectId` 字段。验收：组件无 `currentProjectId` 引用；TypeScript 编译通过。
- [x] 更新 `src/gui/src/pages/SpecReview.tsx`：以 `useCurrentProjectId()` 取 pid，`api.getSpec` / `api.listSpecChanges` / `api.commitSpecChanges` 调用显式传 pid。验收：组件无 `currentProjectId` 引用；TypeScript 编译通过。
- [x] 更新 `src/gui/src/pages/NewSpec.tsx`：以 `useCurrentProjectId()` 取 pid，`api.createDraft` / `api.uploadAttachment` / `api.deleteAttachment` / `api.renameAttachment` / `api.listSpecs` / `api.createSpec` / `subscribeSpecsList` 调用全部显式传 pid；如 `agentTasks.start(...)` 调用存在，补 `projectId` 字段。验收：组件无 `currentProjectId` 引用；TypeScript 编译通过。
- [x] 更新 `src/gui/src/lib/agent-tasks.ts`：`AgentTaskInput` 与 `AgentTask` 各增 `projectId: string` 字段；`start` 内 `subscribeRun(input.projectId, runId, ...)`；`dismiss` 按 `state.tasks[runId].projectId` 调 `cancelRun`；`hydrateFromActiveRuns(pid)` 接受 pid 入参并向 `fetchActiveRuns(pid)` 透传，新建 task 时填入 `projectId: pid`；删除对 `currentProjectId` 的隐式依赖。验收：模块不再 import `currentProjectId`；watchdog / cancel / hydrate 路径按任务自带 pid 工作；TypeScript 编译通过。
- [x] 更新 `src/gui/src/AppShell.tsx`：`hydrateFromActiveRuns(pid)` 调用显式传 pid（在已有 `createEffect` 内取 `activeProjectId()` 传入即可）；保留 `setActiveProjectId` effect。验收：切换项目后 `hydrateFromActiveRuns` 按新 pid 拉活动 run；AppShell 无新增 race。
- [x] 更新 `src/gui/src/lib/__tests__/agent-tasks.test.ts`：把 mock 的 `subscribeRun` / `cancelRun` / `fetchActiveRuns` 调整为接受 pid 首位参数；测试构造 `start(...)` 时填 `projectId`；保留既有断言语义。验收：`pnpm test -- agent-tasks` 全部通过；mock 行为与新签名对齐。
- [x] 收尾验证：运行 `pnpm run build:gui` 与 `pnpm test`，记录结果；浏览器内手动复现"切换项目 → 立刻点列表项 → 查看请求 URL"路径，断言 pid 与 URL 末段一致。环境不可执行时在执行记录中标注阻塞。

## 7. 追加任务

- 暂无

## 8. 执行记录

- 2026-06-24 新建 spec：初始化 frontmatter、原样写入用户需求（背景/需求）、完成现状分析与技术实现方案、列出 4 条 `## 待确认问题`；进入 plan 阻塞，等待用户审阅批注。
- 2026-06-24 进入 tasks（第一轮）：消费用户对 4 条原始问题的批注（Bug 1=方案 A、Bug 2=保留 topbar sticky、Bug 3 文案=`添加项目请在终端执行：yorz add <path>`、`api.addProject`/`promptAddProject` 全部删除），将决策回填至 4.1/4.2/4.3；grep 发现 `Welcome.tsx` 也是 Web 端调用方，与"全部删除"批注的前置条件「无其它消费方」冲突；按 tasks 阶段规则回退 plan，3.5/3.6/4.3/4.4 补充 Welcome.tsx 影响面，`## 待确认问题` 新增 1 条关于 Welcome 入口处置，等待用户批注。
- 2026-06-24 进入 tasks（第二轮）：消费用户对 Welcome 处置的批注（方案 A：移除 CTA 改静态 CLI 提示），回填 4.3 / 4.4；`## 待确认问题` 清空为「暂无」；按"动作 + 对象 + 验收点"拆解 8 条任务进入 `## 任务清单`；删除 `## 用户批注` 章节，进入 execute。
- 2026-06-24 execute：依次完成 8 条任务。改动点：
  - `src/gui/src/lib/project.ts`：`currentProjectId()` 优先解析 `window.location.pathname`，回退到 `activeProjectId` 信号；消除路由切换与 fetcher 之间的 pid race。
  - `src/gui/src/styles.css`：`.app` 改为 `height: 100vh; overflow: hidden`；`.shell-body` 加 `overflow: hidden`；`.content` 加 `overflow-y: auto`；删除旧 `.projects-sidebar-add` 样式（含 disabled/collapsed 变体），新增 `.projects-sidebar-hint` / `.projects-sidebar-hint-icon` / `.projects-sidebar.collapsed .projects-sidebar-foot` 样式。
  - `src/gui/src/components/ProjectsSidebar.tsx`：删除 `promptAddProject` 函数与导出、`PickerWindow` / `pickerSupported` / `pickerSupportedClient`、`onAdd` / `adding` 状态、footer add 按钮；footer 渲染常驻 CLI 提示（展开态文案+`<code>`，折叠态 `?` 图标 + tooltip）；`removeProject` 流程保持不变。
  - `src/gui/src/pages/Welcome.tsx`：移除 CTA 按钮、`onAdd`、`busy`/`error` 状态以及对 `promptAddProject` / `api.addProject` 的依赖，改为静态 CLI 提示行（复用 `.projects-sidebar-hint` 样式）。
  - `src/gui/src/lib/api.ts`：删除 `addProject` 方法；`listProjects` / `removeProject` 保留。
  - e2e：grep 确认 `src/gui/src/__e2e__/*` 未引用相关符号，无需改动。
  - 验证：`npx prettier --write` 6 个改动文件均 unchanged（已合规）；`pnpm run build:gui` 成功（122 modules）；`pnpm test` 23 个文件 / 182 个用例全 pass。
- 2026-06-25 变更重开：用户在需求 2 处批注 "问题仍然存在，请以URL为准，API请求在点击项目切换完成之后再调用"。
  - 复核 `@solidjs/router@0.16.1` 源码（`routing.js` 357-385 / `routers/Router.js` 18-29）确认：`navigate()` 在 `startTransition` 中先 `setReference(target.value)` 更新 `useParams` / `useLocation`，再在 `.finally → batch → navigateEnd → setSource` 中调用 `window.history.pushState`。
  - 结论：前一轮方案 A（在 `currentProjectId()` 中读 `window.location.pathname`）在 fetcher 执行时 `pushState` 尚未发生，取回的仍是旧 pid，Bug 1 复现。
  - 行动：frontmatter `stage` 回到 `plan`；§3.6 / §3.7 增补 SolidRouter 时序与方案 A 失效根因；§4.1 列出 C1（显式传 pid，推荐）/ C2（作用域覆盖）/ C3（等待导航稳定）三个候选；§4.4 / §4.5 同步调整文件清单与边界；§5 新增方案选型问题，等待用户批注确认。Bug 2 / Bug 3 既有实现保留不动。
- 2026-06-25 进入 tasks（C1 轮）：消费用户对方案选型批注「候选 1：C1 —— 改 api 签名，所有 fetcher 显式传 pid」；§4.1 改写为 C1 落地决策（含 sse.ts / project.ts / agent-tasks.ts / AppShell 同步调整、保留 `activeProjectId` 仅用于非 race-critical 订阅）；§4.4 收敛为 C1 最终文件清单；§5 清空为「暂无」；按"动作 + 对象 + 验收点"在 §6 追加 10 条 C1 新任务；删除 `## 用户批注` 章节，进入 execute。
- 2026-06-25 execute（C1 轮）：依次完成 10 条新任务。改动点：
  - `src/gui/src/lib/api.ts`：`projectBase(pid)` 直接接受 pid；所有 project-scoped 方法（`listSpecs` / `getSpec` / `createSpec` / `appendAnnotation` / `submitQuestionAnswers` / `runAgent` / `appendItem` / `explain` / `listSpecChanges` / `commitSpecChanges` / `createDraft` / `uploadAttachment` / `deleteAttachment` / `renameAttachment` / `draftAttachmentUrl` / `specAttachmentUrl`）首位参数加 `pid: string`；删除 `listReq` / `opReq` 包装函数；移除对 `currentProjectId` 的 import；`listProjects` / `removeProject` 保持不变。
  - `src/gui/src/lib/sse.ts`：`subscribeSpec` / `subscribeRun` / `fetchActiveRuns` / `cancelRun` / `subscribeSpecsList` 首位参数加 `pid: string`，本地 `projectBase(pid)` 直接拼 URL；移除对 `currentProjectId` 的 import。
  - `src/gui/src/lib/project.ts`：删除命令式 `currentProjectId()` 函数；`projectHref(sub, projectId?)` 未传 pid 时回退 `activeProjectId` 信号（不再走 URL 解析）；保留 `activeProjectId` / `setActiveProjectId` / `useCurrentProjectId` / `initialProjectIdFromUrl` 导出。
  - `src/gui/src/lib/agent-tasks.ts`：`AgentTask` / `AgentTaskInput` 各增 `projectId: string`；`start` 内 `subscribeRun(input.projectId, input.runId, ...)`，task 对象持 `projectId`；`dismiss` 按 `t.projectId` 调 `cancelRun(t.projectId, runId)`；`hydrateFromActiveRuns(pid)` 接受 pid 入参并向 `fetchActiveRuns(pid)` 透传、`start({ projectId: pid, ... })`。
  - `src/gui/src/AppShell.tsx`：`hydrateFromActiveRuns(pid)` 显式传 pid（取 `activeProjectId()`）；`setActiveProjectId` effect 保留作 hydrate 去重 + UI 响应。
  - `src/gui/src/pages/Home.tsx`：fetcher 内 `api.listSpecs(pid)`。
  - `src/gui/src/pages/SpecDetail.tsx`：以 `useCurrentProjectId()` 取 pid；`createResource` source 增加 pid；`subscribeSpec(pid, id, ...)`；`api.getSpec/runAgent/appendAnnotation/submitQuestionAnswers/appendItem/explain` 全部显式传 pid；`agentTasks.start(...)` 4 处补 `projectId`。
  - `src/gui/src/pages/SpecReview.tsx`：以 `useCurrentProjectId()` 取 pid；`api.getSpec/listSpecChanges/commitSpecChanges` 显式传 pid；两个 `createResource` source 加 pid。
  - `src/gui/src/pages/NewSpec.tsx`：以 `useCurrentProjectId()` 取 pid；`api.createDraft/uploadAttachment/deleteAttachment/renameAttachment/listSpecs(×2)/createSpec` 显式传 pid；`subscribeSpecsList(pid, ...)`；`agentTasks.start(...)` 补 `projectId`。
  - `src/gui/src/lib/__tests__/agent-tasks.test.ts`：mock 的 `cancelRun(_pid, _runId)` / `fetchActiveRuns(_pid)` / `subscribeRun(_pid, runId, handlers)` 签名加 pid；`startSampleTask()` 给 `start(...)` 加 `projectId: 'p1'`。
  - 验证：`grep -n "\bcurrentProjectId\b"` 无残留命中；`pnpm run build:gui` 成功（122 modules / 581ms）；`pnpm test` 23 个文件 / 182 个用例全 pass；`npx prettier --write` 10 个改动文件均合规。残留 jsdom EventSource 不支持的环境限制，未补 race 相关 e2e 用例（已在 §4.4 备注）；浏览器手动复现"切换项目立刻点列表项"路径需用户在真实环境验证。
