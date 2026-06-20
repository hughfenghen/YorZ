---
stage: execute
last_action: 完成全部代码改动并通过 typecheck / 110 项 vitest
updated_at: 2026-06-20
summary: 优化待确认问题面板与批注弹窗：移除「全部使用推荐」按钮，spec 运行中禁用提交按钮，批注弹窗去除前缀说明、宽度调整为 500px、文本框宽度 100%。
---

# 待确认面板与批注弹窗 UI 微调

## 1. 背景

近期对 Review/批注 / 待确认问题面板做了多轮迭代后，一些视觉与交互细节仍偏「实现态」而非「成品态」：
推荐项的快捷按钮、运行中可重复提交答复、批注弹窗过窄等问题在日常使用中产生明显摩擦。本次集中做一次 UI 收尾。

## 2. 需求

- 移除「待确认问题」面板中的「全部使用推荐」按钮。
- spec 处于 Agent 运行中时，「提交全部」按钮应处于置灰禁用状态，避免在 Agent 还在改写 md 的过程中重复提交答复。
- 批注弹窗 (`AnnotatePopover`) 样式优化：
  - 取消顶部的前缀说明文案（「将以 `！！！` 写入 spec…」那一行）。
  - 弹窗宽度由 320px 调整为 500px。
  - 输入批注内容的 `textarea` 显式占满弹窗内宽（宽度 100%、`box-sizing: border-box`）。

## 3. 现状分析

- `src/gui/src/components/QuestionConfirmPanel.tsx`
  - L69-81：`useAllRecommended()` 一次性把所有非自由题选成「推荐选项」。
  - L123-126：header 操作区里渲染「全部使用推荐」按钮，紧邻「提交全部」。
  - L127-129：「提交全部」按钮 `disabled` 仅基于本地 `busy()`（即提交请求未返回），不感知外部「Agent 是否在跑」。
  - 组件 Props (`Props` 接口 L13-18) 当前仅接 `questions / freeforms / onRemoveFreeform / onSubmit`，没有运行态入参。
- `src/gui/src/pages/SpecDetail.tsx`
  - L180：已存在 `running = () => agentTasks.hasRunningSkillRun(params.id)`，用于「运行 Agent」按钮的 disabled 判断，可以复用同一信号。
  - L241-248：`<QuestionConfirmPanel>` 当前未向下传递任何运行态。
  - `submitAnswers()`（L136-140）在提交答复成功后会主动 `runAgent()`，所以正常路径下面板提交完成 → Agent 启动 → `running()` 为 true，禁用状态可以平滑生效。
- `src/gui/src/components/AnnotatePopover.tsx`
  - L11：`const POPOVER_WIDTH = 320`，宽度同时决定 fixed 定位的 `left` 约束和 `style.width`。
  - L53-58：header 内有 `<strong>批注</strong>` 与 `<span class="muted">将以 <code>！！！</code> 写入 spec，Agent 续跑会按 skill 自动消费</span>`，即需要移除的前缀说明。
  - L63-69：`textarea` 没有显式 width，依赖 `.annotate-popover` 的 flex 列布局填满，但目前 CSS 没有 `width: 100%` 与 `box-sizing: border-box`，弹窗变宽后可能出现 textarea 不到边的视觉错位。
- `src/gui/src/styles.css`
  - L415-475 定义 `.annotate-popover` 系列样式：`padding: 0.9rem 1rem`、`flex-direction: column`。`.annotate-popover textarea`（L443-452）当前没有显式宽度。
- 既有 e2e 与单测均不依赖「全部使用推荐」按钮文本，也未对批注弹窗宽度做硬断言。已搜确认（`src/gui/src/__e2e__/question-confirm.spec.ts` 不出现该按钮文本）。

## 4. 技术实现方案

围绕「最小改动 + 单一真相」原则，把改动局限在 GUI 组件 + 样式。

### 4.1 待确认问题面板：移除推荐快捷按钮

- `src/gui/src/components/QuestionConfirmPanel.tsx`
  - 删除 header 中「全部使用推荐」`<button>`（L123-126 之间的一段）。
  - 删除已无引用的 `useAllRecommended()` 函数及其依赖。
  - `qcp-head-actions` 容器内仅剩「提交全部」一个按钮，CSS 不需要额外调整（保留对齐即可）。

### 4.2 待确认问题面板：运行中置灰提交按钮

- 给 `QuestionConfirmPanel` 的 `Props` 新增 `running?: boolean`（可选，缺省 `false`，保持向后兼容）。
- 「提交全部」按钮：
  - `disabled = busy() || props.running` —— 任意一个为真都置灰。
  - 文案：`busy()` 时仍显示「提交中…」；`props.running` 为真且非 `busy()` 时显示「运行中…」；否则「提交全部」。
- 在 `src/gui/src/pages/SpecDetail.tsx`：
  - 现有 `running = () => agentTasks.hasRunningSkillRun(params.id)` 已存在，直接 `<QuestionConfirmPanel … running={running()} />` 传入。
- 不在父组件做「面板是否显示」的进一步收敛 —— 面板可见性仍由 `showPanel()` 决定，只是按钮置灰，这样用户在 Agent 跑完前仍能看到自己的草稿。

### 4.3 批注弹窗样式优化

- `src/gui/src/components/AnnotatePopover.tsx`
  - `POPOVER_WIDTH` 由 320 改为 500，`position()` 中右侧贴边保护逻辑保持不变（仅常量值改变）。
  - header 内删除 `<span class="muted">将以 <code>！！！</code> 写入 spec…</span>` 这行说明文案；header 仅保留 `<strong>批注</strong>` 标题。
- `src/gui/src/styles.css`
  - `.annotate-popover textarea` 增加 `width: 100%;` 与 `box-sizing: border-box;`，确保在 500px 弹窗内文本框可见地铺满内宽（视觉与需求字面对齐）。
  - 不调整 padding / gap，避免引入额外回归。

### 4.4 测试与验证

- 静态：`npx tsc --noEmit`、`npm test`（vitest）跑一遍，回归 question-parse / answers-route 等单测。
- e2e：本次仅 UI 微调，已有 `question-confirm.spec.ts` 不依赖按钮文本/弹窗宽度，预期无需改动；若 selection-menu / question-confirm e2e 失败再补。
- 手动：在 plan 阶段的 spec 上打开待确认面板，肉眼确认按钮消失、运行中按钮置灰、批注弹窗 500px、textarea 顶满。

## 5. 待确认问题

- 暂无

## 6. 任务清单

- [x] 修改 `src/gui/src/components/QuestionConfirmPanel.tsx`：删除 header 内「全部使用推荐」按钮及未引用的 `useAllRecommended()` 函数；`Props` 新增 `running?: boolean`；「提交全部」按钮 `disabled = busy() || props.running`，按钮文案在 `props.running && !busy()` 时显示「运行中…」，其余保持原有「提交中…」/「提交全部」逻辑。验收：组件不再出现「全部使用推荐」字样；运行中按钮不可点击且显示「运行中…」。
- [x] 修改 `src/gui/src/pages/SpecDetail.tsx`：在 `<QuestionConfirmPanel>` 渲染处显式传入 `running={running()}`，复用已有 `agentTasks.hasRunningSkillRun(params.id)` 信号。验收：`grep "running={running()}"` 可命中传参。
- [x] 修改 `src/gui/src/components/AnnotatePopover.tsx`：将常量 `POPOVER_WIDTH` 由 320 改为 500；删除 header 内 `<span class="muted">将以 <code>！！！</code> 写入 spec，Agent 续跑会按 skill 自动消费</span>` 整行，仅保留 `<strong>批注</strong>`。验收：文件中无 `将以` 文案；`POPOVER_WIDTH === 500`。
- [x] 修改 `src/gui/src/styles.css`：在 `.annotate-popover textarea` 选择器内追加 `width: 100%;` 与 `box-sizing: border-box;`，其余声明保持不变。验收：500px 弹窗下 textarea 视觉占满内宽且无横向溢出。
- [x] 运行 `npx tsc --noEmit` 与 `npm test`，把结果（通过 / 失败用例数）写入执行记录；若仓库未配置某脚本则记录原因。

## 7. 执行记录

- 2026-06-20 GUI 组件改动：`QuestionConfirmPanel.tsx` 删除「全部使用推荐」按钮与 `useAllRecommended()`，`Props` 增 `running?: boolean`，「提交全部」按钮 `disabled = busy() || props.running` 且 `props.running && !busy()` 时文案变为「运行中…」；`SpecDetail.tsx` 处显式传入 `running={running()}`，复用 `agentTasks.hasRunningSkillRun(params.id)`。
- 2026-06-20 批注弹窗改动：`AnnotatePopover.tsx` `POPOVER_WIDTH` 320 → 500，header 内 `muted` 说明文案整行删除；`styles.css` 内 `.annotate-popover textarea` 追加 `width: 100%; box-sizing: border-box;`，其它声明未变。
- 2026-06-20 验证：`npx tsc --noEmit` 无报错；`npm test`（vitest）14 个文件 110/110 通过，用时约 9.65s。仓库未配置 lint 脚本，已跳过。UI 视觉部分（弹窗 500px 下 textarea 顶满、运行中按钮置灰）留待人工 / e2e 在浏览器中复核。
