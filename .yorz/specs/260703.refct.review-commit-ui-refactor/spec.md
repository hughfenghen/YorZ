---
stage: execute
last_action: execute 完成：textarea 动态高度 + 4:6 布局比已实现，tsc + build 通过
updated_at: '2026-07-04 23:11:00'
summary: 重构 Review 页面：提交改为 primary 按钮并绕过 Agent 直接 git commit，新增 commit message 输入框与操作文件选择清单，Review 按钮重命名并增加禁用逻辑
---

# 260703.refct.review-commit-ui-refactor

## 1. 背景

当前 Review 页面（`SpecReview.tsx`）的四个操作按钮顺序为 `Review（primary）→ 提交 → 丢弃 → 暂存`，且提交/丢弃/暂存全部通过 Agent（`mode=git-ops`）间接执行，存在延迟高、用户无法控制 commit message 与提交文件范围的问题。

## 2. 需求

1. **按钮重排**：`提交`（primary）→ `丢弃` → `暂存` | `Review 变更`
2. **提交绕过 Agent**：点击"提交"时由 server 直接执行 `git add` + `git commit`，不经过 Agent
3. **Commit message 输入框**：默认内容 `${feat|refct|fix}: ${summary}`，用户可编辑
4. **操作文件 radio 组**：`手动选择` / `Agent 智能判定`
   - 列出当前 git 所有变更文件
   - 选择"手动选择"时渲染 checkbox 清单，支持全选/全部取消
5. **Review 按钮调整**：文案改为"Review 变更"；hover tip：`Review 下方变更文件，生成报告`；无变更文件时 disable
6. **双路径操作（批注 5.1/5.2 扩展）**：提交、丢弃、暂存均支持双路径
   - `手动选择` → server 直接执行 git 命令（绕过 Agent）
   - `Agent 智能判定` → 走 Agent git-ops（保留旧路径）
7. **变更文件列表动态更新（批注 5.3）**：通过 SSE 接口每秒推送一次变更文件列表

## 3. 现状分析

### 3.1 前端 SpecReview.tsx

- 按钮区 `.review-actions` 内 4 个按钮硬编码顺序：Review（`primary-action`）→ 提交 → 丢弃 → 暂存。
- `trigger(kind)` 函数统一走 Agent：`review` → `api.triggerReview()`；`commit/discard/stash` → `api.gitOp()`。
- `ActionKind = 'review' | GitOpsAction`，所有操作共享 `isAnyRunning()` 互斥逻辑。
- 无 commit message 输入框、无文件选择 UI、无 git 变更文件列表获取。

### 3.2 后端 API 层

- `POST .../specs/:id/git`（`spec-review.ts:41`）：接收 `{ action }`，构建 prompt 后调用 `p.runner.run({ mode: 'git-ops' })`，由 Agent 执行 git 命令。
- `POST .../specs/:id/review`（`spec-review.ts:23`）：构建 prompt 后调用 `p.runner.run({ mode: 'review' })`。
- **无**变更文件列表 API：`listChanges(cwd)` 已实现（`git.ts:135`）但未被任何路由引用。
- **无**直接 commit/discard/stash API：`commit(cwd, opts)` 已实现（`git.ts:168`，含路径安全校验 `assertSafeRelativePath`）但未被任何路由引用；`discard`、`stash` 函数尚未实现。
- `buildGitOpsPrompt`（`spec-review.ts:85`）按 action 生成 Agent prompt：commit → `git add` + `git commit`；discard → `git restore --staged --worktree` + `git clean -fd`；stash → `git stash push -m "yorz:<specId>"`。

### 3.3 SSE 基础设施

- `events.ts` 中已有 4 类 SSE 端点，统一使用 Hono `streamSSE` + `attachHeartbeat`（5s 心跳）。
- 现有 SSE 均用于 **Agent run 流式输出**（`agent-stdout`/`agent-error`/`agent-exit` 事件），不承载业务数据。
- 前端 `sse.ts` 提供 `subscribeSpec`/`subscribeRun`/`subscribeSpecsList`/`subscribeProjectsList` 四个订阅函数，返回 `SseSubscription`（可取消）。

### 3.4 数据流

```
GUI trigger(kind) → api.gitOp/triggerReview → POST /git | /review
  → p.runner.run({ mode, prompt }) → spawn agent CLI → agent 执行 git 命令
```

重构后双路径数据流：

```
手动选择：  GUI actionClick → api.directAction(pid, id, { message?, paths }) → POST /commit|/discard|/stash → server 直接执行 git
Agent 智能判定：GUI actionClick → api.gitOp(pid, id, action) → POST /git → Agent 执行（保持现有逻辑）
```

变更文件列表数据流：

```
GUI mount → SSE subscribe .../changes/events → server 每秒 listChanges(cwd) → emit changes-updated 事件 → GUI 更新 checkbox 列表
```

### 3.5 布局现状与追加需求差距分析

追加需求要求操作区与 review 文档左右并列各 50%，左侧按 `按钮 → textarea → radio → checkbox` 垂直排列。当前布局为纯纵向堆叠：

```
page-head
review-commit-section（commit message <input>）
review-file-section（radio + checkbox 列表）
review-actions（按钮组）
error / lastRun 信息
review-body（review 报告 markdown）
```

**差距清单：**

| #   | 追加需求                                                    | 当前状态                                                         | 需要的改动                                                                   |
| --- | ----------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | 操作区与 review 文档左右并列各 50%                          | 全部纵向堆叠                                                     | 新增 `.review-split` flex 容器，左操作面板 + 右 review-body 各 `flex: 1 1 0` |
| 2   | 左侧顺序：按钮 → textarea → radio → checkbox                | 当前顺序：input → radio → checkbox → 按钮                        | 在左面板内重排 DOM 顺序                                                      |
| 3   | commit message 为 `<textarea>` 且默认 `${type}: ${summary}` | 当前为 `<input type="text">`，默认值已实现                       | 改为 `<textarea>`，默认值逻辑保持不变                                        |
| 4   | 变更文件列表占据剩余垂直高度，超出滚动                      | `max-height: 260px` 固定高度                                     | 改为 `flex: 1 1 auto; min-height: 0; overflow-y: auto`                       |
| 5   | 变更文件列表项按 CSS 默认折行                               | `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` | 改为 `word-break: break-word; white-space: normal`                           |

## 4. 技术实现方案

### 4.1 后端 git.ts 扩展

新增 `discard` 和 `stash` 直接执行函数（与 `commit` 对等的 server 直连能力）：

```typescript
// src/service/git.ts 新增

export interface DiscardOptions {
  paths: string[]
}

export interface StashOptions {
  message: string
  paths: string[]
}

export async function discard(cwd: string, opts: DiscardOptions): Promise<void>
// git restore --staged --worktree -- <paths> + git clean -fd -- <paths>
// 每个路径经 assertSafeRelativePath 校验

export async function stash(cwd: string, opts: StashOptions): Promise<void>
// git stash push -m "<message>" -- <paths>
// 每个路径经 assertSafeRelativePath 校验
```

### 4.2 后端新增路由

#### 4.2.1 变更文件列表 `GET .../specs/:id/changes`

- 调用 `listChanges(p.workdir)` 返回 `{ changes: GitChange[] }`。
- 无变更时返回空数组。

#### 4.2.2 直接提交 `POST .../specs/:id/commit`

- 请求体：`{ message: string; paths: string[] }`
- 调用 `commit(p.workdir, { message, paths })`（已有路径安全校验）。
- 返回 `{ commit: string }`（commit SHA）。
- 错误处理：空 message / 空 paths / 路径非法 → 400。

#### 4.2.3 直接丢弃 `POST .../specs/:id/discard`

- 请求体：`{ paths: string[] }`
- 调用 `discard(p.workdir, { paths })`。
- 返回 `{ ok: true }`。
- 错误处理：空 paths / 路径非法 → 400。

#### 4.2.4 直接暂存 `POST .../specs/:id/stash`

- 请求体：`{ message: string; paths: string[] }`
- 调用 `stash(p.workdir, { message, paths })`。
- 返回 `{ ok: true }`。
- 错误处理：空 paths / 路径非法 → 400。

### 4.3 后端新增 SSE 端点

#### 4.3.1 变更文件列表流 `GET .../specs/:id/changes/events`

- 连接后立即推送一次 `changes-updated` 事件（payload: `GitChange[]`）。
- 每隔 1 秒调用 `listChanges(cwd)` 并推送 `changes-updated` 事件（仅当结果有变化时推送，减少冗余）。
- 同时挂载 `attachHeartbeat` 保活。
- 事件名：`changes-updated`，payload：`{ changes: GitChange[] }`。

### 4.4 前端 API 客户端扩展

```typescript
// api.ts 新增
getChanges: (pid, id) => request<{ changes: GitChange[] }>(`.../changes`)

directCommit: (pid, id, body: { message: string; paths: string[] }) =>
  request<{ commit: string }>(`.../commit`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

directDiscard: (pid, id, body: { paths: string[] }) =>
  request<{ ok: true }>(`.../discard`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

directStash: (pid, id, body: { message: string; paths: string[] }) =>
  request<{ ok: true }>(`.../stash`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
```

### 4.5 前端 SSE 客户端扩展

```typescript
// sse.ts 新增
export function subscribeChanges(
  pid: string,
  id: string,
  onUpdate: (changes: GitChange[]) => void,
): SseSubscription
// 连接 .../specs/:id/changes/events，监听 changes-updated 事件
```

### 4.6 SpecReview.tsx UI 重构

#### 4.6.1 按钮布局

```
[Commit Message 输入框]

[文件选择 radio: 手动选择 / Agent 智能判定]
[文件 checkbox 清单（手动选择时显示）]

[提交(primary)] [丢弃(danger)] [暂存]  ｜  [Review 变更]
```

- "提交"使用 `class="primary-action"`，移到最前。
- "丢弃"加 `class="ghost danger"`。
- "暂存"保持 `class="ghost"`。
- 按钮组用 CSS 分隔符视觉隔开 Review 按钮。

#### 4.6.2 Commit message 输入框

- `<input>` 元素，放置在按钮组上方。
- 默认值由 spec frontmatter 推导：`${type}: ${summary}`（type 从 specId 提取，如 `refct`）。
- 用户可自由编辑。

#### 4.6.3 操作文件 radio 组

- 两个选项：`手动选择`（默认）/ `Agent 智能判定`。
- 选择"手动选择"时：
  - 渲染文件 checkbox 清单（从 SSE `changes-updated` 事件获取）。
  - 每项前渲染 checkbox，附带文件路径与状态标识（M/A/D/??/R）。
  - 顶部"全选/全部取消"切换按钮。
- 选择"Agent 智能判定"时：
  - 隐藏 checkbox 清单。
  - 操作时由 Agent 判断文件范围（走现有 git-ops 路径）。

#### 4.6.4 操作逻辑（双路径）

对提交、丢弃、暂存三个操作，根据 radio 选择分支：

- **手动选择**：
  - 收集选中的文件路径。
  - 提交 → `api.directCommit(pid, id, { message, paths })`。
  - 丢弃 → `api.directDiscard(pid, id, { paths })`（需 confirm 弹窗）。
  - 暂存 → `api.directStash(pid, id, { message, paths })`。
  - 用独立 signal 控制进行中状态，不参与 `isAnyRunning()` 互斥。
- **Agent 智能判定**：
  - 走现有 `api.gitOp(pid, id, action)` → POST /git → Agent 执行。
  - 保持现有 `isAnyRunning()` 互斥与 SSE 流。

#### 4.6.5 Review 按钮调整

- 文案：`IDLE_LABEL.review` 改为 `'Review 变更'`。
- 添加 `title` 属性：`Review 下方变更文件，生成报告`。
- 当 `changes` 为空数组时 `disabled`。

### 4.7 互斥与状态管理

- **手动选择路径**（server 直接执行）：
  - 用独立 signal `directAction` 控制进行中状态。
  - 期间 disable 所有操作按钮（包括 Review）。
  - 不产生 `runId`，不参与 `isAnyRunning()` / `agentTasks` 逻辑。
  - 完成后自动刷新变更列表（SSE 会自动推送，无需手动刷新）。
- **Agent 智能判定路径**：
  - 保持现有 `isAnyRunning()` 互斥与 SSE 流。
- **Review**：保持现有 Agent runner + SSE 流逻辑不变。
- **SSE 变更列表**：页面挂载时建立 SSE 连接，卸载时断开；与 Agent run 的 SSE 独立。

### 4.8 变更列表状态标识映射

git status porcelain → 简洁标识：

| porcelain 值   | 标识 |
| -------------- | ---- |
| M (modified)   | `M`  |
| A (added)      | `A`  |
| D (deleted)    | `D`  |
| ?? (untracked) | `??` |
| R (renamed)    | `R`  |

### 4.9 左右并列布局重构（追加需求）

#### 4.9.1 DOM 结构调整

将 `<section class="page spec-review">` 内部重构为：

```
<section class="page spec-review">
  <header class="page-head detail-head">…</header>
  <div class="review-split">               ← 新增 flex 容器
    <section class="review-ops-panel">     ← 左：操作面板
      <section class="review-actions">     ← ① 按钮组（提交/丢弃/暂存/Review）
      </section>
      <textarea class="commit-message-input">  ← ② commit message（从 input 改为 textarea）
      </textarea>
      <div class="file-mode-group">…</div>     ← ③ radio（手动选择/Agent 智能判定）
      <div class="changes-list">…</div>        ← ④ checkbox 列表（flex 填充剩余高度）
      <p class="error">…</p>                   ← error 状态
      <p class="muted">…</p>                   ← lastRun 状态
    </section>
    <section class="review-body">          ← 右：review 报告
      <article class="markdown review-md" />
    </section>
  </div>
</section>
```

- 移除原有 `.review-commit-section` 和 `.review-file-section` section 包裹。
- 将 `.review-actions`、commit message、`.file-mode-group`、`.changes-list`、error/lastRun 全部归入 `.review-ops-panel`。
- `.review-body` 从 `.review-split` 的右侧渲染。

#### 4.9.2 CSS 样式

```css
/* 新增：左右并列容器 */
.spec-review .review-split {
  display: flex;
  gap: 1rem;
  flex: 1 1 auto;
  min-height: 0;
}

.spec-review .review-ops-panel {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.spec-review .review-body {
  flex: 1 1 0; /* 从 flex: 1 1 auto 改为 1 1 0，确保 50/50 */
  min-width: 0;
  overflow: auto;
}

/* commit message：从 input 改为 textarea */
.spec-review .commit-message-input {
  /* 移除 width: 100%（textarea 默认 block），保留其他样式 */
  resize: vertical;
  min-height: 3rem;
}

/* 变更文件列表：从固定 max-height 改为 flex 填充 */
.spec-review .changes-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  /* 移除 max-height: 260px */
}

/* 变更文件路径：从省略号改为折行 */
.spec-review .change-path {
  word-break: break-word;
  white-space: normal;
  /* 移除 overflow: hidden; text-overflow: ellipsis; white-space: nowrap */
}

/* 窄屏退化 */
@media (max-width: 960px) {
  .spec-review .review-split {
    flex-direction: column;
  }
}
```

#### 4.9.3 窄屏适配

窄屏（≤960px）时 `.review-split` 切换为 `flex-direction: column`，操作面板在上、review-body 在下，保持可用性。

### 4.10 textarea 动态高度（追加任务 [open] fix）

**目标：** git message textarea 需要跟随文字内容动态调整高度，不出现垂直滚动条。

**方案：** 引入 `autoResize` 函数 + textarea ref，在 input/mount/commitMessage 变化时自动计算高度：

```typescript
let commitMsgRef: HTMLTextAreaElement | undefined

function autoResize(el: HTMLTextAreaElement | undefined): void {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}
```

- textarea `ref={commitMsgRef}`，`onInput` 中调用 `autoResize(commitMsgRef)`。
- `createEffect(on(commitMessage, () => autoResize(commitMsgRef)))`：commitMessage 变化时自动调整（覆盖默认值注入、外部更新）。
- `onMount(() => autoResize(commitMsgRef))`：初始渲染后调整。
- CSS：`.commit-message-input` 设 `overflow-y: hidden`，移除 `resize: vertical`。

### 4.11 左右布局 4:6 比例（追加任务 [open] fix）

**目标：** 操作区与 review 文档区宽度比从 50:50 改为 4:6。

**方案：** CSS `flex-grow` 调整：

```css
.spec-review .review-ops-panel {
  flex: 4 1 0; /* 从 flex: 1 1 0 改为 4 */
}

.spec-review .review-body {
  flex: 6 1 0; /* 从 flex: 1 1 0 改为 6 */
}
```

窄屏 `@media (max-width: 960px)` 不受影响（已是 column 布局）。

### 4.12 textarea 默认值竞态修复（追加任务 [open] bug）

#### 根因

`defaultCommitMessage` memo 依赖 `spec()` 资源（通过 `api.getSpec` 异步加载）。组件挂载时 `spec()` 尚未 resolve（返回 `undefined`），导致 `spec()?.frontmatter.summary ?? ''` 为空字符串，memo 回退为 `${type}: update`。随后 `createEffect` 将该 fallback 值写入 `commitMessage` signal。

当 `spec()` 完成 resolve 后，memo 重新计算得到正确的 `${type}: ${summary}`，但 `createEffect` 的守卫条件 `!commitMessage()` 此时为 `false`（commitMessage 已被设置），导致正确值无法写入。

#### 修复方案

引入 `userEditedMsg` boolean signal 追踪用户是否手动编辑过 textarea：

```typescript
const [userEditedMsg, setUserEditedMsg] = createSignal(false)

createEffect(() => {
  const msg = defaultCommitMessage()
  if (msg && !userEditedMsg()) setCommitMessage(msg)
})
```

textarea 的 `onInput` 在更新 `commitMessage` 的同时标记 `userEditedMsg(true)`：

```typescript
onInput={(e) => {
  setUserEditedMsg(true)
  setCommitMessage(e.currentTarget.value)
}}
```

这样当 `spec()` 异步 resolve 后 memo 重算时，只要用户未手动编辑，就会用正确的默认值覆盖初始 fallback。

## 5. 待确认问题

_暂无_

## 6. 任务清单

- [x] `src/service/git.ts`：新增 `discard(cwd, opts)` 函数，执行 `git restore --staged --worktree` + `git clean -fd`，路径经 `assertSafeRelativePath` 校验（验收：函数可被路由调用，空 paths 抛 GitError）
- [x] `src/service/git.ts`：新增 `stash(cwd, opts)` 函数，执行 `git stash push -m "<message>" -- <paths>`，路径经 `assertSafeRelativePath` 校验（验收：函数可被路由调用，空 paths 抛 GitError）
- [x] `src/service/routes/spec-review.ts`：新增 `GET .../specs/:id/changes` 路由，调用 `listChanges(p.path)` 返回 `{ changes: GitChange[] }`（验收：curl 返回 JSON 变更列表）
- [x] `src/service/routes/spec-review.ts`：新增 `POST .../specs/:id/commit` 路由，调用 `commit(p.path, opts)` 返回 `{ commit }`，空 message/paths → 400（验收：curl 提交成功返回 SHA）
- [x] `src/service/routes/spec-review.ts`：新增 `POST .../specs/:id/discard` 路由，调用 `discard(p.path, opts)` 返回 `{ ok: true }`，空 paths → 400（验收：curl 丢弃成功）
- [x] `src/service/routes/spec-review.ts`：新增 `POST .../specs/:id/stash` 路由，调用 `stash(p.path, opts)` 返回 `{ ok: true }`，空 paths → 400（验收：curl 暂存成功）
- [x] `src/service/routes/events.ts`：新增 `GET .../specs/:id/changes/events` SSE 端点，连接即推一次 + 每秒轮询 `listChanges` 推送 `changes-updated` 事件（payload `GitChange[]`），挂载 heartbeat（验收：curl SSE 收到 changes-updated 事件）
- [x] `src/gui/src/lib/api.ts`：新增 `GitChange` 类型定义 + `getChanges`/`directCommit`/`directDiscard`/`directStash` 方法（验收：tsc 编译通过）
- [x] `src/gui/src/lib/sse.ts`：新增 `subscribeChanges(pid, id, onUpdate)` 函数，订阅 `.../changes/events`，监听 `changes-updated`（验收：tsc 编译通过）
- [x] `src/gui/src/pages/SpecReview.tsx`：重构按钮布局为 `[提交(primary)][丢弃][暂存]｜[Review 变更]`，Review 按钮文案改为"Review 变更" + title + changes 空时 disable（验收：页面渲染 4 按钮新布局）
- [x] `src/gui/src/pages/SpecReview.tsx`：新增 commit message 输入框，默认值 `${type}: ${summary}` 从 specId 推导（验收：输入框显示默认值可编辑）
- [x] `src/gui/src/pages/SpecReview.tsx`：新增文件选择 radio 组（手动选择/Agent 智能判定）+ checkbox 清单 + 全选/取消（验收：手动选择渲染清单，Agent 智能判定隐藏清单）
- [x] `src/gui/src/pages/SpecReview.tsx`：实现双路径操作逻辑——手动选择走 `api.directXxx`，Agent 智能判定走 `api.gitOp`，用 `directAction` signal 控制手动路径状态（验收：手动选择提交绕过 Agent，Agent 智能判定走 Agent）
- [x] `src/gui/src/pages/SpecReview.tsx`：挂载时 `subscribeChanges` 建立 SSE 连接，动态更新变更列表，卸载时断开（验收：变更文件后列表 1s 内更新）
- [x] CSS 样式：新增 commit message 输入框、文件选择 radio 组、checkbox 清单、按钮组分隔符样式（验收：页面布局美观无溢出）
- [x] 运行 `npm run build`（后端）+ `npm run build`（前端）验证编译通过（验收：无编译错误）
- [x] `src/gui/src/pages/SpecReview.tsx`：重构 DOM 为 `.review-split` 左右并列容器（左 `.review-ops-panel` + 右 `.review-body`），移除 `.review-commit-section` 和 `.review-file-section` 包裹，将按钮组移到左面板最前（验收：DOM 结构符合 4.9.1 节）
- [x] `src/gui/src/pages/SpecReview.tsx`：将 commit message 从 `<input type="text">` 改为 `<textarea>`，保留 `commitMessage` signal 绑定与 `defaultCommitMessage` 默认值逻辑（验收：textarea 渲染且默认显示 `${type}: ${summary}`）
- [x] `src/gui/src/styles.css`：新增 `.review-split`（flex 左右各 50%）+ `.review-ops-panel`（flex column）样式，更新 `.review-body` 为 `flex: 1 1 0`，新增窄屏 `@media (max-width:960px)` 退化（验收：左右并列布局生效）
- [x] `src/gui/src/styles.css`：更新 `.changes-list` 为 `flex: 1 1 auto; min-height: 0`（移除 `max-height: 260px`），更新 `.change-path` 为 `word-break: break-word; white-space: normal`（移除省略号），更新 `.commit-message-input` 适配 textarea（验收：列表填充剩余高度可滚动，路径折行）
- [x] 运行 `npx tsc --noEmit` + `npm run build`（前端）验证编译通过（验收：无编译错误）
- [x] `src/gui/src/pages/SpecReview.tsx`：新增 `userEditedMsg` signal，将 `createEffect` 守卫从 `!commitMessage()` 改为 `!userEditedMsg()`，textarea `onInput` 中 `setUserEditedMsg(true)`（验收：spec 加载后 textarea 显示正确的 `${type}: ${summary}` 默认值）
- [x] 运行 `npx tsc --noEmit` 验证编译通过（验收：无类型错误）
- [x] `src/gui/src/pages/SpecReview.tsx`：新增 `commitMsgRef` + `autoResize` 函数，textarea 添加 `ref` + `onInput` 调用 `autoResize`，新增 `createEffect(on(commitMessage, ...))` + `onMount` 触发动态高度调整（验收：textarea 无垂直滚动条，高度随内容自动调整）
- [x] `src/gui/src/styles.css`：`.commit-message-input` 设 `overflow-y: hidden`，移除 `resize: vertical`（验收：textarea 不显示垂直滚动条）
- [x] `src/gui/src/styles.css`：`.review-ops-panel` 从 `flex: 1 1 0` 改为 `flex: 4 1 0`，`.review-body` 从 `flex: 1 1 0` 改为 `flex: 6 1 0`（验收：操作区与 review 文档区宽度比为 4:6）
- [x] 运行 `npx tsc --noEmit` + `npm run build`（前端）验证编译通过（验收：无编译错误）

## 7. 追加任务

- [fixed] [fix] 2026-07-04 21:28:21 | 1. 操作区（操作按钮、变更文件等表单控件）应该跟review文档左右并列，各占50%的宽度
  - 描述：1. 操作区（操作按钮、变更文件等表单控件）应该跟review文档左右并列，各占50%的宽度

2. 左侧操作区的垂直排列顺序应该是：按钮、textarea（git message）、radio、checkbox （变更文件列表）；表单控件的内容结构不用变更，只需要调整顺序
3. git message textarea 期望默认带入 spec的summary, 格式 ：`${type}: ${summary}`
4. 变更文件列表容器，占据剩余的垂直高度，超过则允许滚动
5. 变更文件列表项是文件的path，超过宽度则按CSS默认折行

- [fixed] [fix] 2026-07-04 21:39:25 | review 页面 textarea 内容错误，请分析原因；
  - 描述：review 页面 textarea 内容错误，请分析原因；
    以 spec （yorz-6f1f9f/specs/260703.refct.review-commit-ui-refactor） 为例，summary: "重构 Review 页面：提交改为 primary 按钮并绕过 Agent 直接 git commit，新增 commit message 输入框与操作文件选择清单，Review 按钮重命名并增加禁用逻辑"
    实际 textarea 内容为：“refct: update“
    期望：“refct: 重构 Review 页面：提交改为 primary 按钮并绕过 Agent 直接 git commit，新增 commit message 输入框与操作文件选择清单，Review 按钮重命名并增加禁用逻辑”
    期望格式： `${type}: ${summary}`
- [fixed] [fix] 2026-07-04 22:37:23 | 1. git message 对应的 textarea 需要跟随文字内容动态调整高度，不要出现垂直滚动条
  - 描述：1. git message 对应的 textarea 需要跟随文字内容动态调整高度，不要出现垂直滚动条

2. 左右布局，操作区跟review文档区宽度比改成 4:6

## 8. 执行记录

### 8.1 git.ts 新增 discard + stash 函数

- 新增 `DiscardOptions` 和 `StashOptions` 接口。
- `discard()`: 执行 `git restore --staged --worktree` + `git clean -fd`，路径经 `assertSafeRelativePath` 校验。
- `stash()`: 执行 `git stash push -m "<message>"`，路径经 `assertSafeRelativePath` 校验。
- 验证：tsc --noEmit 通过。

### 8.2 spec-review.ts 新增 4 个路由

- `GET .../changes`: 调用 `listChanges(p.path)` 返回变更列表。
- `POST .../commit`: 调用 `gitCommit()` 返回 commit SHA，空 message/paths → 400。
- `POST .../discard`: 调用 `gitDiscard()` 返回 `{ ok: true }`，空 paths → 400。
- `POST .../stash`: 调用 `gitStash()` 返回 `{ ok: true }`，空 paths → 400。
- 所有路由复用 `need()` 辅助函数解析 project，并验证 spec 存在。
- GitError 统一映射为 400 响应。

### 8.3 events.ts 新增 SSE 变更文件列表端点

- `GET .../specs/:id/changes/events`: 连接即推一次 `changes-updated` 事件。
- 每秒轮询 `listChanges()`，通过 JSON.stringify 签名比对仅在变更时推送。
- 挂载 `attachHeartbeat` 保活。
- 验证：编译通过。

### 8.4 前端 api.ts 扩展

- 新增 `GitChange` 接口类型。
- 新增 `getChanges`、`directCommit`、`directDiscard`、`directStash` 方法。
- 验证：tsc --noEmit 通过。

### 8.5 前端 sse.ts 扩展

- 新增 `subscribeChanges(pid, id, onUpdate)` 函数。
- 监听 `changes-updated` 事件，解析 payload 并回调。
- 返回 `SseSubscription`（可取消 + readyState 探测）。
- 验证：tsc --noEmit 通过。

### 8.6 SpecReview.tsx 完整重构

- **按钮布局**：`[提交(primary)][丢弃(danger)][暂存]｜[Review 变更]`，用 `.actions-separator` 视觉分隔。
- **Commit message 输入框**：`.commit-message-input`，默认值从 specId 提取 type + frontmatter.summary 推导。
- **文件选择 radio 组**：手动选择（默认）/ Agent 智能判定。
- **Checkbox 清单**：带状态标识（M/A/D/??/R），全选/全部取消，显示已选/总数。
- **双路径操作逻辑**：手动选择 → `triggerDirect()` 走 `api.directXxx`（server 直接执行）；Agent 智能判定 → `triggerAgent()` 走 `api.gitOp`（Agent 执行）。
- **SSE 动态更新**：通过 `createEffect` + `subscribeChanges` 建立连接，每秒更新变更列表；`onCleanup` 自动断开。
- **互斥管理**：`isAnyRunning` 合并 Agent 路径（`busy`/`runningKind`）和手动路径（`directAction`）状态。
- **Review 按钮**：文案改为"Review 变更"，`title="Review 下方变更文件，生成报告"`，`changes` 为空时 disable。
- 验证：tsc --noEmit 通过 + vite build 通过。

### 8.7 CSS 样式

- 新增 commit message 输入框、文件选择 radio 组、changes-list（含 sticky head）、change-item（checkbox + 状态徽章 + 路径）样式。
- 状态徽章 5 种颜色映射：modified(黄)、added(绿)、deleted(红)、untracked(灰)、renamed(紫)。
- 按钮 separator 样式。
- 验证：vite build 通过。

### 8.8 构建验证

- `tsc --noEmit`：通过，无类型错误。
- `npm run build`（cli + gui）：通过，无编译错误。

### 8.9 左右并列布局重构（追加任务）

- **SpecReview.tsx DOM 重构**：
  - 新增 `.review-split` flex 容器，内含左 `.review-ops-panel`（操作面板）和右 `.review-body`（review 报告）。
  - 左面板内垂直顺序：`.review-actions`（按钮组）→ `.commit-message-input`（textarea）→ `.file-mode-group`（radio）→ `.changes-list`（checkbox 列表）→ error/lastRun 状态。
  - 移除原有 `.review-commit-section` 和 `.review-file-section` section 包裹。
- **commit message 改为 textarea**：`<input type="text">` → `<textarea rows={2}>`，保留 `commitMessage` signal 绑定与 `defaultCommitMessage` 默认值逻辑。
- **styles.css 新增样式**：
  - `.review-split`：`display: flex; gap: 1rem; flex: 1 1 auto; min-height: 0`。
  - `.review-ops-panel`：`flex: 1 1 0; display: flex; flex-direction: column`。
  - `.review-body`：从 `flex: 1 1 auto` 改为 `flex: 1 1 0`（确保 50/50）。
  - `.changes-list`：移除 `max-height: 260px`，改为 `flex: 1 1 auto; min-height: 0; overflow-y: auto`（填充剩余高度）。
  - `.change-path`：移除 `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`，改为 `word-break: break-word; white-space: normal`（折行）。
  - `.commit-message-input`：适配 textarea（`resize: vertical; min-height: 3rem; font-family: inherit`）。
  - 新增 `@media (max-width: 960px)` 窄屏退化（`.review-split` 切换为 `flex-direction: column`）。
- 验证：`tsc --noEmit` 通过 + `npm run build`（cli + gui）通过。

### 8.10 textarea 默认值竞态修复（追加任务）

- **根因**：`defaultCommitMessage` memo 依赖异步加载的 `spec()` 资源。组件挂载时 `spec()` 为 `undefined`，memo 返回 fallback `${type}: update`，`createEffect` 随即将其写入 `commitMessage`。`spec()` resolve 后 memo 重算为正确值，但 `createEffect` 守卫 `!commitMessage()` 已为 `false`，正确值无法写入。
- **修复**：新增 `userEditedMsg` signal 追踪用户手动编辑；`createEffect` 守卫改为 `!userEditedMsg()`；textarea `onInput` 中标记 `setUserEditedMsg(true)`。
- 验证：`tsc --noEmit` 通过，无类型错误。

### 8.11 textarea 动态高度 + 4:6 布局比（追加任务）

- **SpecReview.tsx textarea 动态高度**：
  - 新增 `commitMsgRef` 变量（`let commitMsgRef: HTMLTextAreaElement | undefined`）。
  - 新增 `autoResize(el)` 函数：`el.style.height = 'auto'; el.style.height = '${el.scrollHeight}px'`。
  - textarea 添加 `ref={commitMsgRef}`，`onInput` 中追加 `autoResize(commitMsgRef)` 调用。
  - 新增 `createEffect(on(commitMessage, () => autoResize(commitMsgRef)))`：commitMessage 变化时自动调整（覆盖默认值注入、外部更新）。
  - 新增 `onMount(() => autoResize(commitMsgRef))`：初始渲染后调整。
  - import 补充 `on`、`onMount`。
- **styles.css textarea 样式**：
  - `.commit-message-input`：`resize: vertical` → 移除；新增 `overflow-y: hidden`（隐藏垂直滚动条）。
- **styles.css 4:6 布局比例**：
  - `.review-ops-panel`：`flex: 1 1 0` → `flex: 4 1 0`。
  - `.review-body`：`flex: 1 1 0` → `flex: 6 1 0`。
  - 窄屏 `@media (max-width: 960px)` 不受影响（column 布局）。
- 验证：`tsc --noEmit` 通过 + `npm run build`（gui）通过，无编译错误。
