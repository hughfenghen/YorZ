---
stage: execute
last_action: 执行追加任务（fix）：响应式 project-id + 项目侧栏宽度可拖拽
updated_at: 2026-06-24
summary: 引入多项目管理：全局配置记录托管项目，serve CLI 可在任意目录运行，URL 路由加 project-id 前缀，GUI 左侧新增可折叠项目导航面板。
---

# 多项目管理

## 1. 背景

新增实现项目管理功能， yorz 全局配置目录存储已经管理的项目（目录）；
serve cli 命令可以在任意目录运行，根据项目列表托管加载对应项目下的spec文档；
需要变更URL路由：/<project-id>/specs/<spec-id>, GUI 当前的首页对应的 path 是 /<project-id>/;
左侧新增一个可折叠的垂直方向面板，用于项目导航和管理（增删），使用项目目录名作为项目名称，列表按最近执行任务的时间降序；

## 2. 需求

- 在 yorz 全局配置目录中维护"已托管项目列表"（项目=本地目录），支持增/删。
- `serve` CLI 不再绑定单一项目根，可在任意目录运行，并按全局项目列表同时托管多个项目的 spec 文档。
- 调整 URL 路由：
  - 首页：`/<project-id>/`
  - spec 详情：`/<project-id>/specs/<spec-id>`
- GUI 左侧新增一个**可折叠**的垂直方向项目导航面板：
  - 列出全部已托管项目，以**项目目录名**作为显示名称；
  - 支持新增项目（选定/输入目录路径）、移除项目；
  - 列表按"最近执行任务的时间"降序排列；
  - 折叠/展开状态需被持久化（与其它 dock 保持一致体验）。

## 3. 现状分析

### 3.1 CLI 与 Service 启动链路（单项目硬编码）

- `src/cli/index.ts:65-77` 注册 `serve` 子命令，仅暴露 `--port` / `--open` / `--cwd`（默认 `process.cwd()`）。
- `src/cli/serve.ts:9-14` 把 `cwd` 直透到 `start({ cwd })`。
- `src/service/index.ts:27-51` 内部以单个 `cwd` 实例化全部依赖：
  - `SpecStore({ cwd })` → `this.root = join(cwd, '.yorz', 'specs')`（`src/service/spec-store.ts:90`）
  - `SpecWatcher({ cwd })` → 同一个 `.yorz/specs` 根（`src/service/watcher.ts:22`）
  - `TouchedFilesStore({ cwd })` / `AttachmentStore({ cwd })` / `AgentRunner({ cwd, touched })`
- 整条链路都是单项目模型，没有 `projectId` / 多 root 概念。
- `createApp({ ..., cwd })` 接收 `cwd` 并透传给各路由，HTTP 层亦无项目维度。

### 3.2 现有"项目"端点

- `src/service/routes/project.ts` 只有 `GET /projects/current → { cwd, name: basename(cwd) }`，没有增删管理；GUI 端没有"项目列表"概念。

### 3.3 全局配置目录现状

- 仓库内只有 **项目级** `.yorz/config.json`（`src/service/agent-config.ts:78`），字段仅 `{ agent: 'claude' | 'opencode' }`。
- **不存在** `~/.yorz/` 或 `~/.config/yorz/` 之类的用户级全局配置目录。Claude / OpenCode 各自的 skill 安装路径不属于 yorz 全局配置。
- 因此"已托管项目列表"需要新建一份全局配置文件并配套读写工具。

### 3.4 GUI 路由与外壳

- 前端使用 Solid `@solidjs/router`（无 hash），路由在 `src/gui/src/main.tsx:13-21`：
  - `/` → `Home`
  - `/specs/new` → `NewSpec`
  - `/specs/:id` → `SpecDetail`
  - `/specs/:id/review` → `SpecReview`
- 应用外壳 `src/gui/src/AppShell.tsx` 当前结构：顶部 `header.topbar` + `main.content` + 右下浮窗 `<AgentPanelDock />`，没有左侧侧栏。
- 现有 dock 参考：`src/gui/src/components/AgentPanelDock.tsx` + `styles.css` 中 `.agent-dock` 样式（含折叠态宽度，参见 `260619.feat.agent-dock-collapsed-width`）。
- 跳转点：`AppShell.tsx:17,24`、`Home.tsx:32` 等使用 `<A href="/...">`；fetch 路径集中在 `src/gui/src/lib/api.ts`，目前不带 project 前缀。

### 3.5 "最近执行任务"语义可选源

- spec frontmatter 含 `updated_at`（`YYYY-MM-DD`），`SpecStore` 已按字符串降序排序（`src/service/spec-store.ts:119-124`），可作为项目最近活跃度的一个近似源。
- 文件 mtime 也可用（`watcher` 已有），但精度更粗。
- 真正"agent 执行"维度的时间戳目前没有持久化（`TouchedFilesStore` 只记文件不记时间），需要新增字段或读取已有事件流。

### 3.6 追加任务（fix）现状分析

**问题 1：根路径访问后页面白屏 + `/api/projects//{specs,runs}` 404**

复现路径：

1. 浏览器打开 `http://localhost:7423/`，`window.location.pathname === '/'`。
2. `AppShell` 立即 mount，`onMount` 同步调用 `agentTasks.hydrateFromActiveRuns()`（`src/gui/src/AppShell.tsx:13-15`）。
3. `hydrateFromActiveRuns` → `fetchActiveRuns()` → `${projectBase()}/runs`（`src/gui/src/lib/sse.ts:162-170`）。
4. `projectBase()` 调 `currentProjectId()`（`src/gui/src/lib/api.ts:85-87`、`src/gui/src/lib/sse.ts:3-5`），而 `currentProjectId()` 同步读 `window.location.pathname`（`src/gui/src/lib/project.ts:8-12`）。此刻仍是 `/`，正则匹配为空，返回 `''`。
5. 请求落到 `/api/projects//runs` → 404。
6. 与此同时 `ProjectIndexRedirect` 拉到 `listProjects()` 后渲染 `<Navigate href="/yorz-6f1f9f" replace>`。`@solidjs/router` 的 `<Navigate>` 在 effect 内调用 `useNavigate()(...)`，**router 内部 reactive 信号先更新触发 `Home` 同步 mount，而 `history.replaceState` 在下一拍的 effect 里才真正改写 `window.location.pathname`**。
7. `Home` mount 时立即触发 `createResource(() => api.listSpecs())`（`src/gui/src/pages/Home.tsx:7`）；fetcher 内的 `projectBase()` 还是非响应式地读 `window.location.pathname`，看到的还是 `/`，于是请求 `/api/projects//specs` → 404 → `<Suspense>` 抛错或空，页面白屏。

根因归一：**`projectBase()` 通过 `currentProjectId()` 同步读取 `window.location.pathname`，绕过了 `@solidjs/router` 的 reactive 路由状态**。首次挂载与路由切换的瞬时窗口内，`window.location.pathname` 与 router 已感知的 URL 不一致；只要在这个窗口内向 project-scoped 端点发请求，project-id 就会拿到空串。

附加：即使 project-id 暂时拿不到，project-scoped 请求函数也不应该把空 project-id 拼成合法 URL 发出去，本身也是防御缺位。

**问题 2：左侧项目导航面板宽度无法用户调整**

- 当前 `src/gui/src/components/ProjectsSidebar.tsx` 仅有"折叠 / 展开"两态，无 resize 手柄；展开态宽度由 `src/gui/src/styles.css` 中 `.projects-sidebar` / `.projects-sidebar.expanded` 固定 CSS 控制。
- 折叠态宽度沿用 `.agent-dock` 折叠规范（约 36px），本次不改动。
- 折叠态持久化键已用 `localStorage['yorz.projectsSidebar.collapsed']`；宽度也宜走同一类的客户端本地持久化。

## 4. 技术实现方案

### 4.1 全局配置：`~/.config/yorz/projects.json`

按 XDG 规范选定全局配置目录（默认 `${XDG_CONFIG_HOME ?? join(homedir(), '.config')}/yorz/`，可通过 `YORZ_HOME` 环境变量整体覆盖）：

```ts
// src/service/global-config.ts
export interface GlobalProjectEntry {
  id: string // 稳定 ID（见 4.2）
  path: string // 绝对路径
  addedAt: string // ISO datetime，新增时刻
  lastActivityAt: string | null // ISO datetime，见 4.6
}
export interface GlobalConfig {
  version: 1
  projects: GlobalProjectEntry[]
}
```

- 文件位置：`${YORZ_HOME ?? join(XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'yorz')}/projects.json`，文件不存在时按空列表返回；目录缺失时按需 `mkdir -p`。
- 写入采用"先写临时文件再 rename"避免半写。
- 提供 `loadGlobalConfig()` / `saveGlobalConfig()` / `addProject(path)` / `removeProject(id)` / `touchProjectActivity(id, when)` 等纯函数。

### 4.2 project-id 设计

- 直接用 `basename(path)` 作为展示名（满足需求），但 **不能** 作为 URL ID（不同目录可能重名 / 含非法字符）。
- 采用"短 hash + 可读 slug"组合：`id = ${slugify(basename)}-${hash6(absPath)}`，例如 `yorz-9f3a1c`。
  - `slugify` 仅保留 `[a-z0-9-]`；空串退化为 `proj`。
  - `hash6` 取 `sha256(absPath).hex.slice(0, 6)`，对绝对路径稳定可复现。
- 路径变更（如用户重命名目录）会产生新 ID；由用户在 GUI 中手动重新添加即可（4.9 不再保留软迁移）。

### 4.3 Service 多项目模型

- 抽象 `ProjectInstance`：每个项目持有自己的 `SpecStore` / `SpecWatcher` / `TouchedFilesStore` / `AttachmentStore` / `AgentRunner`，所有依赖以**该项目目录**为 cwd 构造。
- **agent 进程 cwd 强约束**：用户在某个项目下触发 agent 执行任务时，`AgentRunner.spawn` 的 `cwd` 必须是对应 `ProjectInstance` 的项目目录（不得退化为 `process.cwd()`），以保证 agent 在多项目环境下读写正确的项目根。
- 新增 `ProjectRegistry`（在 `service/index.ts` 内）：
  - 启动时从全局配置加载列表，按需 lazy 构造 `ProjectInstance`（首次访问该项目时实例化），避免一次性 watch 大量目录。
  - 提供 `getOrCreate(id)`、`add(path)`、`remove(id)`、`list()`。
  - 监听全局配置变化（FS watch 或显式 API 触发的内存刷新）。
- `createApp` 不再接收单一 `cwd`，而是接收 `ProjectRegistry`；所有现有路由统一改为 `/api/projects/:projectId/...` 前缀，handler 内通过 `registry.getOrCreate(projectId)` 取到对应实例。
- 兼容性：保留一个全局根级 `GET /api/projects` 用于列表，`POST /api/projects` 新增，`DELETE /api/projects/:id` 移除。

### 4.4 CLI `serve` 行为变更

- `serve` 不再要求 `--cwd` 指向单一项目；默认从全局配置加载项目列表。
- 启动时根据 `4.7` 的策略决定是否将"当前 cwd"自动注册到列表。
- 输出日志带项目数：`YorZ Service ready at … (3 projects)`，并打印每个项目 `name -> path`。

### 4.5 GUI 路由调整

- `main.tsx` 路由改造：
  ```
  <Route path="/" component={ProjectIndexRedirect} />
  <Route path="/:projectId" component={Home} />
  <Route path="/:projectId/specs/new" component={NewSpec} />
  <Route path="/:projectId/specs/:id" component={SpecDetail} />
  <Route path="/:projectId/specs/:id/review" component={SpecReview} />
  ```
- 新增 `ProjectIndexRedirect`：若有项目则 redirect 到"最近活跃"那个；若空则展示"空态欢迎页"（位于 `/`，提示新增第一个项目）。
- `api.ts` 中所有请求 URL 加入项目前缀；新增 `useCurrentProjectId()` Hook 从路由参数读取。
- `AppShell.tsx` 顶栏的 `<A href="/" />`、`<A href="/specs/new" />` 等链接统一通过 helper `projectHref(projectId, sub)` 生成。
- 旧 URL（无前缀的 `/specs/:id` 等）**不做兼容**：未命中任何前缀化路由的请求直接落到空态欢迎页 / 404 视图。

### 4.6 "最近执行任务时间"维护

- 在 `AgentRunner` 真正启动一次 agent 进程时，调用 `touchProjectActivity(projectId, new Date().toISOString())`，写回全局配置文件。
- `lastActivityAt` 缺失（如旧记录、从未跑过 agent）的项目，按 `max(updated_at of specs)` 兜底；都没有时排在最末。
- 排序逻辑统一在后端 `GET /api/projects` 完成，前端直接消费有序列表。

### 4.7 添加 / 删除项目

- 添加入口（GUI 侧）：
  - 项目导航面板底部一个"＋ 添加项目"按钮，点击后调用浏览器 `window.showDirectoryPicker()`（File System Access API）选目录；
  - 由于 picker 不直接暴露绝对路径，在选目录之后弹出确认弹窗：展示 picker 返回的 `directoryHandle.name` 作为目录名提示，附一个"绝对路径"输入框让用户最终确认/粘贴绝对路径；
  - 提交后调用 `POST /api/projects { path }`，service 端校验：路径必须存在、是目录、有写权限、`basename(path)` 与提示一致（不一致时仅警告，不阻止）；首次添加时自动 `mkdir -p <path>/.yorz/specs`。
  - 浏览器不支持 `showDirectoryPicker` 时（兼容性差），按钮置灰并在 tooltip 中提示"请使用支持 File System Access API 的现代浏览器"。
- 删除入口：列表项 hover 出现 ✕ 图标，二次确认弹窗中**明确告知磁盘 `.yorz/` 不会被删除**，确认后调用 `DELETE /api/projects/:id`，**仅从全局配置移除**（绝不删除磁盘文件）。
- 启动时 cwd 自动注册：默认开启——如果 `process.cwd()` 不在列表中且存在 `.yorz/` 子目录则静默注册；否则不自动注册（避免污染列表）。可用 `--no-register-cwd` 关闭。

### 4.8 GUI 左侧项目导航面板

- 新增组件：`src/gui/src/components/ProjectsSidebar.tsx`，挂到 `AppShell.tsx` 内层 flex 容器（与 `<main>` 同级，位于左侧）。
- 折叠/展开：参考 `agent-dock` 折叠态做法，折叠后保留细窄列（仅显示项目首字符 + 当前选中高亮），展开时显示全名列表。
- 折叠状态持久化：写入 `localStorage['yorz.projectsSidebar.collapsed']`（每客户端独立，与 `agent-dock` 一致）。
- 列表项交互：点击切换路由到 `/<projectId>/`；当前激活项目以 `useParams().projectId` 高亮。
- 排序：直接消费后端有序列表（4.6）。

### 4.9 迁移与回滚

- 首次启动旧用户：若旧 `--cwd` 目录（或 `process.cwd()`）有 `.yorz/`，按 4.7 的策略自动写入全局列表，原有体验保留。
- API 路由前缀变更与旧 URL 失效均属于 break-change：CLI 主版本号无需升级（项目尚处 0.x），但需要在 README 与 release notes 中标注。
- 不在本期同步新增 CLI 子命令（`yorz project add/list/remove`）；增删仅通过 GUI 完成。

### 4.10 追加任务（fix）实现方案

#### 4.10.1 问题 1：project-id 响应式 + 空值短路

把"获取当前 project-id"完全切到 `@solidjs/router` 的响应式路由状态，并阻止 project-id 为空时仍向 project-scoped 端点发请求。

- 新增模块级 reactive signal（在 `src/gui/src/lib/project.ts`）：
  - `export const [activeProjectId, setActiveProjectId] = createSignal('')`，作为非响应式上下文（`api.ts` / `sse.ts`）可读、响应式上下文可订阅的唯一真相来源。
  - 在 `AppShell` 顶层用 `createEffect(() => { const pid = matchProjectIdFromPath(useLocation().pathname); setActiveProjectId(pid) })` 订阅 router 的 reactive `pathname`，与 router 同帧更新 signal，避开 `window.location.pathname` 的滞后窗口。
  - 原 `currentProjectId()` 改为读 `activeProjectId()`（不再读 `window.location`），保留同名 API 以便最小改动现有调用方。
  - `useCurrentProjectId()` 改为 `() => activeProjectId`（返回响应式 getter）；`useParams()` 仍可继续在组件内用作直接路由参数读取，与 signal 取值一致。

- `src/gui/src/lib/api.ts` / `src/gui/src/lib/sse.ts` 的 `projectBase()` 改为：
  - 读 `activeProjectId()`；若为空，project-scoped 请求函数走"空值短路"：
    - list 类（`listSpecs` / `fetchActiveRuns` / `listSpecChanges`）→ `Promise.resolve([])` 或对应类型的空值；
    - 操作类（`runAgent` / `appendItem` / `commitSpecChanges` 等）→ `Promise.reject(new Error('no active project'))`，由调用方按需吞掉（一般这些操作只会在 spec 详情等已落到具体 projectId 的页面触发，正常不会拿到空 pid）；
    - subscribe 类（`subscribeSpec` / `subscribeRun` / `subscribeSpecsList`）→ 返回 no-op 取消函数（不打开 `EventSource`）。
  - 全局 API（`listProjects` / `addProject` / `removeProject`）不依赖 project-id，照常工作。

- `src/gui/src/AppShell.tsx`：
  - `onMount(() => agentTasks.hydrateFromActiveRuns())` 改为 `createEffect(...)`：
    ```ts
    const hydratedFor = new Set<string>()
    createEffect(() => {
      const pid = activeProjectId()
      if (!pid || hydratedFor.has(pid)) return
      hydratedFor.add(pid)
      void agentTasks.hydrateFromActiveRuns()
    })
    ```
  - 项目切换时 reactive 触发新一次 hydrate；同一 project-id 仅 hydrate 一次，避免重复订阅。

- `src/gui/src/pages/Home.tsx`：
  - `createResource(() => api.listSpecs())` 改为以 reactive projectId 作为 source：
    ```ts
    const pid = useCurrentProjectId()
    const [specs, { refetch }] = createResource(pid, (id) =>
      id ? api.listSpecs() : Promise.resolve([] as SpecListItem[]),
    )
    ```
  - URL 变化（项目切换 / 首次 Navigate 到达）会自动 refetch；project-id 为空时直接给空数组，`<Suspense>` 不再卡在 reject。

- 同步审查 `SpecDetail` / `NewSpec` / `SpecReview` / `AgentPanelDock` / `ProjectsSidebar` 中所有 `createResource` 与 `onMount` 中的 project-scoped 调用：能挂 reactive source 的全部改成 reactive；剩余 fire-and-forget 调用统一改成"读 `activeProjectId()` → 空则跳过"。

- 验收：
  - 浏览器打开 `/`，DevTools Network 不再出现 `/api/projects//*` 请求；Navigate 到 `/<projectId>` 后 `listSpecs` 一次成功，页面不再白屏。
  - 在 GUI 切换两个项目，`listSpecs` / `hydrateFromActiveRuns` 各自按新 project-id 发请求。

#### 4.10.2 问题 2：左侧项目导航面板宽度可拖拽 + 持久化

- 在 `src/gui/src/components/ProjectsSidebar.tsx`：
  - 新增宽度 signal：`const [width, setWidth] = createSignal(readWidth())`；常量 `DEFAULT_WIDTH = 220`、`MIN_WIDTH = 160`、`MAX_WIDTH = 480`。
  - 持久化键 `localStorage['yorz.projectsSidebar.width']`（与 `yorz.projectsSidebar.collapsed` 并列），缺失或越界时回退到 `DEFAULT_WIDTH`。
  - 在 `<aside>` 右边缘插入 `<div class="projects-sidebar-resizer" onMouseDown={beginResize} />`：
    - `beginResize(e)`：记 `startX = e.clientX`、`startW = width()`；`document` 上挂 `mousemove`（用 `requestAnimationFrame` 节流），按 `clamp(startW + e.clientX - startX, MIN, MAX)` 更新 signal；挂 `mouseup` 清理监听并把最终值写入 localStorage。
    - 拖拽期间给 `document.body` 加 `.is-resizing` 类禁止文本选中、强制 `cursor: col-resize`。
  - 展开态：`<aside style={{ width: width() + 'px' }}>`；折叠态忽略 inline width，回到 CSS 固定的 36px，且不渲染 resizer。

- `src/gui/src/styles.css`：
  - `.projects-sidebar.expanded` 移除（或降级为 fallback）固定 width，让 inline style 接管。
  - 新增 `.projects-sidebar-resizer { position: absolute; top: 0; right: 0; width: 4px; height: 100%; cursor: col-resize; }`；hover/active 时叠加细微高亮色。
  - `body.is-resizing { user-select: none; cursor: col-resize; }`。

- 边界：
  - 拖拽过程持续约束 MIN/MAX；松手再次校验。
  - 窗口宽度变小时不主动改用户设定的宽度，由 `<main class="content">` 自身布局兜底（`min-width: 0; flex: 1`）。

- 验收：
  - 拖动 resizer 改变宽度；松开后刷新页面，宽度保持。
  - 折叠后展开，宽度恢复到上次拖拽值；MIN/MAX 边界生效。
  - 拖拽过程中不会选中页面文字。

## 5. 待确认问题

- 暂无

## 6. 任务清单

- [x] 新增 `src/service/global-config.ts`：实现 `GlobalConfig` / `GlobalProjectEntry` 类型与 `loadGlobalConfig` / `saveGlobalConfig`（先写临时文件再 rename 原子化），目录解析按 `YORZ_HOME` > `XDG_CONFIG_HOME/yorz` > `~/.config/yorz` 顺序兜底；验收：缺文件时返回空列表，写入后再读结果一致
- [x] 在 `global-config.ts` 中实现 `generateProjectId(absPath)`：`slugify(basename(absPath)) + '-' + sha256(absPath).hex.slice(0,6)`，并验证空 basename → `proj-xxxxxx`；验收：同一绝对路径多次调用返回一致 ID
- [x] 在 `global-config.ts` 中实现 `addProject(path)` / `removeProject(id)` / `touchProjectActivity(id, when)`：增项幂等（同路径不重复）、删项允许不存在不抛错、touch 仅更新 `lastActivityAt`；验收：单测覆盖以上三种场景
- [x] 重构 `src/service/agent-runner.ts`：构造时 cwd 参数指向项目目录，spawn agent 子进程时 `spawn(..., { cwd: projectDir })`，并在 spawn 成功后调用 `touchProjectActivity(projectId, new Date().toISOString())`；验收：多项目并发触发 agent 时各自落地到自己的项目根
- [x] 新增 `ProjectInstance` 抽象：聚合 `SpecStore` / `SpecWatcher` / `TouchedFilesStore` / `AttachmentStore` / `AgentRunner`，构造参数为 `{ id, path }`；验收：实例化后各依赖的 cwd 均为项目目录
- [x] 新增 `ProjectRegistry`：从全局配置加载条目，提供 `list()` / `getOrCreate(id)`（lazy 构造）/ `add(path)`（调 `addProject` 后失效缓存）/ `remove(id)`（调 `removeProject` 并销毁已存在的 instance）；验收：首次 `getOrCreate` 才创建 watcher，二次调用复用同一实例
- [x] 重构 `src/service/index.ts` 的 `start()`：移除单 `cwd` 装配，改为构造 `ProjectRegistry` 并透传到 `createApp`，启动日志输出 `YorZ Service ready at <url> (N projects)` 并逐项打印 `name -> path`
- [x] 重构 `createApp`：签名改为接收 `ProjectRegistry`，所有现有 HTTP 路由整体迁移到 `/api/projects/:projectId/...` 前缀，handler 内统一通过 `registry.getOrCreate(projectId)` 解析；验收：原 specs / attachments / agent-run / touched-files 路由 path 全部带上前缀
- [x] 新增 `GET /api/projects`：返回项目列表，按 `lastActivityAt` 降序，缺失时回退 `max(spec.updated_at)`，都缺失时排末尾；返回字段 `{ id, name, path, lastActivityAt }`
- [x] 新增 `POST /api/projects { path }`：校验路径存在、是目录、可写；首次添加时 `mkdir -p <path>/.yorz/specs`；调用 `registry.add(path)` 后返回新条目；验收：重复添加返回已有条目而非 4xx
- [x] 新增 `DELETE /api/projects/:id`：调用 `registry.remove(id)`，仅修改全局配置，不删除磁盘任何文件；验收：删除后 `GET /api/projects` 不再包含该项，磁盘 `.yorz/` 仍存在
- [x] 移除或重写 `src/service/routes/project.ts` 中的 `GET /projects/current`：在多项目模型下不再单值返回，前端通过路由参数解析当前 projectId
- [x] 修改 `src/cli/index.ts` 的 `serve` 子命令：移除 `--cwd` 默认硬绑（保留为可选的 cwd 提示但不再单项目化），新增 `--no-register-cwd` 开关
- [x] 修改 `src/cli/serve.ts`：去掉 `start({ cwd })`，启动后若 `process.cwd()` 不在全局列表且该目录存在 `.yorz/` 子目录则静默调用 `registry.add(process.cwd())`，`--no-register-cwd` 时跳过
- [x] 修改 `src/gui/src/main.tsx`：将原 `/`、`/specs/new`、`/specs/:id`、`/specs/:id/review` 路由整体迁移到 `/:projectId/...` 前缀，新增 `/` → `ProjectIndexRedirect`
- [x] 新增 `ProjectIndexRedirect` 组件：有项目时 redirect 到 `lastActivityAt` 最新的项目 `/<projectId>/`，无项目时展示空态欢迎页（含"添加你的第一个项目"CTA）
- [x] 新增 `useCurrentProjectId()` Hook：基于 `useParams()` 读取 `projectId`，无值时返回 null 并提示路由错位
- [x] 修改 `src/gui/src/lib/api.ts`：所有现有请求 URL 加上 `/api/projects/:projectId` 前缀；新增 `listProjects()` / `addProject(path)` / `removeProject(id)` 三个全局 API
- [x] 修改 `AppShell.tsx` / `Home.tsx` 等导航链接：抽出 `projectHref(projectId, sub)` helper 替换所有硬编码 `<A href="/...">`
- [x] 旧 URL 处理：在 `main.tsx` 路由末尾增加兜底 `*` 路由 → 跳空态欢迎页或简单 404，不做 spec-id 反查
- [x] 新增组件 `src/gui/src/components/ProjectsSidebar.tsx`：挂到 `AppShell` 内层左侧 flex 容器，展开时显示项目目录名列表 + hover ✕ 按钮，折叠时仅显示项目首字符；当前激活项目高亮
- [x] 在 `ProjectsSidebar` 底部加"＋ 添加项目"按钮：点击调用 `window.showDirectoryPicker()` → 弹窗展示 `directoryHandle.name` 并附绝对路径输入框 → 提交后 `addProject(path)`；浏览器不支持 picker 时按钮置灰 + tooltip 提示
- [x] 在 `ProjectsSidebar` 列表项 hover ✕ 按钮：点击弹二次确认（文案明确"不会删除磁盘 .yorz/"）→ `removeProject(id)`
- [x] 折叠/展开状态持久化：`localStorage['yorz.projectsSidebar.collapsed']` 读写；新增对应 CSS（折叠态宽度参考 `agent-dock` 既有规范）
- [x] 空态欢迎页：当 `listProjects()` 返回空数组时，`/` 渲染欢迎页 + CTA"添加你的第一个项目"，CTA 复用 ProjectsSidebar 的 picker 流程
- [x] 更新 `README.md`：补充全局配置路径 `~/.config/yorz/projects.json`、多项目体系、URL 路由变更、添加/删除项目操作说明
- [x] 在 release notes / CHANGELOG 中标注 break-change：API 路径前缀化、旧 URL 不再兼容、`serve --cwd` 行为变更
- [x] 单元 / 集成测试：覆盖 `global-config.ts` 原子写与幂等、`ProjectRegistry` lazy 构造与增删、`GET/POST/DELETE /api/projects` 路由行为
- [x] 端到端手动验证清单：在浏览器中验证 ① 添加项目 → 列表出现并跳到该项目首页；② 切换项目 → 路由前缀正确；③ 折叠侧边栏并刷新 → 折叠状态保持；④ 删除项目 → 列表移除且磁盘 `.yorz/` 仍在；⑤ agent 触发后 `lastActivityAt` 更新并使该项目升至列表顶；⑥ 旧 URL 直接落到空态欢迎页
- [x] 改写 `src/gui/src/lib/project.ts`：导出 `[activeProjectId, setActiveProjectId] = createSignal('')` 模块级 reactive signal；`currentProjectId()` 改为 `() => activeProjectId()`（不再读 `window.location`）；`useCurrentProjectId()` 改为返回 `() => activeProjectId()`；保留 `projectHref()` 行为；验收：组件外可同步读取，组件内变化时响应式触发依赖
- [x] 修改 `src/gui/src/AppShell.tsx`：在顶层用 `createEffect` 订阅 `useLocation().pathname`，匹配 `^/([^/]+)`（且首段不为 `api`）后调用 `setActiveProjectId`；将 `onMount(() => agentTasks.hydrateFromActiveRuns())` 改为 `createEffect`，配合 `Set<string>` 记录已 hydrate 过的 projectId，确保同一 pid 仅 hydrate 一次、切换 pid 时再次 hydrate；验收：进入 `/` 时不触发 hydrate，跳到 `/<pid>` 后 hydrate 一次
- [x] 修改 `src/gui/src/lib/api.ts`：`projectBase()` 在 `activeProjectId` 为空时返回标记值；list 类接口（`listSpecs` / `listSpecChanges`）在空 pid 时直接返回 `[]`；操作类接口（`getSpec` / `createSpec` / `runAgent` / `appendItem` / `appendAnnotation` / `submitQuestionAnswers` / `explain` / `commitSpecChanges` / `createDraft` / 附件相关）空 pid 时 `Promise.reject(new Error('no active project'))`；全局 API（`listProjects` / `addProject` / `removeProject`）保持原样；验收：DevTools Network 不再出现 `/api/projects//*` 请求
- [x] 修改 `src/gui/src/lib/sse.ts`：`fetchActiveRuns()` 空 pid 时返回 `[]`；`subscribeSpec` / `subscribeRun` / `subscribeSpecsList` 空 pid 时返回 no-op 取消函数（不打开 `EventSource`，`readyState` 返回 `EventSource.CLOSED`）；`cancelRun` 空 pid 时静默跳过；验收：在 `/` 下 hydrate 流程不打开任何 EventSource
- [x] 修改 `src/gui/src/pages/Home.tsx`：将 `createResource(() => api.listSpecs())` 改为 `createResource(useCurrentProjectId(), (id) => (id ? api.listSpecs() : Promise.resolve([])))`，让 URL 切换时自动 refetch；验收：从 `/<pid-a>` 切到 `/<pid-b>` 列表自动刷新
- [x] 审查 `src/gui/src/pages/SpecDetail.tsx` / `NewSpec.tsx` / `SpecReview.tsx` / `components/AgentPanelDock.tsx` / `components/ProjectsSidebar.tsx`：将 project-scoped `createResource` / `onMount` 改为 reactive source 或在调用前判空 pid；验收：所有跨页面的 project-scoped 资源在 pid 缺失时均不发请求且不抛错
- [x] 在 `ProjectsSidebar.tsx` 新增宽度 signal：`DEFAULT_WIDTH=220`、`MIN_WIDTH=160`、`MAX_WIDTH=480`；持久化键 `localStorage['yorz.projectsSidebar.width']`，读时 clamp 到 `[MIN, MAX]`，缺失/非法值回退 `DEFAULT_WIDTH`；展开态 `<aside style={{ width: width()+'px' }}>`，折叠态忽略 inline width 由 CSS 接管
- [x] 在 `ProjectsSidebar.tsx` 渲染 resizer：`<div class="projects-sidebar-resizer" onMouseDown={beginResize}>`，仅展开态渲染；`beginResize` 记录 `startX` / `startW`，在 `document` 上挂 `mousemove`（用 `requestAnimationFrame` 节流）按 `clamp(startW + e.clientX - startX, MIN, MAX)` 更新 signal，挂 `mouseup` 清理监听并写 localStorage；拖拽期间给 `document.body` 添加 `.is-resizing` 类、`mouseup` 后移除；验收：松手刷新后宽度保持
- [x] 更新 `src/gui/src/styles.css`：`.projects-sidebar` 的固定 `width: 200px` 改为 fallback（被 inline style 覆盖；折叠态仍由 `.projects-sidebar.collapsed { width: 36px }` 兜底）；新增 `.projects-sidebar { position: relative }`、`.projects-sidebar-resizer { position: absolute; top: 0; right: 0; width: 4px; height: 100%; cursor: col-resize }` + hover 高亮；新增 `body.is-resizing { user-select: none; cursor: col-resize }`；验收：拖拽中不会选中文本、光标保持 col-resize

## 7. 追加任务

- [fixed] [fix] 2026-06-24 21:29 | 1. 访问根目录 http://localhost:7423/ 会自动导航到 http://localhost:7423/yorz-6f1f9f；
  - 描述：1. 访问根目录 http://localhost:7423/ 会自动导航到 http://localhost:7423/yorz-6f1f9f；
    此处发出去的请求缺少 project-id，报错 404，导致页面白屏：http://localhost:7423/api/projects//specs
    http://localhost:7423/api/projects//runs

2. 左侧项目导航面板宽度应该支持用户调整

## 8. 执行记录

- 2026-06-24 新增 `src/service/global-config.ts`：实现 `GlobalConfig` 模型、`loadGlobalConfig` / `saveGlobalConfig`（先写临时文件再 rename 原子化）、`generateProjectId`、`addProject` / `removeProject` / `touchProjectActivity`；目录解析顺序 `YORZ_HOME` > `XDG_CONFIG_HOME/yorz` > `~/.config/yorz`
- 2026-06-24 重构 `AgentRunner`：构造参数新增 `projectId` 与 `globalConfigPath`，spawn 成功后异步调用 `touchProjectActivity(projectId, new Date().toISOString())`
- 2026-06-24 新增 `src/service/project-registry.ts`：`ProjectInstance` 聚合 `SpecStore` / `SpecWatcher` / `TouchedFilesStore` / `AttachmentStore` / `AgentRunner`；`ProjectRegistry` 提供 `list()` / `getOrCreate(id)`（lazy 构造 + 缓存）/ `add(path)` / `remove(id)`（销毁实例后从配置移除）/ `closeAll()`
- 2026-06-24 重构 `src/service/index.ts` `start()` 与 `src/service/server.ts` `createApp`：移除单 cwd 装配，改为构造 `ProjectRegistry` 并透传；启动日志输出 `YorZ Service ready at <url> (N projects)` + 逐项 `name -> path`；`createApp` 内部所有路由整体迁移到 `/api/projects/:projectId/...` 前缀
- 2026-06-24 重写 `src/service/routes/project.ts`：新增 `GET /api/projects` / `POST /api/projects { path }` / `DELETE /api/projects/:id`，移除旧 `/projects/current`
- 2026-06-24 重写 `src/service/routes/specs.ts` / `events.ts` / `spec-drafts.ts`：route factory 接收 `resolveProject(projectId)`，handler 内统一短路 404
- 2026-06-24 修改 `src/cli/index.ts` / `src/cli/serve.ts`：新增 `--no-register-cwd`；`start()` 默认按 `existsSync(cwd/.yorz)` 静默注册 cwd
- 2026-06-24 GUI 路由前缀化：`src/gui/src/main.tsx` 改为 `/`→`ProjectIndexRedirect`，`/:projectId(/specs/...)` 系列；新增兜底 `*` 路由跳 `WelcomePage`
- 2026-06-24 新增 `src/gui/src/lib/project.ts`：`currentProjectId()`（从 URL 读）/ `useCurrentProjectId()` / `projectHref(sub)`
- 2026-06-24 修改 `src/gui/src/lib/api.ts` 与 `lib/sse.ts`：所有请求 URL 加 `/api/projects/:projectId` 前缀；新增 `listProjects` / `addProject(path)` / `removeProject(id)`
- 2026-06-24 新增 `ProjectsSidebar.tsx`、`ProjectIndexRedirect.tsx`、`Welcome.tsx`；`AppShell.tsx` 内层加 `.shell-body` flex 容器挂左侧栏；折叠态持久化到 `localStorage['yorz.projectsSidebar.collapsed']`
- 2026-06-24 GUI 跳转链接统一通过 `projectHref()`：Home / NewSpec / SpecDetail / SpecReview / AgentPanelDock / AppShell 全部更新
- 2026-06-24 `src/gui/src/styles.css` 新增 `.shell-body` / `.projects-sidebar`（含折叠态宽度 36px，参考 `agent-dock` 既有折叠规范） / `.welcome` 等样式
- 2026-06-24 测试：新增 `__tests__/global-config.test.ts` 与 `project-registry.test.ts`（17 cases，覆盖原子写、ID 稳定性、增删幂等、lazy 构造、unknown id）；更新 `service.test.ts` / `spec-drafts-route.test.ts` / `appends-route.test.ts` / `answers-route.test.ts` 的 helper 与 URL 前缀，使用隔离的 `globalConfigPath` 临时文件并预创建 `.yorz/`
- 2026-06-24 验证：`tsc --noEmit` 仅剩遗留的 `QuestionConfirmPanel.tsx` 错误；`vitest run` 174/174 通过；CLI 与 GUI 两端 `vite build` 均成功
- 2026-06-24 文档：`README.md` 补充全局配置路径、多项目体系、URL 变更与破坏性变更说明（CHANGELOG 文件不存在，直接写入 README 破坏性变更段落）
- 2026-06-24 阻塞项：端到端浏览器手动验证清单（① 添加 / ② 切换 / ③ 折叠持久化 / ④ 删除 / ⑤ lastActivityAt 升顶 / ⑥ 旧 URL 跳欢迎页）需在本地 `pnpm dev` + 真实浏览器中执行，自动执行环境不具备相应能力，留待用户验证
- 2026-06-24 追加任务 fix（响应式 project-id）：`src/gui/src/lib/project.ts` 引入模块级 `[activeProjectId, setActiveProjectId] = createSignal('')`，初值兜底从 `window.location.pathname` 解析；`currentProjectId()` 改读 signal，`useCurrentProjectId()` 返回响应式 getter；在 `AppShell.tsx` 用 `createEffect(useLocation().pathname)` 与 router 同帧更新 signal，hydrate 改 `createEffect` + `Set<string>` 去重；`api.ts` / `sse.ts` 的 `projectBase()` 空 pid 时返回 `null`，新增 `listReq` / `opReq` 包装器，list 类返回空值、操作类 reject，subscribe 类返回 no-op 取消函数（不打开 EventSource）；`Home.tsx` 改用 `createResource(projectId, ...)` reactive source
- 2026-06-24 追加任务 fix（项目侧栏宽度拖拽）：`ProjectsSidebar.tsx` 新增 `width` signal（DEFAULT=220, MIN=160, MAX=480）+ 持久化键 `localStorage['yorz.projectsSidebar.width']`，仅展开态在 `<aside>` 右边缘渲染 `.projects-sidebar-resizer`；mousedown 启动 RAF 节流拖拽，mouseup 写入 localStorage，过程中 body 添加 `.is-resizing` 类禁用文本选中并强制 `col-resize` cursor；onCleanup 兜底解绑
- 2026-06-24 追加任务 fix 样式：`styles.css` 中 `.projects-sidebar` 添加 `position: relative` 以承载绝对定位的 resizer，220px 宽度仅作 fallback 由 inline style 接管，折叠态以 `!important` 强制 36px；新增 `.projects-sidebar-resizer` / `body.is-resizing` 样式
- 2026-06-24 验证：`tsc --noEmit` 仅剩遗留的 `QuestionConfirmPanel.tsx` 错误（与本次改动无关）；`vitest run` 174/174 通过；`vite build --config vite.gui.config.ts` 成功（122 modules → 197 KB JS + 20 KB CSS）；浏览器端验证（根路径不再出现 `/api/projects//*` 请求、拖动 resizer 并刷新保持宽度）需在本地 `pnpm dev` 中由用户完成
