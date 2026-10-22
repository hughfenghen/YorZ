---
status: resolved
active:
updated_at: '2026-10-22 20:18:30'
---

# Debug 活文档 · git-branch-panel-enhancements

## Debug 1 · 分支过滤输入框中的 close icon 遮挡「创建」按钮

- 状态：resolved
- 快照：45be4edaad3d70531343375542edb5431eb49f56
- 进入时间：'2026-10-22 18:05:00'

### 1.1 Bug 现象与复现

- 现象：展开「切换分支」Popover，输入 ≥3 字符后右侧出现「创建」按钮，但面板右上角的关闭(X)图标与「创建」按钮位置重叠，视觉上遮挡/挤占了「创建」按钮。
- 复现路径（布局推断）：GitPanel 分支 Popover 展开 → 输入分支名 ≥3 字符 → 「创建」按钮出现在顶部输入行右端 → 面板右上角 close X 覆盖其上。

### 1.2 关联链路分析

- 分支 Popover：`src/gui/src/components/GitPanel.tsx:495-590`，`PopoverContent class="w-72 p-0"`。
- 顶部输入行 `:535-559`：`<Input flex-1>` + `<Show when={canCreateBranch()}>` 的「创建」`<Button shrink-0 px-2>`，按钮贴右端。
- 共享 `PopoverContent`：`src/gui/src/components/ui/popover.tsx`，**无条件**渲染 `PopoverPrimitive.CloseButton`，定位 `absolute right-4 top-4`（右 16px、上 16px，h-4 w-4 的 X svg）。

### 1.3 Debug 基线

- 快照 SHA：`45be4edaad3d70531343375542edb5431eb49f56`（`git stash create`）；进入时间 `2026-10-22 18:05:00`。
- 退出闸门基准：`git diff 45be4edaad3d70531343375542edb5431eb49f56`。

### 1.4 假设看板

- [坐实] 「close icon」= 共享 PopoverContent 的 `PopoverPrimitive.CloseButton`（右上角 X）。
  - 证据：popover.tsx 中该 CloseButton 绝对定位 `right-4 top-4`；分支 Popover 顶部输入行把「创建」按钮放在右端（`p-1` 容器内，按钮右边距 ~4px），X 右边距 16px、宽 16px，横向落在按钮左侧区域、纵向与按钮重叠 → 遮挡成立。
  - GitPanel 未从 lucide 引入任何 X/Cross 图标（`:11` 仅 GitBranch/GitMerge/Loader2），Input 为纯 `type=text`（input.tsx 无 clear），排除「原生清除按钮/自绘图标」来源。

### 1.5 证据

- `src/gui/src/components/ui/popover.tsx`：`PopoverContent` 末尾固定渲染 `<PopoverPrimitive.CloseButton class="absolute right-4 top-4 ...">`（含 M18 6L6 18 的 X path）。
- 该组件被多处复用（QrPairingPopover / AnnotatePopover / GitPanel 的切换与合并两个 Popover），不能全局移除；需按实例关闭。

### 1.6 脚手架清单

- 无临时脚手架（纯定位层修复）。

### 1.7 收尾核对

- 修复：共享 `PopoverContent` 新增可选 `hideCloseButton` prop（`<Show when={!local.hideCloseButton}>` 包裹 CloseButton，默认行为不变）；分支 Popover `PopoverContent` 传 `hideCloseButton`，关闭右上角 X。合并 Popover 及其它复用处未动。
- `git diff 45be4edaad...` 仅剩两文件合法修复（GitPanel.tsx + ui/popover.tsx），无脚手架残留。
- `pnpm run typecheck` 通过；`pnpm run build:gui` 构建成功。

## Debug 2 · 展开分支面板 fetch 完成时整个 git 页面闪烁一次

- 状态：resolved
- 快照：55a96287559a3aa68c1089ec0d6120bf15c59391
- 进入时间：'2026-10-22 20:16:16'

### 2.1 Bug 现象与复现

- 现象：在 spec Review（git）页展开「切换分支」Popover，自动触发 `git fetch`；fetch 完成的一瞬间，整个 git 页面（header + GitPanel）闪烁了一次。
- 复现路径：进入 `SpecReview` 页（`/projects/:id/specs/:specId/git` 一类，GitPanel 带 specId 上下文）→ 点击分支下拉触发器展开 Popover → `onOpenChange(open=true)` 首开自动 `triggerBranchFetch()` → fetch 完成回调 `await refetchBranches()` → 整页闪一下。
- 差异观察：独立 GitStatus 页（`GitStatus.tsx`，GitPanel 不被 `<Suspense>` 包裹）不会闪；仅 SpecReview 页（`SpecReview.tsx:32-56` 用 `<Suspense>` 包住 GitPanel）会闪 → 指向 Suspense 重新挂起。

### 2.2 关联链路分析

- `GitPanel.tsx:129-132`：`branchState = createResource(props.projectId, getGitBranches)`。
- `GitPanel.tsx:398-409` `triggerBranchFetch`：`gitFetch` 成功后 `await refetchBranches()`（同源 refetch，非换 key）。
- `SpecReview.tsx:30-57`：`<section><Suspense fallback=loading>…<GitPanel/>…</Suspense></section>` —— GitPanel 整体在 Suspense 内。
- GitPanel 内对 `branchState()` 的受跟踪读取（`checkoutCandidates`/`mergeCandidates` memo、触发器 `branchState()?.current` 等）都位于该 Suspense 边界内。

### 2.3 Debug 基线

- 快照 SHA：`55a96287559a3aa68c1089ec0d6120bf15c59391`（`git stash create`）；进入时间 `2026-10-22 20:16:16`。
- 退出闸门基准：`git diff 55a96287559a3aa68c1089ec0d6120bf15c59391`。

### 2.4 假设看板

- [坐实] 根因 = Suspense 内 `createResource` 的 refetch 会重新挂起 Suspense，整页瞬显 fallback 造成闪烁。
  - 可证伪判据：若成立，则 refetch 期间 Suspense 计数器被 `increment` → 显示 fallback；在 Transition 下执行则不 increment、不闪。
  - 硬证据（Solid 源码 `node_modules/solid-js/dist/solid.cjs@1.9.13`）：
    - `load()`（:338-378）refetch 时 `pr = p`（pending promise），`setState(resolved ? 'refreshing' : 'pending')` 后 `trigger()` 重算受跟踪读取。
    - `read()`（:320-337）受 Suspense `c` 跟踪的读取：`if (pr) { if (c.resolved && Transition && loadedUnderTransition) Transition.promises.add(pr); else if(!contexts.has(c)){ c.increment(); contexts.add(c) } }` —— 非 Transition 情况下走 `c.increment()` → Suspense 显示 fallback → 整页闪；Transition 下改走 `Transition.promises.add(pr)` → 不挂起、不闪。
  - 旁证：本仓 `SpecDetail.tsx:140-145` 明确注释「Refresh inside a transition so the resource refetch does NOT re-suspend <Suspense>」，用 `startTransition` 规避同一机制。
- [排除] 「git fetch 触发工作区 changes 的 SSE 推送导致列表重渲染」。
  - 依据：`events-hub.ts:76-98` changes watcher 轮询 `listChanges`（工作区状态），只在签名变化才推；`git fetch --prune` 只动 remote-tracking refs，不改工作区状态 → 不会推送。且 `watcher.ts` 只监听 spec.md，不监听 .git。

### 2.5 证据

- 见 2.4：Solid 1.9.13 `read()`/`load()` 源码路径 + SpecDetail 旁证。链路唯一收敛：`triggerBranchFetch` 的 `refetchBranches()` 在 SpecReview 的 Suspense 内 refetch → 重新挂起 → 整页闪。

### 2.6 脚手架清单

- 无临时脚手架（纯修复：为 refetch 包裹 `startTransition`）。

### 2.7 收尾核对

- 修复：`GitPanel.tsx` 从 solid-js 引入 `startTransition`；将 `refetchBranches()` 的调用（`triggerBranchFetch` 等）改为 `await startTransition(() => refetchBranches())`，使 refetch 在 Transition 下执行，Suspense 不再重新挂起 → 消除整页闪烁。
- 退出闸门：`git diff 55a96287559a3aa68c1089ec0d6120bf15c59391` 仅剩 GitPanel.tsx 合法修复，无脚手架残留。
- 验证：`pnpm run typecheck`、`pnpm run build:gui` 通过。
