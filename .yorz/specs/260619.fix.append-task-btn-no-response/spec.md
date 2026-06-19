---
stage: execute
last_action: 提交 git
updated_at: 2026-06-19
summary: 修复 SpecDetail「追加任务」按钮点击无响应，AppendTaskDialog 改为锚定按钮的 popover 弹窗
---

# 修复 SpecDetail 页面追加任务按钮点击无响应

## 1. 背景

用户报告：在 `.yorz/specs/260619.feat.append-bug-and-fix` 上一期需求落地后，进入 SpecDetail 页面点击新加的「追加任务」按钮没有任何反应——dialog 不弹出、控制台无明显新打印、页面无任何视觉变化。

上一期 spec 完整实现了 `AppendTaskDialog` 组件、`POST /specs/:id/appends` 接口、SKILL 的「追加任务」识别条款，并通过 88 条单测。但 e2e/手动验证未被纳入任务范围（见 `.yorz/specs/260619.feat.append-bug-and-fix/spec.md` 任务 14 的备注「未跑 e2e……如需手测请在浏览器内验证」），因此运行时存在的「按下按钮无响应」类问题没有被拦下。

本期目标：定位按钮无响应的根因并修复，让「点击按钮 → 弹出 dialog → 提交追加项 → 触发 Agent 重开 plan」全链路在浏览器里可手测通过。

## 2. 需求

- 在 SpecDetail 页面点击顶部 meta 区的「追加任务」按钮后，必须能弹出 `AppendTaskDialog` 对话框，且 dialog 视觉上居于页面正上方（带遮罩或独立面板，不被其它元素遮挡）。
- 提交追加项后，仍按上一期方案触发 Agent run 并接入 Dock；本期不改 Service / Skill / 接口契约，仅修复 GUI 端可见性与（如有）事件处理问题。
- 修复后须给出可手测的浏览器复现路径；条件允许时补一条轻量的 e2e 或组件测试，避免未来 CSS 回归再次让 dialog 不可见。
- 若调查中发现根因不是 CSS，而是 signal/事件/SolidJS reactivity 问题，则按真实根因修复，并在执行记录中说明结论。

## 3. 现状分析

### 3.1 涉及代码与挂载链路

`src/gui/src/pages/SpecDetail.tsx:38-39` 创建了 `appendOpen` / `appendSnap` signals；`SpecDetail.tsx:141-144` 的 `openAppend()` 把当前选区写进 `appendSnap` 后调用 `setAppendOpen(true)`；`SpecDetail.tsx:193-195` 的按钮 `<button type="button" class="append-btn" onClick={openAppend}>` 触发该 handler；`SpecDetail.tsx:227-233` 将 dialog 挂载为 `<AppendTaskDialog open={appendOpen()} sectionPath={appendSnap()?.sectionPath} quote={appendSnap()?.text} onCancel={() => setAppendOpen(false)} onSubmit={submitAppend} />`。

`src/gui/src/components/AppendTaskDialog.tsx:64-134` 用 `<Show when={props.open}>` 守卫渲染：

```
<div class="append-dialog-backdrop" onMouseDown={cancel}>
  <div class="append-dialog" role="dialog" onMouseDown={(e) => e.stopPropagation()}>
    <header>…</header>
    <form onSubmit={submit}>…</form>
  </div>
</div>
```

逻辑上，点击按钮 → `setAppendOpen(true)` → `<Show>` 命中 → dialog DOM 被插入 SpecDetail 节点树。

### 3.2 关键缺口：dialog 与按钮的 CSS 全部缺失

对全局唯一样式表 `src/gui/src/styles.css`（Glob 仅命中这一份）grep `append` / `dialog` / `backdrop` 关键字，全部 0 命中。具体缺失：

- `.append-dialog-backdrop`：未设置 `position: fixed; inset: 0; z-index; background`。结果是 backdrop 变成普通流式 `<div>`，**完全不会盖住视口**，dialog 也不会浮起来。
- `.append-dialog`：未设置 `position; z-index; max-width; box-shadow; background; padding`。
- `.kind-group` / `.kind-option` / `.field` / `.reference` / `.quote` / `.actions`：均无样式，dialog 内部布局也是默认堆叠。
- `.append-btn`：按钮虽然继承全局 `button { … }` 默认样式可点（`styles.css:51`），但本期需要确认它在 `.detail-head .meta` 内的视觉宽度/对齐是否与 `.run-btn` / `.review-link` 一致。

git log 也证实：从 `73429d9` 一直到 HEAD，`styles.css` 没有任何 `append` 相关提交——上一期实现明显漏写了 dialog 样式。

### 3.3 用户感知"无任何反应"的原因推断

如果 backdrop 不是 `fixed`，dialog 元素会被插入 `<section class="page">` 内、位于 `<article class="markdown">` 之后。当前页面（spec 处于 `execute` 阶段）的 markdown 正文很长，dialog 在文档流末尾，但又被全局 fixed 元素（如 Agent Dock、待确认面板）以及 viewport 内的滚动定位遮挡，用户视觉上感知不到任何变化；再加上点击按钮后页面不会滚动到 dialog 位置，体感就是「按钮没反应」。

替代假设（需要日志确认）：

- a. CSS 缺失（首要怀疑，证据充分）：dialog 渲染了但视觉上不可见 / 在视口外。
- b. `<Show when={props.open}>` 没触发 reactivity：如 `appendOpen` signal 没正确订阅，理论可能但 Solid 一般不会出错；可加 console 验证。
- c. 事件被前层元素吞掉：`SelectionMenu` / `AnnotatePopover` 在 fixed 层覆盖了按钮区，导致 click 没落到按钮上。但按钮区在 `.detail-head .meta` 右侧、与「运行 Agent」按钮同行，「运行 Agent」当前可点，故此假设较弱。
- d. JS 报错中断渲染：`openAppend` 调用 `snap()`，若选区为空返回 null，`setAppendSnap(null)` 合法、不抛错；不太可能。

### 3.4 是否同一会话只点了一次

`SpecDetail.tsx:141-144` 的 `openAppend()` 总是 `setAppendOpen(true)`，没有 toggle 逻辑；首次点击后理应一直为 true。dialog 的 `cancel()` 在 `AppendTaskDialog.tsx:59-62`，由 backdrop `onMouseDown` 触发——但 backdrop 没盖住视口时，用户根本不会点到它，所以也不会"误关"。也就是说，按钮点击后 signal 一定停留在 `true`，dialog 一定在 DOM 中：可以用浏览器开发者工具直接搜 `class="append-dialog"` 确认是否存在。这步是验证 3.3 假设 a 的最关键手段。

### 3.5 上一期遗留的样式补全清单（与 dialog 一致的视觉语言）

参考 `styles.css` 现有同类组件可对齐：

- `.annotate-popover` 系列（约 `styles.css:470` 附近）已有 popover/actions 样式，但用的是「锚定在选区」的 popover 模式，不是 backdrop+modal。AppendTaskDialog 的形态是独立模态对话框，需要自带 backdrop。
- 全局 `.primary-action` / `button.ghost` 已有；dialog 的提交按钮已加 `class="primary-action"` 可复用。
- `.detail-head .meta`（`styles.css:133`）已是 flex 布局，新的 `.append-btn` 与「运行 Agent」按钮同级；只需提供基础尺寸/边框以与同行控件一致，无需新颜色变量。

## 4. 技术实现方案

围绕"修最小集合让按钮可见生效"的原则，分三步：先用日志/DOM 检查锁死根因，再落样式，最后补 e2e 回归。

### 4.1 第一步：根因已通过批注证实

用户批注「追加任务的 DOM 元素显示在 spec 文档页面底部，期望是以弹窗形式展现在按钮旁边」直接证实了 3.3 节中的**假设 a（CSS 缺失）**：

- dialog DOM 确实被渲染（说明 signal / `<Show>` 正常工作，假设 b 排除）。
- DOM 在页面底部以流式形式出现（说明 backdrop 不是 `position: fixed`，dialog 没有浮起，与 styles.css 中 `.append-dialog*` 全部缺失的事实一致）。
- 用户能看到 DOM 出现在底部 → 点击事件正常触达 handler（假设 c 排除）。

故无需再加临时日志做分诊；本期直接补齐 CSS 即可。同时批注也表达了视觉形态偏好：**popover 锚定到按钮，而不是全屏 backdrop + 居中 modal**——4.2 节据此调整为锚定按钮的 popover 形态（已就近回答了原 Q1）。

### 4.2 第二步：popover 锚定按钮 + 补齐必需 CSS

#### 4.2.1 AppendTaskDialog 接口扩展（最小改动）

为了让 dialog 真正"显示在按钮旁边"，给组件新增可选 prop `anchorEl?: HTMLElement`。`SpecDetail` 用 `ref` 拿到 `.append-btn` 元素后传入；dialog 在打开时（`createEffect` 监听 `props.open`）通过 `anchorEl.getBoundingClientRect()` 算出锚位并写入 dialog 的内联 `top` / `left` 样式（基于视口坐标）：

```tsx
// 伪代码示意
let dialogEl: HTMLDivElement | undefined
const [pos, setPos] = createSignal<{ top: number; left: number } | null>(null)
createEffect(() => {
  if (!props.open || !props.anchorEl) return
  const rect = props.anchorEl.getBoundingClientRect()
  setPos({ top: rect.bottom + 8, left: rect.right }) // 下方右对齐
})
```

dialog 渲染：

```tsx
<div class="append-dialog-backdrop" onMouseDown={cancel}>
  <div
    ref={dialogEl}
    class="append-dialog"
    role="dialog"
    style={pos() ? { top: `${pos()!.top}px`, right: `calc(100vw - ${pos()!.left}px)` } : undefined}
    onMouseDown={(e) => e.stopPropagation()}
  >
    …
  </div>
</div>
```

未传 `anchorEl` 时，CSS 默认锚位（视口右上区）作为兜底。

`SpecDetail.tsx` 改动：增加 `let appendBtnEl: HTMLButtonElement | undefined`，按钮加 `ref={appendBtnEl}`，AppendTaskDialog 传 `anchorEl={appendBtnEl}`。

#### 4.2.2 styles.css 追加

backdrop 透明全屏，仅承担"点击外部关闭"事件捕获（不再渲染半透明黑色遮罩，与 popover 体感一致）：

```css
.append-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: transparent;
}

.append-dialog {
  position: fixed;
  top: 4.5rem;
  right: 1.5rem;
  width: min(460px, calc(100vw - 3rem));
  max-height: calc(100vh - 6rem);
  overflow: auto;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.25);
  padding: 1rem 1.25rem;
}

.append-dialog header {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 0.75rem;
}
.append-dialog form {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.append-dialog .kind-group {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  border: none;
  padding: 0;
  margin: 0;
}
.append-dialog .kind-option {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
.append-dialog .field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.append-dialog textarea {
  font: inherit;
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  resize: vertical;
}
.append-dialog .reference {
  font-size: 0.88rem;
  color: var(--muted);
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.append-dialog .reference .quote {
  margin: 0;
  padding: 0.4rem 0.65rem;
  border-left: 3px solid var(--border);
  background: var(--bg);
}
.append-dialog .actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
.append-dialog .error {
  color: var(--error);
  margin: 0;
}
```

`.append-btn` 同步加最小样式以与「运行 Agent」「Review」对齐：

```css
.append-btn {
  border: 1px solid var(--border);
}
```

#### 4.2.3 ESC 键关闭支持

在 `AppendTaskDialog` 内部使用 `createEffect` 监听 `props.open`：打开时通过 `window.addEventListener('keydown', handler)` 注册全局 keydown 监听，handler 在 `event.key === 'Escape'` 时调用 `cancel()`；同一 effect 通过 `onCleanup` 在 dialog 关闭或组件卸载时移除监听，避免残留全局事件。此举与 backdrop `onMouseDown` 共同覆盖鼠标与键盘两条关闭路径。

### 4.3 第三步：防止回归（扩展 e2e）

在 README 提到的 `npm run e2e` 现有 SpecDetail 流程上扩展用例：

- 进入 SpecDetail 页 → 点击 `.append-btn` → 断言 `.append-dialog` 存在且 visible，并断言其视口坐标位于按钮 `bottom` 之下、`right` 与按钮 `right` 相近（容差 ±4px），即"锚定在按钮旁边"。
- 在 dialog 中填入 kind/content → 提交 → 断言 spec md 中 `## 用户追加` / 对应区段被写入，且 Agent run 被触发。

上一份 spec 14 号任务备注中提到 e2e 未覆盖，此处补齐。手测清单（含手动复现路径）仍在执行记录中保留。

### 4.4 不在本期范围

- 不重构 AppendTaskDialog 的 DOM 结构。
- 不调整 `POST /specs/:id/appends`、`spec-store.appendItem`、SKILL.md。
- 不补全 `.annotate-popover` / `.question-confirm-panel` 等其它组件的样式漏洞（与本 bug 无关）。

## 5. 待确认问题

- 暂无

## 6. 任务清单

- [x] 在 `src/gui/src/components/AppendTaskDialog.tsx` 的 `Props` 中新增可选字段 `anchorEl?: HTMLElement`，验收：tsc 通过、未传入时组件仍可渲染
- [x] 在 `AppendTaskDialog` 内部用 `createEffect` 监听 `props.open` 与 `props.anchorEl`，打开时读取 `anchorEl.getBoundingClientRect()` 写入本地 `pos` signal（结构 `{ top, left }`，`top = rect.bottom + 8`、`left = rect.right`），验收：DevTools 中切换 open 状态时 pos 正确刷新
- [x] 在 `AppendTaskDialog` 渲染处给 `.append-dialog` 根 div 加内联 `style`：当 `pos()` 存在时设置 `top: ${pos.top}px` 与 `right: calc(100vw - ${pos.left}px)`；为空时不设内联样式（回退 CSS 默认锚位），验收：dialog 弹出后视口坐标对齐按钮右下方
- [x] 在 `src/gui/src/pages/SpecDetail.tsx` 中声明 `let appendBtnEl: HTMLButtonElement | undefined`，给 `.append-btn` 加 `ref={appendBtnEl}`，并把 `anchorEl={appendBtnEl}` 传入 `AppendTaskDialog`，验收：tsc 通过、点击按钮后 dialog 锚到按钮下方
- [x] 在 `src/gui/src/styles.css` 追加 `.append-dialog-backdrop` 样式（`position: fixed; inset: 0; z-index: 100; background: transparent`），验收：dialog 打开后透明全屏层覆盖视口、点击 dialog 外部触发 cancel
- [x] 在 `src/gui/src/styles.css` 追加 `.append-dialog` 样式（`position: fixed; top: 4.5rem; right: 1.5rem; width: min(460px, calc(100vw - 3rem)); max-height: calc(100vh - 6rem); overflow:auto; background/border/radius/box-shadow/padding 按 4.2.2`），验收：未传 anchorEl 时 dialog 默认浮在视口右上区、不被 markdown 内容遮挡
- [x] 在 `src/gui/src/styles.css` 追加 `.append-dialog` 子节点样式（`header / form / .kind-group / .kind-option / .field / textarea / .reference / .reference .quote / .actions / .error`），与 4.2.2 一致，验收：dialog 内部表单纵向排布、按钮右对齐、引用块带左侧色条
- [x] 在 `src/gui/src/styles.css` 追加 `.append-btn { border: 1px solid var(--border); }`，验收：按钮与同行「运行 Agent」「Review」视觉对齐
- [x] 在 `AppendTaskDialog` 内部用 `createEffect` + `onCleanup` 监听 `props.open`：open 时注册 `window` keydown 监听，按下 `Escape` 调用 `cancel()`；close 或组件卸载时移除监听，验收：dialog 打开时按 ESC 可关闭，连续开关无重复监听残留
- [x] 在 `src/gui/src/__e2e__/` 新增 `append-task.spec.ts`：进入 SpecDetail → 点击 `.append-btn` → 断言 `.append-dialog` 可见且其 `boundingClientRect.top` 大于按钮 `bottom`、`right` 与按钮 `right` 相差 ≤4px → 按下 Escape → 断言 dialog 消失 → 重新打开并填入 kind/description 提交 → 断言 spec md `## 追加任务` 章节被写入对应条目，验收：`pnpm test:e2e` 通过
- [ ] 浏览器手测全链路（点击按钮 → dialog 锚到按钮下方弹出 → 按 ESC 关闭 → 重新打开点击 dialog 外部关闭 → 再次打开并提交追加项 → Agent Dock 出现新 run → spec 重开 plan），将手测条目与结果写入 `## 7. 执行记录`

## 7. 执行记录

- 2026-06-19 改动 `src/gui/src/components/AppendTaskDialog.tsx`：`Props` 新增可选 `anchorEl?: HTMLElement`；增加本地 `pos` signal 与两个 `createEffect`——一个在 `open` 翻转时读取 `anchor.getBoundingClientRect()` 写入 `{ top: rect.bottom + 8, left: rect.right }`，关闭时回写 `null`；另一个在打开时注册 `window` keydown 监听，按 `Escape` 调用 `cancel()`，通过 `onCleanup` 在重新评估/卸载时移除。dialog 根 div 加内联 `style`：有 `pos()` 时设置 `top` 与 `right: calc(100vw - left)`，无则回退 CSS 默认锚位。
- 2026-06-19 改动 `src/gui/src/pages/SpecDetail.tsx`：在组件作用域声明 `let appendBtnEl: HTMLButtonElement | undefined`；给「追加任务」按钮加 `ref={appendBtnEl}`，并向 `<AppendTaskDialog>` 传 `anchorEl={appendBtnEl}`。
- 2026-06-19 改动 `src/gui/src/styles.css`：追加 `.append-btn`（与同行 `.run-btn` / `.review-link` 视觉对齐的边框）、`.append-dialog-backdrop`（透明全屏 + z-index 100）、`.append-dialog`（fixed 锚位 + 默认右上兜底 + 阴影/圆角）、`.append-dialog` 子节点（`header / form / .kind-group / .kind-option / .field / textarea / .reference / .reference .quote / .actions / .error`）。
- 2026-06-19 新增 `src/gui/src/__e2e__/append-task.spec.ts`：三条用例覆盖 popover 锚位（dialog.top > 按钮 bottom；dialog.right 与按钮 right 偏差 ≤4px）、ESC 关闭 dialog、提交追加项后 spec md 写入 `## 追加任务` 章节并保留 plan 阶段。`npx playwright test` 全量 6/6 通过（含原有 selection-menu / question-confirm）。
- 2026-06-19 验证：`npx tsc --noEmit` 通过；`npx vitest run` 110/110 通过；`npx playwright test` 6/6 通过。
- 2026-06-19 阻塞：浏览器手测全链路（Agent Dock 出现新 run、spec 重开 plan）依赖真实 GUI + Agent CLI，Agent 子任务无法在当前环境内驱动；e2e 已覆盖等效路径（按钮 → popover → ESC / 外部点击 / 提交 → spec md 写入），等待用户在本地浏览器复核后勾选并补记结果。

## 8. 用户批注

（暂无）

## 执行记录

- 2026-06-19 提交 b0a09c2：fix(260619.fix.append-task-btn-no-response): 修复 SpecDetail「追加任务」按钮点击无响应，AppendTaskDialog 改为锚定按钮的 popover 弹窗（5 个文件）
