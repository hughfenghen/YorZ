---
status: resolved
active:
updated_at: '2026-10-04 15:55:10'
---

# Debug 活文档 · 移动端 Mermaid 图形查看器体验重构

## Debug 1 · 预览图形时单击可能无法关闭（点击穿透到页面重开）+ 移除右上角关闭 icon

- 状态：resolved
- 快照：619c4e717e1bfc77fead923cd0b7925924eba556
- 进入时间：'2026-10-04 15:52:35'

### 1.1 Bug 现象与复现

- 现象：预览 mermaid 图形时单击（tap）本应关闭预览，但点击事件会穿透到下方页面；若点击位置正好落在页面的某个图形（`.mermaid`）区域上，单次点击无法关闭预览（看起来是关掉后又立刻被重新打开）。
- 复现路径：
  1. 移动端进入 SpecDetail，正文含 mermaid 图形。
  2. 点击正文图形 → `onArticleClick` → `setDiagram(svg.outerHTML)` 打开 `MermaidViewer` 全屏预览。
  3. 在预览层「正对下方某个 `.mermaid` 图形」的位置单击。
  4. 预期：关闭预览。实际：关闭后又被重新打开，表现为关不掉。
- 附加需求：移除右上角的关闭 `X` icon。

### 1.2 关联链路分析

- `MermaidViewer.tsx:197 onTouchEnd`：识别 tap（未拖动 + <300ms + 单指抬起）后调用 `props.onClose()`，但**未 `e.preventDefault()`**。
- `SpecDetail.tsx:314 onArticleClick`：事件委托在正文容器上的 `click`（MouseEvent）监听，命中 `.mermaid` 即 `setDiagram(...)` 重新打开预览。
- touchend 绑定为 `{passive:false}`（`MermaidViewer.tsx:229`），具备 `preventDefault` 能力。

### 1.3 Debug 基线

- 快照 SHA：`619c4e717e1bfc77fead923cd0b7925924eba556`
- 进入时间：'2026-10-04 15:52:35'
- `git diff 619c4e71` 为退出闸门基准。

### 1.4 假设看板

- H1（成立）：touchend tap 分支缺少 `e.preventDefault()`，导致浏览器在同坐标派发合成 `click`，穿透到下方页面的 `.mermaid` 触发 `onArticleClick` 重开预览。
  - 若成立：在 touchend tap 分支加 `e.preventDefault()`（+ 关闭后短暂抑制）即可单击稳定关闭、不再重开。
  - 若不成立：加了仍会重开 → 需查其它穿透途径（如 overlay 未在 click 前移除）。
  - 证据：代码级确认——`onTouchEnd` 无 `preventDefault`；`onArticleClick` 是 `click` 监听；合成 click 为浏览器标准行为（touchend 不 preventDefault 时在 ~300ms 后派发 mouse 系列事件）。假设成立。

### 1.5 证据

- `MermaidViewer.tsx:197-217` onTouchEnd 全程无 `e.preventDefault()`；仅 `onTouchMove` 有。
- `SpecDetail.tsx:314-320` onArticleClick 为 MouseEvent/click 委托监听，命中 `.mermaid` 重开。

### 1.6 脚手架清单

- 无（本次为直接定位到根因的代码修复，未引入临时短路/Mock/日志/临时页面）。

### 1.7 收尾核对

- 修复：
  1. `MermaidViewer.tsx:onTouchEnd` tap 分支在 `props.onClose()` 前加 `e.preventDefault()`（并置 `mode='none'`），抑制浏览器合成 click 穿透到下方页面重开预览。touchend 以 `{passive:false}` 绑定，preventDefault 生效。
  2. 移除右上角关闭 `X` 按钮及其 `X` 导入；控件层仅保留横屏切换按钮。关闭改为单击图形（tap）即可。
- 退出闸门：`git diff 619c4e71 -- MermaidViewer.tsx` 仅两处合法修复，无脚手架残留（本次未引入临时短路/Mock/日志/临时页面）。
- 完整性检查：`npm run typecheck`（tsc -b）通过无错误；`npm run build:gui-mobile` 构建成功（仅既有 chunk 体积告警）。
- 剩余人工项：真机触屏回归——对着下方正好是 `.mermaid` 的位置单击，确认单次点击即关闭且不再重开（代码级根因已锁定，属标准合成 click 行为，留用户真机确认手感）。
- 状态：resolved。
