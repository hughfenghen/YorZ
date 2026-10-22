---
status: resolved
active:
updated_at: '2026-10-22 18:12:00'
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
