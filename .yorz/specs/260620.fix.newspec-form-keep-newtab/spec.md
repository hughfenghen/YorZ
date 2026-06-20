---
stage: execute
last_action: 完成全部任务并通过类型检查
updated_at: 2026-06-20
summary: 修复新建 spec 页提交后表单卸载导致输入丢失，以及顶栏「新建 spec」按钮在当前页无反馈两个交互问题。
---

# 260620.fix.newspec-form-keep-newtab

## 1. 背景

YorZ GUI 的「新建 spec」流程目前依赖 Agent 异步创建文档。用户在提交后会进入 `creating` 阶段，等待 Agent 落地文档并自动跳转。最近反馈出现两个交互体验问题：

- 提交后表单被整体卸载，一旦 Agent 失败，用户需要从头重新填写需求。
- 用户在新建页继续点击顶栏「＋ 新建 spec」按钮无任何反馈，无法快速发起多个 spec 的并行创建。

两者都影响新建 spec 的核心流程稳定性，需要尽快修复。

## 2. 需求

- 需求 1：新建 spec 表单提交后不再卸载/隐藏 `form` 元素；改为对提交按钮（必要时含输入项）置 `disabled`，确保 Agent 失败时输入内容保留，用户可继续修改后重试。
- 需求 2：顶栏右上角「＋ 新建 spec」按钮在用户已经位于新建 spec 页时点击应「新开浏览器标签页」打开新建 spec 页面，而不是无反馈；其他页面下点击保持原有同窗口跳转行为。

## 3. 现状分析

### 3.1 文件与组件

- `src/gui/src/pages/NewSpec.tsx`：新建 spec 页主体，管理 `content / type / phase / error` 状态，提交后通过 `<Show>` 切换表单与运行态。
- `src/gui/src/AppShell.tsx`：全局壳层，顶栏使用 `<A href="/specs/new" class="primary-action">` 渲染「＋ 新建 spec」按钮。
- `src/gui/src/pages/Home.tsx`：首页空态也提供「＋ 新建第一个 spec」入口，使用同款 `<A>` 路由跳转。
- `src/gui/src/lib/agent-tasks.ts` 与 `src/gui/src/components/AgentPanelDock.tsx`：负责 Agent 运行任务的全局面板与流式输出，跨页面持久存在。

### 3.2 问题 1：表单卸载导致输入丢失

`NewSpec.tsx:99` 使用 `<Show when={phase() === 'idle' || phase() === 'failed'}>` 包裹整张表单；SolidJS `<Show>` 在条件 `false` 时会真实卸载子节点。当用户点击「创建并启动 Agent」后：

1. `submit()` 把 `phase` 改为 `creating`，表单 DOM 立即被卸载。
2. 失败路径（`catch`）中 `setPhase('failed')` 后表单重新挂载，但因为 `createSignal` 状态仍在组件实例里，文本内容理论上恢复。
3. **真实丢失场景**在于：失败发生在 Agent 端而非接口端（例如 SSE 后续推送失败、轮询超时、用户切换页面/刷新后回退）；这些情况下 `phase` 不会回到 `failed`，而是停留在 `creating` 或导致用户主动后退/刷新，从而丢失输入。
4. 另外当前 `phase === 'creating'` 下没有任何「返回编辑」入口，用户即使在 Agent 出错后也无路径回到原始输入。

### 3.3 问题 2：新建页顶栏按钮无反馈

`AppShell.tsx:17` 使用 SolidJS Router 的 `<A href="/specs/new">`，在已位于 `/specs/new` 时点击不会触发任何导航动作；浏览器无 anchor 跳转、SPA 也没有路由变化，用户感知为「无效」。

期望行为是「仅在已位于新建 spec 页时新开浏览器标签页打开新建 spec 页」，对应到实现层是：根据当前路由判断使用原生 `<a target="_blank" rel="noopener noreferrer">` 还是默认的 `<A>` 同窗口跳转。

### 3.4 隐含约束

- 顶栏按钮在「非新建页」保持原有同窗口跳转行为，避免改变现有交互习惯。
- Home 空态入口（`Home.tsx:22`）保持同窗口跳转，无需调整。
- `creating` 状态下不提供「取消」入口；用户可通过右下角 Agent 任务面板中断任务，无需在表单内冗余按钮。
- `creating` 阶段表单常驻时必须防止重复提交，避免重复创建多份 spec / 重复启动 Agent。

## 4. 技术实现方案

### 4.1 问题 1：保持表单挂载，仅 disable 提交相关元素

- 移除 `NewSpec.tsx` 中 `<Show when={phase() === 'idle' || phase() === 'failed'}>` 对表单的包裹，让 `<form>` 始终挂载，输入信号与 DOM 状态在整个生命周期都被保留。
- 增加 `const busy = () => phase() === 'creating'` 派生信号，对以下元素施加 `disabled={busy()}`：
  - 类型单选按钮 `input[type=radio]`
  - 需求 `textarea`
  - 提交 `<button>`（按钮文案在 `busy()` 时显示「Agent 创建中…」）
- 保留原有 `phase === 'creating'` 提示文案：把它从原本「替换表单」的 `<Show>` 改成「附加在表单下方」的提示条，避免用户误以为无任何反馈。
- `phase === 'failed'` 路径不再需要重新挂载表单，原有 `setPhase('failed')` 后输入自然保留；同时确保 `error()` 区域可见。
- 因为表单常驻，需要防止 `busy()` 时表单被重复提交：
  - `submit()` 起始处加 `if (phase() === 'creating') return`。
  - 按钮 `disabled={busy()}` 已是浏览器层保护，逻辑层再加一道。

### 4.2 问题 2：顶栏新建按钮在新建页改为新标签页打开

- 在 `AppShell.tsx` 中通过 `useLocation()`（`@solidjs/router`）读取当前路径。
- 顶栏「＋ 新建 spec」按钮根据 `location.pathname === '/specs/new'` 切换渲染：
  - 已位于新建 spec 页：使用原生 `<a href="/specs/new" target="_blank" rel="noopener noreferrer" class="primary-action">`，触发浏览器原生新标签页打开；`rel="noopener noreferrer"` 避免新标签页获得 opener 引用。
  - 其他页面：保留现有 `<A href="/specs/new" class="primary-action">`，维持 SPA 同窗口跳转。
- Home 空态入口（`Home.tsx:22`）不修改，保持原有同窗口跳转。

### 4.3 边界与回归

- 在 `/specs/new` 顶栏新按钮点击 → 新标签页打开 → 旧标签输入内容不受影响。
- 旧标签若已经处于 `creating` 状态，新标签独立创建一份 spec，互不干扰（受 `agentTasks` 全局面板影响有限：每个 spec 创建会注册不同 `runId`）。
- 失败路径回归：模拟 `api.createSpec` 抛错，验证 `phase` 回到 `failed`、输入仍在、错误提示展示、可重新提交。
- `creating` 阶段重复点击提交按钮不会触发新的请求。

## 5. 待确认问题

- 暂无

## 6. 任务清单

- [x] 修改 `src/gui/src/pages/NewSpec.tsx`：移除外层 `<Show>` 包裹让 `<form>` 常驻；新增 `busy` 派生信号；对类型 radio、textarea、提交按钮统一 `disabled={busy()}`；按钮文案在 busy 时显示「Agent 创建中…」；`submit()` 起始处守卫重复提交；`creating` 提示条改为附加在表单下方
- [x] 修改 `src/gui/src/AppShell.tsx`：引入 `useLocation`，根据 `location.pathname === '/specs/new'` 在原生 `<a target="_blank" rel="noopener noreferrer">` 与 `<A>` 之间切换渲染顶栏「＋ 新建 spec」按钮
- [x] 验证：运行 `pnpm --filter @yorz/gui typecheck`（或仓库等价命令）确保改动通过类型检查；若仓库未提供，则在执行记录中说明并跳过

## 7. 执行记录

- 任务 1：重写 `src/gui/src/pages/NewSpec.tsx`。移除 `<Show>` 外层包裹，`<form>` 现常驻挂载；新增 `busy` 派生信号，对 `<fieldset class="type-group">`（兜底）、类型 radio、需求 textarea、提交按钮统一 `disabled={busy()}`；按钮文案在 busy 时切换为「Agent 创建中…」；`submit()` 起始处加入 `if (phase() === 'creating') return` 防重复提交；原 `creating` 提示文案从独立 `<Show>` 段落迁移为表单底部 `<p class="muted">`，仅在 busy 时显示。不再 import `Show`。
- 任务 2：修改 `src/gui/src/AppShell.tsx`。新增 `useLocation` 引入与 `onNewSpecPage` 派生信号；顶栏按钮通过 `<Show>` 在「位于 `/specs/new`」时渲染原生 `<a target="_blank" rel="noopener noreferrer">`，其他页面 fallback 至原 `<A href="/specs/new">`。
- 任务 3：在仓库根目录执行 `npx tsc --noEmit`，无错误输出（项目 tsconfig 同时覆盖 CLI 与 GUI），改动通过类型检查；`npx prettier --write` 对 spec md 无格式变更。
