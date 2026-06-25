---
stage: execute
last_action: 提交 git
updated_at: 2026-06-25
summary: 将待确认问题面板从悬浮 fixed 浮层改为与 spec 文档左右并列布局（panel 在左、宽度 1:2），两栏各自独立滚动；并修复无 panel 时 spec 详情页面无法滚动的高度链路问题。
---

# 改进待确认问题 UI：并列布局 + 独立滚动

## 1. 背景

改进待确认问题的 UI；当前待确认是一个弹窗（实际为 `position: fixed` 浮层），渲染时浮动在 Spec 文档的左侧，可能遮挡 spec 文档的内容；希望改造成 **确认问题与 spec 文档左右并列**，宽度 **1:2**；如果内容比较多超出高度，两个模块使用各自独立的滚动条。

## 2. 需求

- 待确认问题面板与 spec 文档主体在 spec 详情页左右并列；面板在左，spec 文档在右。
- 两栏宽度比例 panel : spec = 1 : 2；
- 任一栏内容超出可视高度时，仅该栏出现滚动条，互不影响；
- 当没有待确认问题（含 freeforms）时，spec 文档应占满 `.spec-split` 全宽；
- header（spec 标题/动作栏）固定在 split 容器之上，仅两栏内部滚动；
- 窄屏（≤ 960px）下两栏堆叠为上下排列，面板 `max-height: 50vh` 以免顶飞正文。

## 3. 现状分析

### 3.1 当前组件与挂载

- 面板组件：`src/gui/src/components/QuestionConfirmPanel.tsx`，根元素为 `<aside class="question-confirm-panel">`。
- 挂载点：`src/gui/src/pages/SpecDetail.tsx:225-240`，已迁入 `<div class="spec-split">` 容器，panel 在前、`<article class="markdown spec-main">` 在后。
- 页面外壳：`<section class="page">`（L186），布局为 flex-column；上层 `.shell-body` 也是 flex 容器（左侧项目导航 + 右侧 `.content`）。
- 滚动职责：refct 后由 `.spec-split` 内两栏（panel 内部 `.qcp-list` 与 article `.spec-main`）各自承担纵向滚动；`.content` 改为 `overflow: hidden`，不再承担整体滚动。

### 3.2 当前定位方式

`src/gui/src/styles.css:736-780`：

- `.spec-split` 为 flex row 容器，`gap: 1rem; align-items: stretch; flex: 1 1 auto; min-height: 0`。
- `.spec-split > .spec-main` 为 `flex: 2 1 0; min-width: 0; overflow: auto`，article 内部滚动。
- `.spec-split > .question-confirm-panel` 为 `flex: 1 1 0; min-width: 0`。
- `.question-confirm-panel` 删除了 `position: fixed`，仅保留 flex column + 视觉样式（border / radius / shadow）+ `overflow: hidden`。
- 窄屏 `@media (max-width: 960px)` 下两栏堆叠为上下，面板限高 `50vh`；旧的 `@media (max-width: 1600px)` 抽屉降级已移除。

### 3.3 痛点（历史记录，已解决）

- 旧实现的 `position: fixed` 完全脱离 spec 详情页的流式布局：浮在 `.content` 之外，仍会与浏览器视口内任何区域重叠（在窄于 1600px 时显式退化为顶部抽屉，覆盖 article 顶部）。
- 在 1600px 阈值附近，面板宽度被压缩至极窄（< 320px 触发降级），用户体验割裂。
- 960px 内容宽度与 panel 的定位公式硬耦合，后续若改 `.content` 宽度需同步多处 calc。
- 一旦面板呈现，spec 文档左右两侧都是无内容空白，视觉浪费。

### 3.4 数据流（与本次改造无关，仅供参考）

- 数据来源：`parseConfirmQuestions(s().body)` 从 spec body 中 `## 待确认问题` 解析。
- 提交：`api.submitQuestionAnswers(specId, payload)` → 触发 `runAgent()` 重跑 Agent。
- 可见性：`showPanel()` memo 由 `stage === 'plan' && (questions().length > 0 || freeforms().length > 0)` 决定。

### 3.5 重构后回归 bug：无 panel 时 spec 详情页面无法滚动（2026-06-25）

- 复现：当前 spec `stage !== 'plan'` 或不存在待确认问题（`showPanel()` 为 false），且 spec 正文较长（超过视口高度）时，整页**无任何滚动条**，正文被截断不可见。
- 高度链路（refct 后）：

  ```
  .shell-body  (display: flex; flex: 1; overflow: hidden)  ← flex row 容器，撑满窗口高度
    .content   (flex: 1; width: min(960px,100%); overflow: hidden)  ← 仅是 flex item，自身**不是** flex 容器
      .page    (display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0)  ← flex 子项属性失效（父非 flex）
        .page-head, .error, .spec-split (flex: 1 1 auto; min-height: 0)
          .spec-main (flex: 2 1 0; overflow: auto)
  ```

- 根因：`.content` 在 refct 时由 `overflow-y: auto` 改为 `overflow: hidden`，但 **`.content` 本身没有 `display: flex`**。其子 `.page` 上的 `flex: 1 1 auto; min-height: 0` 因父级不是 flex 容器而无效，`.page` 取自然内容高度。当 article 内容很高时，`.page` 撑得高于 `.content`，被 `.content` 的 `overflow: hidden` 静默截断；又因为 `.content` 没有 `auto`，所以不显示滚动条。
- 同理，`.spec-split` 的 `flex: 1 1 auto` 也未生效（爷爷 `.page` 自身没有受约束的高度），`.spec-main` 的 `overflow: auto` 形同虚设——article 自然高度撑满，没有溢出可滚。
- 为何 panel 存在时也可能"看起来工作"：panel `.qcp-list` 自身设置了 `overflow: auto; flex: 1 1 auto; min-height: 0`，在 panel 容器有界时可独立滚动；但 panel 容器同样吃这条链路问题，只不过卡片少时不易观察到。

## 4. 技术实现方案

### 4.1 总体思路

把 `<QuestionConfirmPanel>` 从「`.content` 内的 fixed 浮层」改为「`.content` 内的流式横向并列子元素」：

- 在 `SpecDetail.tsx` 中新增一个横向 flex 容器 `<div class="spec-split">`，包住 `<QuestionConfirmPanel>` 与 `<article class="markdown">`；
- **面板放左侧（占 1 份）**，spec 文档（article）放右侧（占 2 份）；header / 错误提示 / SelectionMenu / AnnotatePopover / AppendTaskDialog 等仍位于 `.spec-split` 之上的纵向流。
- 两栏均设 `overflow: auto; min-height: 0`，独立滚动；
- 当 `showPanel()` 为 false 时不渲染左栏，article 自动占满 `.spec-split` 全宽。

### 4.2 SpecDetail.tsx 改动

文件：`src/gui/src/pages/SpecDetail.tsx`

把当前结构（伪代码）：

```tsx
<section class="page">
  <header class="page-head detail-head">…</header>
  <Show when={runError()}><p class="error">…</p></Show>
  <article class="markdown" innerHTML={…} />
  <SelectionMenu … />
  <AnnotatePopover … />
  <AppendTaskDialog … />
  <Show when={showPanel()}>
    <QuestionConfirmPanel … />
  </Show>
</section>
```

改为：

```tsx
<section class="page">
  <header class="page-head detail-head">…</header>
  <Show when={runError()}><p class="error">…</p></Show>
  <div class="spec-split">
    <Show when={showPanel()}>
      <QuestionConfirmPanel … />
    </Show>
    <article class="markdown spec-main" ref={setArticleEl} innerHTML={…} />
  </div>
  <SelectionMenu … />
  <AnnotatePopover … />
  <AppendTaskDialog … />
</section>
```

- 面板在前、article 在后，DOM 顺序即视觉顺序，面板自然落在左侧。
- `SelectionMenu` / `AnnotatePopover` / `AppendTaskDialog` 自身就是浮层/弹窗，**保留 fixed 行为**，不进入 split 容器。
- `setArticleEl` 仍然挂在 `<article>` 上，划词逻辑不动；划词菜单沿用现状，不在 article 滚动时主动关闭/重定位。

### 4.3 QuestionConfirmPanel.tsx 改动

文件：`src/gui/src/components/QuestionConfirmPanel.tsx`

- 不做任何 props/DOM 改动；通过容器选择器 `.spec-split > .question-confirm-panel` 命中新布局样式，保持组件零侵入。

### 4.4 CSS 改动

文件：`src/gui/src/styles.css`

新增：

```css
/* spec 详情页的左右并列容器：panel 左 / spec 右，宽度 1:2 */
.spec-split {
  display: flex;
  gap: 1rem;
  align-items: stretch;
  flex: 1 1 auto;
  min-height: 0;
}

.spec-split > .spec-main {
  flex: 2 1 0;
  min-width: 0;
  overflow: auto;
}

.spec-split > .question-confirm-panel {
  flex: 1 1 0;
  min-width: 0;
}

/* 窄屏退化：堆叠为上下，面板限高避免顶飞正文 */
@media (max-width: 960px) {
  .spec-split {
    flex-direction: column;
  }
  .spec-split > .spec-main {
    flex: 1 1 auto;
  }
  .spec-split > .question-confirm-panel {
    flex: 0 0 auto;
    max-height: 50vh;
  }
}
```

改写原有 `.question-confirm-panel`（L736-753）：

- 删除 `position: fixed` / `top` / `right` / `width` / `max-height: calc(100vh - 7rem)` / `z-index` 等所有定位与尺寸耦合属性；
- 保留 `display: flex; flex-direction: column; background; border; border-radius; box-shadow; overflow: hidden`；
- 高度由 split 容器（flex 1）撑开，`overflow: hidden` 让内部 `.qcp-list` 继续承担滚动；同时给 `.qcp-list` 保持 `overflow: auto` 与 `flex: 1 1 auto; min-height: 0`，确保仅卡片列表滚动、头部按钮常驻。

删除 `@media (max-width: 1600px)` 中针对 `.question-confirm-panel` 的 1600px 抽屉降级规则（其位置假设已不复存在）。

### 4.5 滚动容器调整

为了让 `.spec-split` 内两栏分别滚动而不是被外层 `.content` 整体滚动「吃掉」，需要：

- `.page` 补 `flex: 1 1 auto; min-height: 0;`，使其在 `.content` 高度内可被两栏撑满；
- 把 `.content` 的 `overflow-y: auto` 改为 `overflow: hidden`（或保留兜底但避免双重滚动），由 `.spec-split` 子元素负责纵向滚动；
- header 与错误提示固定在 `.spec-split` 之上，不随两栏滚动。

### 4.6 验收点

- 同时存在 ≥ 5 条待确认问题与 ≥ 200 行 spec 正文时：
  - panel 在左、spec 在右，宽度比 ≈ 1 : 2；
  - 滚动 spec 正文不影响左侧面板位置；滚动左侧面板不影响 spec；
- 面板内的 `.qcp-head`（含 "提交全部" 按钮）始终可见；
- 关闭面板（无待确认问题）后 spec 占满全宽；
- 在 ≤ 960px 视口下两栏堆叠且仍可使用，面板高度受 50vh 限制；
- 重排后不破坏 `SelectionMenu` / `AnnotatePopover` 的划词/插入流程。

### 4.7 修复无 panel 时 spec 页面无法滚动（2026-06-25 追加）

文件：`src/gui/src/styles.css`

**最小修复**：补齐高度链路上 `.content` 的 flex 容器属性，让 `.page` 的 `flex: 1 1 auto; min-height: 0` 真正生效。

```css
/* 修改 .content：补 display: flex; flex-direction: column; 使 .page 受 .content 高度约束 */
.content {
  display: flex; /* 新增 */
  flex-direction: column; /* 新增 */
  flex: 1;
  padding: 1rem;
  width: min(960px, 100%);
  margin: 0 auto;
  overflow: hidden;
}
```

修复后链路：

```
.shell-body (flex row, height = 窗口高度)
  .content (flex item 取 .shell-body 高度；display: flex column → 内部为 flex 列容器)
    .page (flex: 1 1 auto 生效 → 撑满 .content 剩余高度；min-height: 0 允许子项收缩)
      .page-head / .error (flex: 0 0 auto，按自然高度)
      .spec-split (flex: 1 1 auto, min-height: 0 → 撑满 .page 剩余高度)
        .spec-main (overflow: auto，内部滚动)
        .question-confirm-panel (overflow: hidden + 内部 .qcp-list overflow: auto)
```

- 改动范围：仅 `.content` 规则 2 行新增；不动 `.page` / `.spec-split` / `.spec-main` / `.question-confirm-panel`。
- 不影响其他使用 `.content` 的页面：所有这些页面顶层都是 `<section class="page">`，新增 `display: flex` 对单 flex 子项的布局等价于不增加（子项天然撑满交叉轴，主轴方向由 `.page` 自身的 `flex: 1 1 auto` 自然 grow）。
- 验收：
  - 无待确认问题（`showPanel()` 为 false）且 spec 正文 > 视口高度时：`.spec-main` 内部出现滚动条且可滚到底；`.content` 自身**不**显示滚动条（仍 overflow: hidden）。
  - 有待确认问题且两栏内容均超长时：panel 内 `.qcp-list` 与 article `.spec-main` 各自独立滚动，互不影响。
  - 视口 ≤ 960px 堆叠模式下，page 整体仍能放下两栏；不出现"页面整体可滚但内栏失效"的反向问题。
  - 既有 review / new-spec 等页面的 `.content` 布局不被破坏（视觉与原本一致）。

## 5. 待确认问题

- 暂无

## 6. 任务清单

- [x] 修改 `src/gui/src/pages/SpecDetail.tsx`：在 `runError` 之后、`SelectionMenu` 之前新增 `<div class="spec-split">` 容器，按"panel 在前、article 在后"顺序渲染，并给 `<article>` 追加 `spec-main` 类。验收：DOM 中 `.spec-split` 内首子为 panel（或空）、次子为 `.markdown.spec-main`。
- [x] 在 `src/gui/src/styles.css` 新增 `.spec-split` 容器规则与 `.spec-split > .spec-main` / `.spec-split > .question-confirm-panel` 子规则（flex 比例 2 : 1，`min-width: 0`，`min-height: 0`，spec-main `overflow: auto`）。验收：两栏宽度比例 ≈ 1 : 2 且 spec 内部独立滚动。
- [x] 在 `src/gui/src/styles.css` 改写 `.question-confirm-panel`：删除 `position: fixed` / `top` / `right` / `width` / `max-height` / `z-index`，仅保留 `display: flex; flex-direction: column; background; border; border-radius; box-shadow; overflow: hidden`。验收：面板不再使用 fixed 定位。
- [x] 删除 `src/gui/src/styles.css` 中 `@media (max-width: 1600px)` 内针对 `.question-confirm-panel` 的抽屉降级块（如该 media query 仅包含此规则则整段移除）。验收：不再存在 1600px 抽屉降级样式。
- [x] 新增 `@media (max-width: 960px)` 让 `.spec-split` 堆叠为上下，面板 `flex: 0 0 auto; max-height: 50vh`。验收：窄屏视口下两栏纵向排列且面板高度受限。
- [x] 调整滚动容器：`.page` 增加 `flex: 1 1 auto; min-height: 0;`，将 `.content` 的 `overflow-y: auto` 改为 `overflow: hidden`，由 `.spec-split` 内两栏承担滚动。验收：仅两栏出现滚动条，无双滚动条。
- [x] 在 `src/gui/src/components/QuestionConfirmPanel.tsx` 不做改动（确认零侵入策略生效）；如需要可补一条注释链接到本 spec。验收：组件 props 与 DOM 结构无变化。
- [x] 运行 `prettier`（若可用）格式化改动的 `.ts`/`.tsx`/`.css` 文件，并执行项目测试/类型检查命令；记录结果。
- [x] 修复无 panel 时 spec 详情页无法滚动：按 4.7 方案在 `src/gui/src/styles.css` 的 `.content` 规则补 `display: flex; flex-direction: column;`（其它属性不变），并跑 prettier / tsc / vitest / vite build 验证。验收：无 panel 且 spec 正文超视口时，`.spec-main` 内部出现可滚动条；其它页面 `.content` 布局不被破坏。

## 7. 追加任务

- [fixed] [fix] 2026-06-25 20:20 | 不存在待确认问题，当前 Spec 文档页面无法滚动
  - 描述：不存在待确认问题，当前 Spec 文档页面无法滚动
  - 根因（见 3.5）：`.content` 缺 `display: flex`，导致 `.page` 的 `flex: 1 1 auto; min-height: 0` 失效，`.page` 取自然高度被 `.content { overflow: hidden }` 静默截断；连带 `.spec-split` / `.spec-main` 的 flex 与 `overflow: auto` 形同虚设。
  - 最小修复（见 4.7）：给 `.content` 补 `display: flex; flex-direction: column;`，恢复高度链路。

## 8. 执行记录

- 2026-06-25 新建 spec，完成现状分析、技术实现方案与待确认问题初稿，等待用户对 5 条待确认问题进行批注后进入 tasks 阶段。
- 2026-06-25 消费用户批注：panel 改放**左侧**（与现状视觉位置一致），其余 4 项按推荐（无问题时 spec 占全宽、窄屏堆叠且面板限高 50vh、header 固定、划词菜单沿用现状）。无新冲突/歧义，已更新技术方案并拆解任务清单。
- 2026-06-25 完成 SpecDetail.tsx 改造（新增 `.spec-split` 容器，panel 在前、article 追加 `spec-main` 类）。
- 2026-06-25 完成 styles.css 改造：新增 `.spec-split` / `.spec-split > .spec-main` / `.spec-split > .question-confirm-panel` 规则与 `@media (max-width: 960px)` 堆叠规则；改写 `.question-confirm-panel` 删除 fixed 定位与尺寸耦合；移除 `@media (max-width: 1600px)` 抽屉降级块；`.qcp-list` 补 `flex: 1 1 auto; min-height: 0`；`.page` 补 `flex: 1 1 auto; min-height: 0`；`.content` 由 `overflow-y: auto` 改为 `overflow: hidden`。
- 2026-06-25 QuestionConfirmPanel.tsx 保持零侵入（未修改 props/DOM）。
- 2026-06-25 验证：`npx prettier --write` 三文件均已对齐；`npx tsc --noEmit` 仅报 `QuestionConfirmPanel.tsx:46` `note` 重复键的**预存在**告警（非本次引入，未在本次范围内修复）；`npx vitest run` 23 文件 / 182 用例全部通过；`npx vite build --config vite.gui.config.ts` 成功。
- 2026-06-25 提交 4a951b9：refct(260625.refct.pending-questions-split-view): 将待确认问题面板从悬浮 fixed 浮层改为与 spec 文档左右并列布局（panel 在左、宽度 1:2），两栏各自独立滚动，避免遮挡正文。（3 个文件）
- 2026-06-25 追加 `[open] [fix]` 任务"无待确认问题时 spec 详情页面无法滚动"，触发变更重开流程；定位根因为 `.content` 缺 `display: flex`，导致 `.page` flex 链失效；补 3.5 现状、4.7 最小修复方案，新增 1 条待确认问题，stage 切回 plan，等待用户对方案进行批注后再进入 tasks 阶段。
- 2026-06-25 消费用户批注：选择推荐方案（给 `.content` 补 `display: flex; flex-direction: column;`），与 4.7 已写方案一致，无新冲突/歧义；清空 `## 待确认问题`，整段删除 `## 用户批注`，将修复任务追加到任务清单。
- 2026-06-25 在 `src/gui/src/styles.css` 的 `.content` 规则首两行补 `display: flex; flex-direction: column;`（其余属性不变），追加任务 `[open] → [fixed]`。
- 2026-06-25 验证：`npx prettier --write src/gui/src/styles.css` 显示 `unchanged`（写入前已对齐）；`npx tsc --noEmit` 仅报 `QuestionConfirmPanel.tsx:46` `note` 重复键的**预存在**告警（非本次引入）；`npx vitest run` 23 文件 / 182 用例全部通过；`npx vite build --config vite.gui.config.ts` 成功（122 modules / 195.68 kB JS / 20.41 kB CSS）。

## 执行记录

- 2026-06-25 提交 248eafb：refct(260625.refct.pending-questions-split-view): 将待确认问题面板从悬浮 fixed 浮层改为与 spec 文档左右并列布局（panel 在左、宽度 1:2），两栏各自独立滚动；并修复无 panel 时 spec 详情页面无法滚动的高度链路问题。（1 个文件）
