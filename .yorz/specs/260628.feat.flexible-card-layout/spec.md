---
stage: execute
last_action: 消费用户批注（保 ≥400 下限 + 方案 B），实施 CSS 改动并将追加任务标记为 fixed
updated_at: 2026-06-28
summary: 将 spec 列表从固定两列改为弹性布局，卡片宽度 400-500px 自适应，适配宽屏多列展示
---

# Spec: spec 列表弹性布局

## 1. 背景

GUI 首页（Home）以卡片网格形式展示 spec 列表，当前布局写死两列，宽屏下大量横向空间被浪费。需要改为弹性布局，让卡片宽度在 400-500px 之间自适应排列，充分利用宽屏空间。

## 2. 需求

### 2.1 原始需求

> 列表当前固定两列，不适合宽屏；
> 改成弹性布局，每个卡片宽度在 400~500px 之间

### 2.2 功能需求

- **FEAT-1 弹性多列**：spec 列表根据可用容器宽度自动排列列数，而非固定两列。
- **FEAT-2 卡片宽度范围**：单个卡片宽度尽量控制在 400-500px 之间；在容器宽度处于"死区"（无法兼顾占满容器 + ≤500 上限 + 整数列）时，按用户决策保 ≥400 下限，允许单卡片宽度 >500px。
- **FEAT-3 宽屏适配**：在超宽屏（如 2K/4K）下能够展示 3 列以上卡片。
- **FEAT-4 占满容器**：卡片应铺满 `.spec-grid` 可用宽度，两侧不留白；容器变化时通过增减列数维持单卡片宽度尽量靠近 400-500px 区间。

## 3. 现状分析

### 3.1 技术栈

SolidJS + 原生全局 CSS 单文件 `src/gui/src/styles.css`，无 Tailwind / CSS Modules / styled-components。

### 3.2 涉及文件

| 文件                         | 作用         | 关键行号                                                                                  |
| ---------------------------- | ------------ | ----------------------------------------------------------------------------------------- |
| `src/gui/src/pages/Home.tsx` | 列表渲染组件 | 32-48（`<ul class="spec-grid">` → `<li class="spec-card">`）                              |
| `src/gui/src/styles.css`     | 全部样式     | 545-559（`.spec-grid` 弹性布局，本轮已落地方案 B）；111-119（`.content` 已放宽至 1600px） |

### 3.3 初版实现及其缺陷

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
  width: min(1600px, 100%);
  margin: 0 auto;
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

### 4.2 候选实现方案

| 方案     | 思路                                                                                                                                  | 优点                                          | 局限                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------ |
| A        | 父容器启用 `container-type: inline-size`，在 `@container` 500/1000/1500/2000 断点处把 `grid-template-columns` 切换为 `repeat(N, 1fr)` | 占满容器、断点精确、可严格控制 ≤500           | 需要新增一层 wrapper 或修改 `.content`；列数固定在断点处突变 |
| **B ✅** | 直接 `repeat(auto-fill, minmax(min(100%, 400px), 1fr))`                                                                               | 改动最小、纯单行 CSS                          | 卡片可被拉到 ~800px 才触发分列，≤500 上限退化为软约束        |
| C        | 在 `Home.tsx` 用 `ResizeObserver` 监听容器宽度，按 `ceil(W/500)` 写 `--col-count`，CSS 用 `repeat(var(--col-count), 1fr)`             | 严格满足"卡片>500 即增列"，行为最贴合用户描述 | 引入运行时 JS、ResizeObserver 依赖、SSR / 初始渲染需要兜底   |

用户已选定方案 B。

### 4.3 实施改动点

- 改动 1：`src/gui/src/styles.css:551`，将 `grid-template-columns` 从 `repeat(auto-fill, minmax(min(100%, 400px), 500px))` 改为 `repeat(auto-fill, minmax(min(100%, 400px), 1fr))`。
- 改动 2：`src/gui/src/styles.css:552`，删除 `justify-content: center;` 一行，让 grid 自然占满 `.spec-grid` 宽度。
- 不引入 wrapper 元素、不引入 `container-type`、不引入 JS / ResizeObserver。

### 4.4 影响范围

- `.spec-grid` 仅作用于 `Home.tsx` 的 spec 列表，改动不外溢。
- `.content` 封顶 1600px 已在前一轮落地，本轮不再调整。

## 5. 待确认问题

- 暂无

## 6. 任务清单

- [x] 修改 `src/gui/src/styles.css:545-559`：将 `.spec-grid` 改为 `grid-template-columns: repeat(auto-fill, minmax(min(100%, 400px), 500px))` + `justify-content: center`，删除 `@media (min-width: 720px)` 两列规则；验收：卡片宽度被严格限制在 400-500px 之间。（初版实现，已被本轮方案 B 推翻）
- [x] 修改 `src/gui/src/styles.css:116`：将 `.content` 的 `width: min(960px, 100%)` 改为 `width: min(1600px, 100%)`；验收：内容区宽度上限放宽到 1600px。
- [x] 修改 `src/gui/src/styles.css:551-552`：将 `.spec-grid` 的 `grid-template-columns` max 从 `500px` 改为 `1fr` 并删除 `justify-content: center`；验收：grid 占满 `.spec-grid` 宽度无两侧留白，容器变化时通过列数变化维持单卡片 ≥400px。
- [ ] 启动 GUI 在 700px / 1024px / 1600px / 2000px 容器宽度下走查 Home 页：验证 (a) 卡片始终填满 `.spec-grid` 宽度无留白；(b) 容器 <800px 时单列且单卡片宽度可 >500px（被接受的 trade-off）；(c) 容器 ≥1600px 时展示 ≥3 列，每列宽度落在 400-500px 区间。
- [ ] 在常见宽度（720px / 1024px / 1920px）下走查 SpecDetail、NewSpec、Review 等使用 `.content` 的页面，验证布局未明显错乱。

## 7. 追加任务

- [fixed] 2026-06-28 20:51 | 卡片应该占满容器宽度，当容器被挤压小于400px，则减少列，容器拉伸，每个卡片超过500px则增加列
  - 描述：卡片应该占满容器宽度，当容器被挤压小于400px，则减少列，容器拉伸，每个卡片超过500px则增加列
  - 处理：plan 重开，列出 3 个候选方案 + 3 条待确认问题；用户批注选定方案 B + 保 ≥400 下限策略；execute 阶段在 `src/gui/src/styles.css:551-552` 落地（max 改 `1fr`、删除 `justify-content: center`）。"≤500 上限在死区退化为软约束"是用户已确认的 trade-off。

## 8. 执行记录

- 2026-06-28：新建 spec，完成 plan 阶段——现状分析已定位到 `.spec-grid`（styles.css:545-559）固定两列实现与 `.content`（styles.css:116）960px 封顶约束；技术方案给出弹性布局改造方向，待用户确认 P-1/P-2 后进入 tasks 阶段。
- 2026-06-28：消费用户批注（P-1 放宽 `.content` 至 1600px、P-2 严格限制卡片 400-500px），合并改动至技术实现方案并拆出任务清单，进入 execute 阶段。
- 2026-06-28：在 `src/gui/src/styles.css` 完成两项代码改动——`.spec-grid` 改为 `repeat(auto-fill, minmax(min(100%, 400px), 500px))` + `justify-content: center` 并删除 720px 媒体查询；`.content` 宽度封顶从 960px 放宽至 1600px。验证方式：人工在宽屏 GUI 下走查（当前 CLI 环境无法启动 SolidJS 开发服务器，余下两项 UI 走查任务保留为未完成，待用户手动启动 `yorz serve` 后验证）。
- 2026-06-28：识别到 `## 7. 追加任务` 中存在 `[open] [fix]` 条目（要求"占满容器"），触发变更重开流程；同时合并修复了文档中重复出现的 `追加任务` 章节。切回 plan 阶段，新增 3.3 / 3.5 章节诊断初版 `minmax(400, 500) + center` 留白问题；技术方案重新给出 A / B / C 三种候选；在 `## 5. 待确认问题` 中提出 3 条问题（优先级取舍、实现路径、container 挂载层），等待用户批注后进入 tasks。
- 2026-06-28：消费用户批注——P-1 选"保 ≥400 下限：少分一列，单卡片临时 >500px"，P-2 选方案 B（`minmax(min(100%, 400px), 1fr)`），P-3（container 挂载层）因未选方案 A 不再适用一并清理。更新技术方案 4.1/4.2/4.3 为方案 B 终稿；在 `src/gui/src/styles.css:551-552` 落地代码改动（max 改 `1fr`、删 `justify-content: center`）。`## 7. 追加任务` 中 `[open] [fix]` 条目标记为 `[fixed]`。余下两条 UI 走查任务因 CLI 环境无法启动 GUI 而保留为未完成，待用户手动 `yorz serve` 后验证。
