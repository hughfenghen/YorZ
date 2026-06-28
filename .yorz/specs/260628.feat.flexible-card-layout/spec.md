---
stage: execute
last_action: 落地 FIX-1 仅 Home + sticky page-head 方案，标记追加任务为 [fixed]，UI 走查待用户手动验证
updated_at: 2026-06-28
summary: 将 spec 列表从固定两列改为弹性布局（卡片 400-500px 自适应宽屏），并修复列表页内容超出视口时无法滚动的问题
---

# Spec: spec 列表弹性布局

## 1. 背景

GUI 首页（Home）以卡片网格形式展示 spec 列表，当前布局写死两列，宽屏下大量横向空间被浪费。需要改为弹性布局，让卡片宽度在 400-500px 之间自适应排列，充分利用宽屏空间。

弹性布局上线后又出现新问题：当 spec 数量较多、列表纵向超出视口时，整个列表页无法滚动，超出部分被直接裁切。

## 2. 需求

### 2.1 原始需求

> 列表当前固定两列，不适合宽屏；
> 改成弹性布局，每个卡片宽度在 400~500px 之间

追加需求（2026-06-28 21:20）：

> 列表页超出页面高度无法滚动

### 2.2 功能需求

- **FEAT-1 弹性多列**：spec 列表根据可用容器宽度自动排列列数，而非固定两列。
- **FEAT-2 卡片宽度范围**：单个卡片宽度尽量控制在 400-500px 之间；在容器宽度处于"死区"（无法兼顾占满容器 + ≤500 上限 + 整数列）时，按用户决策保 ≥400 下限，允许单卡片宽度 >500px。
- **FEAT-3 宽屏适配**：在超宽屏（如 2K/4K）下能够展示 3 列以上卡片。
- **FEAT-4 占满容器**：卡片应铺满 `.spec-grid` 可用宽度，两侧不留白；容器变化时通过增减列数维持单卡片宽度尽量靠近 400-500px 区间。
- **FIX-1 列表页可滚动**：当 spec 列表（或其它列表型页面内容）纵向超出视口高度时，应能在合理粒度内滚动浏览，超出内容不被裁切。

## 3. 现状分析

### 3.1 技术栈

SolidJS + 原生全局 CSS 单文件 `src/gui/src/styles.css`，无 Tailwind / CSS Modules / styled-components。

### 3.2 涉及文件

| 文件                         | 作用         | 关键行号                                                                                                                                |
| ---------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `src/gui/src/pages/Home.tsx` | 列表渲染组件 | 13-52（`<section class="page">` → `<ul class="spec-grid">` → `<li class="spec-card">`）                                                 |
| `src/gui/src/styles.css`     | 全部样式     | 78-83（`.app`）、104-109（`.shell-body`）、111-119（`.content`）、492-498（`.page`）、545-553（`.spec-grid`）、921-933（`.spec-split`） |

### 3.3 初版（固定列）实现及其缺陷

第一次 plan/execute 落地的初版：

```css
/* styles.css:545-559（初版） */
.spec-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 400px), 500px));
  justify-content: center;
  gap: 0.75rem;
}
```

实测发现的问题：

- 列宽 max 写死 `500px`（而非 `1fr`），列不会被拉伸；当容器宽度不是「列数 ×(400~500) + gap」的整数倍时，整行卡片靠 `justify-content: center` 居中，**两侧出现明显留白**，违反"卡片应占满容器宽度"。
- 在容器宽度处于"死区"时（如 700px、1100px）：既塞不下额外的 400px 列，又拉不大现有列到 500px，留白尤其显眼。

### 3.4 关键约束：`.content` 已放宽至 1600px

```css
/* styles.css:111-119（已落地） */
.content {
  display: flex;
  flex-direction: column;
  flex: 1;
  padding: 1rem;
  width: min(1600px, 100%);
  margin: 0 auto;
  overflow: hidden;
}
```

`Home` 渲染在 `<main class="content">` 内；放宽到 1600px 后宽屏可承载 3-4 列卡片。

### 3.5 弹性布局的本质矛盾与最终取舍

"占满容器" + "单卡片严格 400-500" + "整数列" 在某些容器宽度下无解：

- 例：容器 700px，1 列 → 卡片 700px（>500，违规）；2 列 → 卡片 350px（<400，违规）。
- 任何纯 CSS 方案都必须在 ≥400 下限 / ≤500 上限 / 占满容器 三者中放弃至少一个。

用户已决策：**保 ≥400 下限 + 保占满容器**，允许在死区下单卡片宽度临时 >500px。

### 3.6 可参照的现成弹性布局

项目中 `.attachment-list`（`styles.css:1562-1569`）使用标准 CSS Grid 弹性写法，关键是用 `1fr` 作为 max 让卡片被拉伸填满容器：

```css
.attachment-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 0.5rem;
}
```

本轮即采用同一思路。

### 3.7 列表页无法滚动的根因（FIX-1 新增）

应用主框架是一条 `overflow: hidden` 的高度链：

```css
/* styles.css:78-83 */
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden; /* 顶层裁切，禁止 body 滚动 */
}

/* styles.css:104-109 */
.shell-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden; /* 侧栏 + 主区，水平裁切 */
}

/* styles.css:111-119 */
.content {
  display: flex;
  flex-direction: column;
  flex: 1;
  padding: 1rem;
  width: min(1600px, 100%);
  margin: 0 auto;
  overflow: hidden; /* 主区裁切，禁止整页滚动 */
}
```

页面容器 `.page`（styles.css:492-498）本身只声明 `flex: 1 1 auto; min-height: 0`，**未提供任何滚动容器**：

```css
.page {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  flex: 1 1 auto;
  min-height: 0;
}
```

`.page` 出现在 5 个页面：`Home.tsx:13`、`NewSpec.tsx:311`、`SpecReview.tsx:60`、`Welcome.tsx:5`、`SpecDetail.tsx:202`。其中只有 SpecDetail 在内部子节点 `.spec-split > .spec-main`（styles.css:929-933）单独声明了 `overflow: auto`，让 markdown 长文档可以在面板内独立滚动；refct 那次（commit b9186e9）只修了 SpecDetail，没有把同类问题推广到其它页面。

因此：Home / NewSpec / SpecReview / Welcome 这四类页面，只要内容纵向超过 `.content` 可用高度，就会被 `.content` 的 `overflow: hidden` 直接裁切，**无任何滚动条**。本次 bug 在 Home 上最先暴露是因为 spec 数量多 + 卡片单列模式下纵向高度迅速超过视口。

### 3.8 修复粒度的取舍

可选粒度由细到粗：

1. **仅 Home** — 在 `Home.tsx` 外包一层 `overflow-y: auto` 容器或对 `.spec-grid` 直接给 `overflow-y: auto`。只解决眼前现象；NewSpec / SpecReview / Welcome 同类隐患仍在。
2. **所有 `.page`** — 给 `.page` 加 `overflow-y: auto`，一次性修复 5 个页面；对 SpecDetail 无副作用（其 `.spec-split` 自含独立滚动 + `min-height: 0`，不会撑大父级 `.page`）。
3. **`.content`** — 把 `.content` 的 `overflow: hidden` 改为 `auto`。覆盖面最大，但 SpecDetail 内部已有的 `.spec-main` 滚动会与 `.content` 形成嵌套滚动容器，宽屏下 page-head 会被一起卷走，行为不一致。

另一维度是"滚动主体"：整个 page（含 page-head）一起滚动，还是 page-head 用 `position: sticky; top: 0` 固定、仅下方内容滚动。后者视觉更稳定，但需要 page-head 单独配 sticky 背景与 z-index。

## 4. 技术实现方案

### 4.1 总体方案

采用 **方案 B**：`grid-template-columns: repeat(auto-fill, minmax(min(100%, 400px), 1fr))`，并删除 `justify-content: center`。

行为：

- 容器 <400px：`min(100%, 400px) = 100%`，单列，卡片宽度 = 容器宽度。
- 容器 400-800px：仍是单列，1fr 拉伸单卡片到容器满宽（卡片可达 ~800px，>500 上限退化为软约束）。
- 容器 800-1200px：2 列，每列 400-600px。
- 容器 1200-1600px：3 列，每列 400-533px。
- 容器 ≥1600px（`.content` 上限）：3-4 列，每列均落在 400-500px 范围。

trade-off：用户主动接受"≤500 上限在死区退化为软约束"，换取"占满容器 + ≥400 下限"。

### 4.2 候选实现方案（弹性布局）

| 方案     | 思路                                                                                                                                  | 优点                                          | 局限                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------ |
| A        | 父容器启用 `container-type: inline-size`，在 `@container` 500/1000/1500/2000 断点处把 `grid-template-columns` 切换为 `repeat(N, 1fr)` | 占满容器、断点精确、可严格控制 ≤500           | 需要新增一层 wrapper 或修改 `.content`；列数固定在断点处突变 |
| **B ✅** | 直接 `repeat(auto-fill, minmax(min(100%, 400px), 1fr))`                                                                               | 改动最小、纯单行 CSS                          | 卡片可被拉到 ~800px 才触发分列，≤500 上限退化为软约束        |
| C        | 在 `Home.tsx` 用 `ResizeObserver` 监听容器宽度，按 `ceil(W/500)` 写 `--col-count`，CSS 用 `repeat(var(--col-count), 1fr)`             | 严格满足"卡片>500 即增列"，行为最贴合用户描述 | 引入运行时 JS、ResizeObserver 依赖、SSR / 初始渲染需要兜底   |

用户已选定方案 B。

### 4.3 实施改动点（弹性布局，已落地）

- 改动 1：`src/gui/src/styles.css:551`，将 `grid-template-columns` 从 `repeat(auto-fill, minmax(min(100%, 400px), 500px))` 改为 `repeat(auto-fill, minmax(min(100%, 400px), 1fr))`。
- 改动 2：`src/gui/src/styles.css:552`，删除 `justify-content: center;` 一行，让 grid 自然占满 `.spec-grid` 宽度。
- 不引入 wrapper 元素、不引入 `container-type`、不引入 JS / ResizeObserver。

### 4.4 影响范围（弹性布局）

- `.spec-grid` 仅作用于 `Home.tsx` 的 spec 列表，改动不外溢。
- `.content` 封顶 1600px 已在前一轮落地，本轮不再调整。

### 4.5 候选实现方案（FIX-1 列表页滚动）

| 方案     | 范围              | 实现                                                                                                                                                          | 优点                                                                                                                                      | 局限                                                                                     |
| -------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| A        | 所有 `.page` 页面 | `styles.css:492-498` 给 `.page` 追加 `overflow-y: auto`（如需可同时加 `overscroll-behavior: contain`）                                                        | 一处改动覆盖 Home/NewSpec/SpecReview/Welcome；SpecDetail 因 `.spec-split` 自带 `min-height: 0 + overflow: auto`，不会被撑大父级，无副作用 | 默认整个 page（含 page-head）一起滚                                                      |
| B        | 主区整体          | `styles.css:118` 将 `.content` 的 `overflow: hidden` 改为 `auto`                                                                                              | 一行修复，但覆盖面最大                                                                                                                    | SpecDetail 内 `.spec-main` 已 `overflow: auto`，会出现嵌套滚动容器；page-head 行为不一致 |
| **C ✅** | 仅 Home           | 在 `Home.tsx` 的 `<section class="page">` 追加 Home 专属类 `home-page`，CSS 单独给其 `overflow-y: auto` 并把内部 `.page-head` 设为 `position: sticky; top: 0` | 改动最小、可控；不影响 NewSpec/SpecReview/Welcome/SpecDetail；满足"仅下方内容滚动 + page-head 固定"视觉                                   | NewSpec/SpecReview/Welcome 的同类隐患仍在，后续需各自补丁                                |

用户已选定：**方案 C（仅 Home）+ page-head 用 sticky 固定（仅下方内容滚动）+ 不加 `overscroll-behavior: contain`（保持浏览器默认链式滚动）**。

### 4.6 实施改动点（FIX-1，已定稿）

- 改动 A：`src/gui/src/pages/Home.tsx:13`，把 `<section class="page">` 改为 `<section class="page home-page">`。仅追加 Home 专属类名，不动其它 DOM 结构。
- 改动 B：`src/gui/src/styles.css`，在 `.page-head` 规则之后追加 Home 专属规则块：
  - `.home-page { overflow-y: auto; }`
  - `.home-page .page-head { position: sticky; top: 0; z-index: 1; background: var(--bg); padding-block: 0.5rem; margin-block: -0.5rem; }`
  - `margin-block: -0.5rem` 用于抵消 sticky 自身的纵向 padding，避免与 `.page` 原本的 `gap: 1rem` 叠加产生额外空隙。
- 不动 `.app` / `.shell-body` / `.content` / `.page` 通用样式，不动 SpecDetail 的 `.spec-split > .spec-main`。
- 不引入 JS、不引入 `overscroll-behavior`。

### 4.7 影响范围（FIX-1）

- 受影响页面：仅 Home。其它 `.page` 页面（NewSpec/SpecReview/Welcome/SpecDetail）样式与行为不变。
- DOM 改动仅 1 处（Home.tsx 加类），样式追加约 5 行。

## 5. 待确认问题

- 暂无

## 6. 任务清单

- [x] 修改 `src/gui/src/styles.css:545-559`：将 `.spec-grid` 改为 `grid-template-columns: repeat(auto-fill, minmax(min(100%, 400px), 500px))` + `justify-content: center`，删除 `@media (min-width: 720px)` 两列规则；验收：卡片宽度被严格限制在 400-500px 之间。（初版实现，已被本轮方案 B 推翻）
- [x] 修改 `src/gui/src/styles.css:116`：将 `.content` 的 `width: min(960px, 100%)` 改为 `width: min(1600px, 100%)`；验收：内容区宽度上限放宽到 1600px。
- [x] 修改 `src/gui/src/styles.css:551-552`：将 `.spec-grid` 的 `grid-template-columns` max 从 `500px` 改为 `1fr` 并删除 `justify-content: center`；验收：grid 占满 `.spec-grid` 宽度无两侧留白，容器变化时通过列数变化维持单卡片 ≥400px。
- [ ] 启动 GUI 在 700px / 1024px / 1600px / 2000px 容器宽度下走查 Home 页：验证 (a) 卡片始终填满 `.spec-grid` 宽度无留白；(b) 容器 <800px 时单列且单卡片宽度可 >500px（被接受的 trade-off）；(c) 容器 ≥1600px 时展示 ≥3 列，每列宽度落在 400-500px 区间。
- [ ] 在常见宽度（720px / 1024px / 1920px）下走查 SpecDetail、NewSpec、Review 等使用 `.content` 的页面，验证布局未明显错乱。
- [x] 修改 `src/gui/src/pages/Home.tsx:13`：把 `<section class="page">` 改为 `<section class="page home-page">`；验收：渲染后根节点带有 `home-page` 类名，其它 DOM 结构不变。
- [x] 在 `src/gui/src/styles.css` 的 `.page-head` 规则之后追加 `.home-page { overflow-y: auto; }`；验收：Home 内部 spec 列表纵向超出可用高度时出现滚动条，可滚动浏览全部 spec。
- [x] 在 `src/gui/src/styles.css` 同位置追加 `.home-page .page-head { position: sticky; top: 0; z-index: 1; background: var(--bg); padding-block: 0.5rem; margin-block: -0.5rem; }`；验收：滚动 Home 时 page-head 固定在视口顶部，与下方卡片无视觉断层，"刷新" 按钮始终可见。
- [ ] 启动 GUI 在 Home spec 数量 ≥ 10 的场景下走查：验证 (a) Home 出现纵向滚动条；(b) page-head 滚动时保持固定；(c) NewSpec / SpecReview / Welcome / SpecDetail 行为未受改动影响。

## 7. 追加任务

- [fixed] 2026-06-28 20:51 | 卡片应该占满容器宽度，当容器被挤压小于400px，则减少列，容器拉伸，每个卡片超过500px则增加列
  - 描述：卡片应该占满容器宽度，当容器被挤压小于400px，则减少列，容器拉伸，每个卡片超过500px则增加列
  - 处理：plan 重开，列出 3 个候选方案 + 3 条待确认问题；用户批注选定方案 B + 保 ≥400 下限策略；execute 阶段在 `src/gui/src/styles.css:551-552` 落地（max 改 `1fr`、删除 `justify-content: center`）。"≤500 上限在死区退化为软约束"是用户已确认的 trade-off。
- [fixed] 2026-06-28 21:20 | 列表页超出页面高度无法滚动
  - 描述：列表页超出页面高度无法滚动
  - 处理：plan 重开，定位根因为 `.app/.shell-body/.content` 三层 `overflow: hidden` 链 + `.page` 无独立滚动容器（仅 SpecDetail 通过 `.spec-main` 规避）；技术方案 4.5 给出 A/B/C 三种候选；用户批注选定方案 C（仅 Home）+ page-head sticky + 不加 overscroll-behavior；execute 阶段在 `Home.tsx:13` 追加 `home-page` 类、在 `styles.css` 追加 `.home-page` 与 `.home-page .page-head` 两条规则落地。

## 8. 执行记录

- 2026-06-28：新建 spec，完成 plan 阶段——现状分析已定位到 `.spec-grid`（styles.css:545-559）固定两列实现与 `.content`（styles.css:116）960px 封顶约束；技术方案给出弹性布局改造方向，待用户确认 P-1/P-2 后进入 tasks 阶段。
- 2026-06-28：消费用户批注（P-1 放宽 `.content` 至 1600px、P-2 严格限制卡片 400-500px），合并改动至技术实现方案并拆出任务清单，进入 execute 阶段。
- 2026-06-28：在 `src/gui/src/styles.css` 完成两项代码改动——`.spec-grid` 改为 `repeat(auto-fill, minmax(min(100%, 400px), 500px))` + `justify-content: center` 并删除 720px 媒体查询；`.content` 宽度封顶从 960px 放宽至 1600px。验证方式：人工在宽屏 GUI 下走查（当前 CLI 环境无法启动 SolidJS 开发服务器，余下两项 UI 走查任务保留为未完成，待用户手动启动 `yorz serve` 后验证）。
- 2026-06-28：识别到 `## 7. 追加任务` 中存在 `[open] [fix]` 条目（要求"占满容器"），触发变更重开流程；同时合并修复了文档中重复出现的 `追加任务` 章节。切回 plan 阶段，新增 3.3 / 3.5 章节诊断初版 `minmax(400, 500) + center` 留白问题；技术方案重新给出 A / B / C 三种候选；在 `## 5. 待确认问题` 中提出 3 条问题（优先级取舍、实现路径、container 挂载层），等待用户批注后进入 tasks。
- 2026-06-28：消费用户批注——P-1 选"保 ≥400 下限：少分一列，单卡片临时 >500px"，P-2 选方案 B（`minmax(min(100%, 400px), 1fr)`），P-3（container 挂载层）因未选方案 A 不再适用一并清理。更新技术方案 4.1/4.2/4.3 为方案 B 终稿；在 `src/gui/src/styles.css:551-552` 落地代码改动（max 改 `1fr`、删 `justify-content: center`）。`## 7. 追加任务` 中 `[open] [fix]` 条目标记为 `[fixed]`。余下两条 UI 走查任务因 CLI 环境无法启动 GUI 而保留为未完成，待用户手动 `yorz serve` 后验证。
- 2026-06-28：提交 7531b06 — feat(260628.feat.flexible-card-layout)：将 spec 列表从固定两列改为弹性布局，卡片宽度 400-500px 自适应，适配宽屏多列展示（2 个文件）。
- 2026-06-28：识别到底部新增的 `[open] [fix]` 条目（"列表页超出页面高度无法滚动"），触发第二次变更重开流程；同时合并修复了再次出现的重复 `追加任务` / `执行记录` 章节。切回 plan 阶段，新增 3.7 / 3.8 章节定位根因为 `.app/.shell-body/.content` 三层 `overflow: hidden` 链 + `.page` 无独立滚动容器；技术方案新增 4.5 / 4.6 / 4.7 给出 A/B/C 候选与影响范围；`## 5. 待确认问题` 提出 P-FIX-1 ~ P-FIX-3 三条问题等待用户批注。
- 2026-06-28：消费 P-FIX-1/2/3 用户批注——P-FIX-1 选"仅修 Home"、P-FIX-2 选"page-head sticky + 下方独立滚动"、P-FIX-3 选"不加 overscroll-behavior"。结合两者选定终稿方案 C（Home 专属 `home-page` 类）：Home.tsx 给 `<section>` 追加类名；`.home-page { overflow-y: auto }`；`.home-page .page-head { position: sticky; top: 0; z-index: 1; background: var(--bg); padding/margin 抵消 .page 的 gap }`。更新 4.5/4.6/4.7 终稿；新增 4 条执行任务；清空待确认问题，进入 execute。
- 2026-06-28：execute 落地 FIX-1——改动 1：`src/gui/src/pages/Home.tsx:13` 给 `<section class="page">` 追加 `home-page` 类。改动 2：`src/gui/src/styles.css` 在 `.page-head h1` 规则之后追加 `.home-page` 与 `.home-page .page-head` 两条规则（overflow-y: auto + position: sticky/top/z-index/background/padding-block/margin-block 抵消 .page gap）。`## 7. 追加任务` 中"列表页超出页面高度无法滚动"条目状态由 `[open]` → `[fixed]`。验证方式：当前 CLI 环境无法启动 SolidJS 开发服务器，UI 走查任务保留为未完成，待用户手动 `yorz serve` 后验证 (a) Home 出现纵向滚动条；(b) page-head 滚动时保持固定；(c) 其它页面行为不变。
