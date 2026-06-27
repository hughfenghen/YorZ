---
stage: execute
last_action: 全部 14 项任务执行完成，测试与构建通过
updated_at: 2026-06-27
summary: 改造 yorz-spec skill 输出 mermaid 图形代码，GUI 集成 mermaid.js 渲染 spec 中的 mermaid 代码块为可视化图形
---

# Spec: spec 文档 mermaid 图形化

## 1. 背景

spec 文档信息量大，纯文本（含表格/列表）难以快速阅读和决策。需要通过图形化对 spec 信息进行"升维"，提升可读性与决策效率。

本期仅考虑 mermaid 支持的图形类型，分两端改造：

1. **Skill 侧**：改造 yorz-spec skill，在生成 spec 文档时优先输出 mermaid code（根据内容选择合适的图形类型）。参考 https://github.com/WH-2099/mermaid-skill 的选型逻辑与输出规范。
2. **GUI 侧**：接入 mermaid.js，将 spec 文档中的 mermaid code 块渲染为图形。

### 原始需求

> 产品设计文档 @docs/Prod-Design.md
> 技术架构设计文档 @docs/Architecture.md
>
> 由于 spec 文档的信息量太大，不方便阅读和快速决策，现在需要对 spec 文档的信息进行升维，通过文档图形化来实现，暂时只考虑 mermaid 支持的图形；
> 改造 yorz skill 优先在文档中输出 mermaid code，根据内容选择合适的图形类型 https://github.com/WH-2099/mermaid-skill
> GUI 页面接入 mermaid js 将 spec 文档中的 mermaid code 渲染为图形

## 2. 需求

### 2.1 功能需求

- **FEAT-1 Skill mermaid 输出**：yorz-spec skill 在生成 `## 现状分析` / `## 技术实现方案` 等章节内容时，根据信息特征主动输出合适的 mermaid 图表（流程图、时序图、架构图、状态图等），替代或补充纯文本描述。
- **FEAT-2 GUI mermaid 渲染**：SpecDetail 页面将 spec body 中的 ` ```mermaid ` 代码块渲染为可视化图形，随 SSE 更新自动重渲染。
- **FEAT-3 暗色模式适配**：mermaid 图形随系统深色/浅色模式自动切换主题。

### 2.2 非功能需求

- 不影响现有 spec 文档（无 mermaid 代码块的文档渲染不受影响）。
- 移动端可读：mermaid 图形在窄屏下可横向滚动查看，不破坏页面布局。
- mermaid 库按需加载，不显著拖慢首屏。

## 3. 现状分析

### 3.1 GUI 渲染链路

- spec body 由 `renderMarkdown()` (`src/gui/src/lib/markdown.ts:64`) 渲染为 HTML 字符串，经 SolidJS `innerHTML` 注入到 `<article class="markdown spec-main">` 元素（`src/gui/src/pages/SpecDetail.tsx:238`）。
- `renderMarkdown` 内部使用 `markdown-it`（`html: false, linkify: true, breaks: false`），自定义了 `image` 和 `link_open` 两条 renderer rule，**未覆盖 `fence` rule**。
- 当前 ` ```mermaid ` 代码块会按 markdown-it 默认行为输出为 `<pre><code class="language-mermaid">...</code></pre>` 纯文本，**不会渲染为图形**。
- 整个代码库无 mermaid 依赖、无任何 mermaid 处理逻辑（`package.json` 无 `mermaid` / `@mermaid-js/*`）。

### 3.2 SpecDetail 重渲染时机

- `refreshTick` signal 在 SSE 推送 spec 更新时自增（`SpecDetail.tsx:62`），触发 `createResource` 重新拉取 spec → `renderMarkdown` 重新计算 → `innerHTML` 更新 article DOM。
- article DOM 更新后，已有 `createEffect`（`SpecDetail.tsx:85-90`）在 `articleEl()` 上绑定 `observeSelection`。mermaid 渲染需在同样的 DOM 更新时机触发。

### 3.3 Skill 结构

- yorz-spec skill 位于 `src/skill/yorz-spec/`，采用模块化拆分：`SKILL.md`（入口）+ `conventions.md` / `routing.md` / `plan.md` / `tasks.md` / `execute.md` / `new-spec.md` / `rewrite-rules.md`，`index.json` 声明模块元数据。
- `plan.md` 指导 Agent 在 `## 现状分析` / `## 技术实现方案` 输出分析内容——这是 mermaid 图表输出的核心落点。
- skill 通过 `yorz install` 安装到 Agent 目录（`src/cli/install.ts`），安装逻辑递归复制 skill 目录下所有文件。

### 3.4 参考 mermaid-skill（WH-2099/mermaid-skill）

- 提供基于"用例关键词 → 图表类型"的选型决策表（23 种类型），每个类型关联一份 mermaid 官方语法参考文档（`references/*.md`，38 个文件，每周 GitHub Action 自动同步）。
- 输出规范：必须用 ` ```mermaid ` 代码块包裹、语法正确可渲染、语义化节点命名、需要时包含样式。
- 该 skill 面向通用 Claude Code 场景（通过 `/mermaid` 命令触发），需适配为 yorz-spec skill 内的嵌入式指导。

### 3.5 GUI 主题

- 已支持暗色模式：`styles.css:2` 声明 `color-scheme: light dark`，`styles.css:18` 使用 `@media (prefers-color-scheme: dark)` 切换变量。

## 4. 技术实现方案

### 4.1 总体架构

```mermaid
flowchart LR
    A[yorz-spec skill] -->|输出 mermaid code| B[spec.md]
    B -->|SSE 推送| C[GUI SpecDetail]
    C -->|renderMarkdown| D["fence rule 识别 mermaid"]
    D -->|输出占位 div| E["mermaid.run 异步渲染"]
    E --> F["图形展示"]
```

### 4.2 Skill 侧改造

**目标**：让 Agent 在 plan 阶段生成 spec 文档时主动输出 mermaid 图表。

**方案**：新增 skill 模块 `mermaid.md`，在 SKILL.md 与 plan.md 中引用：

1. **新增 `src/skill/yorz-spec/mermaid.md`**：
   - **图表选型表**：从 mermaid-skill 精简适配，保留与 spec 文档最相关的类型（flowchart / sequenceDiagram / stateDiagram / classDiagram / erDiagram / architecture / mindmap 等），给出"信息特征 → 图表类型"映射。
   - **输出规范**：mermaid code 必须用 ` ```mermaid ` 包裹、语义化节点命名、语法正确可渲染。
   - **落点指导**：在 `## 现状分析` 中用架构图/依赖图描述现有系统结构；在 `## 技术实现方案` 中用流程图/时序图描述方案逻辑与交互流程；在 `## 待确认问题` 中用对比图辅助决策。
   - **节制原则**：只在信息确实复杂、图形能显著提升可读性时输出，避免为出图而出图。

2. **修改 `src/skill/yorz-spec/plan.md`**：在目标章节追加一条指向 `mermaid.md` 的引用，要求 Agent 在输出分析/方案内容时按需嵌入 mermaid 图表。

3. **修改 `src/skill/yorz-spec/SKILL.md`**：在"如何使用本 skill"列表中新增 `mermaid.md` 引用。

4. **更新 `src/skill/yorz-spec/index.json`**：新增 mermaid 模块元数据。

5. **内置 mermaid 语法参考文档**：将 mermaid-skill 的 `references/*.md`（38 个文件）复制到 `src/skill/yorz-spec/references/`，随 skill 一起 install（install.ts 的 `import.meta.glob('**/*.{md,json}')` 自动包含子目录文件）。

6. **修改 `src/skill/yorz-spec/tasks.md`**：追加 mermaid.md 引用，指导 Agent 在 tasks 阶段消费批注、拆解任务时也可输出 mermaid 图（如任务依赖关系图）。

7. **修改 `src/skill/yorz-spec/execute.md`**：追加 mermaid.md 引用，指导 Agent 在 execute 阶段输出 mermaid 图描述变更影响与执行结果。

### 4.3 GUI 侧改造

**方案**：fence rule 占位 + 异步 `mermaid.run()` 后处理。

1. **添加依赖**：`package.json` devDependencies 加入 `mermaid`（`^11`）。

2. **修改 `src/gui/src/lib/markdown.ts`**：
   - 覆盖 `md.renderer.rules.fence`：当 fence 语言为 `mermaid` 时，输出 `<div class="mermaid" data-mermaid-source="<escaped code>">...</div>` 占位容器（而非默认 `<pre><code>`）；其余语言走默认逻辑。

3. **新增 `src/gui/src/lib/mermaid.ts`**：
   - 封装 `renderMermaidIn(container: HTMLElement): Promise<void>`：
     - 动态 `import('mermaid')`（懒加载，避免首屏膨胀）。
     - 根据 `matchMedia('(prefers-color-scheme: dark)')` 设置 `theme: 'dark' | 'default'`。
     - 调用 `mermaid.run({ nodes: container.querySelectorAll('.mermaid') })`。
     - 监听 `prefers-color-scheme` 变化，切换主题后重新渲染。

4. **修改 `src/gui/src/pages/SpecDetail.tsx`**：
   - 新增 `createEffect`（与 `observeSelection` effect 并列）：当 `articleEl()` 与 spec body 更新时，调用 `renderMermaidIn(el)`。
   - `onCleanup` 中取消主题监听。

5. **修改 `src/gui/src/styles.css`**：
   - 为 `.markdown .mermaid` 容器添加居中、背景、圆角样式。
   - `@media (prefers-color-scheme: dark)` 下调整背景色。
   - 添加 `overflow-x: auto` 支持窄屏横向滚动。

### 4.4 懒加载与包体

- mermaid v11 完整包约 1-2MB（gzip 后数百 KB），通过动态 `import()` 懒加载，仅在 SpecDetail 页面首次渲染 mermaid 时拉取，不影响列表页与其他页面首屏。
- 后续可考虑仅导入所需图表类型模块（`mermaid/dist/mermaid.core` + 按需注册 diagram definitions）进一步瘦身，本期 MVP 先用完整包。

## 5. 待确认问题

- 暂无

## 6. 任务清单

- [x] 新增 `src/skill/yorz-spec/mermaid.md`，包含图表选型表（信息特征→图表类型映射，覆盖 flowchart / sequenceDiagram / stateDiagram / classDiagram / erDiagram / architecture / mindmap 等）、输出规范（` ```mermaid ` 包裹 / 语义化节点命名 / 语法正确可渲染）、落点指导（现状分析 / 技术实现方案 / 任务清单 / 执行记录各阶段适用图表类型）、节制原则；验收：文件存在且内容完整，SKILL.md 可正确链接到该文件
- [x] 从 https://github.com/WH-2099/mermaid-skill 克隆并将 `references/*.md`（38 个文件）复制到 `src/skill/yorz-spec/references/`；验收：`ls src/skill/yorz-spec/references/*.md` 列出 38 个文件，install.ts 的 `import.meta.glob` 已覆盖子目录
- [x] 修改 `src/skill/yorz-spec/plan.md`，在目标章节追加一条指向 `mermaid.md` 的引用，要求 Agent 在输出分析/方案内容时按需嵌入 mermaid 图表；验收：plan.md 包含对 `mermaid.md` 的 markdown 链接
- [x] 修改 `src/skill/yorz-spec/tasks.md`，追加 `mermaid.md` 引用，指导 Agent 在 tasks 阶段也可输出 mermaid 图；验收：tasks.md 包含对 `mermaid.md` 的 markdown 链接
- [x] 修改 `src/skill/yorz-spec/execute.md`，追加 `mermaid.md` 引用，指导 Agent 在 execute 阶段可输出 mermaid 图描述变更影响；验收：execute.md 包含对 `mermaid.md` 的 markdown 链接
- [x] 修改 `src/skill/yorz-spec/SKILL.md`，在"如何使用本 skill"列表中新增 `mermaid.md` 引用项；验收：SKILL.md 列表包含 mermaid.md 链接
- [x] 更新 `src/skill/yorz-spec/index.json`，在 modules 数组新增 mermaid 模块元数据（module: mermaid, file: mermaid.md, keyRules）；验收：`JSON.parse` 可正确解析，modules 数组包含 mermaid 条目
- [x] 在根 `package.json` devDependencies 加入 `mermaid`（`^11`）并执行 `pnpm install`；验收：`node_modules/mermaid` 存在，`pnpm build` 不报依赖缺失
- [x] 修改 `src/gui/src/lib/markdown.ts`，覆盖 `md.renderer.rules.fence`：当 fence 语言为 `mermaid` 时输出 `<div class="mermaid" data-mermaid-source="<escaped code>">...</div>` 占位容器，其余语言走默认逻辑；验收：`renderMarkdown` 对 ` ```mermaid ` 代码块输出包含 `class="mermaid"` 的 div 而非 `<pre><code>`
- [x] 新增 `src/gui/src/lib/mermaid.ts`，封装 `renderMermaidIn(container: HTMLElement)` 与 cleanup 机制：动态 `import('mermaid')` 懒加载、根据 `matchMedia('(prefers-color-scheme: dark)')` 设置 theme（dark/default）、调用 `mermaid.run()` 渲染 `.mermaid` 节点、监听主题变化重渲染；验收：TypeScript 编译通过，函数签名符合 SpecDetail 调用需求
- [x] 修改 `src/gui/src/pages/SpecDetail.tsx`，新增 `createEffect`（与 `observeSelection` effect 并列）：当 `articleEl()` 与 spec body 更新时调用 `renderMermaidIn(el)`，`onCleanup` 中取消主题监听；验收：SSE 推送 spec 更新后 mermaid 图形自动重渲染
- [x] 修改 `src/gui/src/styles.css`，为 `.markdown .mermaid` 添加居中 / 背景 / 圆角样式，`@media (prefers-color-scheme: dark)` 下调整背景色，添加 `overflow-x: auto` 支持窄屏横向滚动；验收：浅色/深色模式下 mermaid 图形均有合理外观，窄屏可横向滚动
- [x] 运行 `pnpm test` 确认现有测试无回归；验收：全部测试通过
- [x] 运行 `pnpm build` 确认 CLI + GUI 构建均通过；验收：`dist` 目录生成，无编译错误

## 7. 追加任务

- 暂无

## 8. 执行记录

- 2026-06-27 新建 spec，完成 plan 阶段（现状分析 / 技术实现方案 / 待确认问题）
- 2026-06-27 消费用户批注（4 条），确认决策：①内置全部 references；②完整包懒加载；③所有阶段均可输出；④跟随系统 prefers-color-scheme。更新技术方案，生成 14 项任务清单，进入 execute 阶段
- 2026-06-27 [T1] 新增 `src/skill/yorz-spec/mermaid.md`（选型表 / 输出规范 / 落点指导 / 节制原则），验收通过
- 2026-06-27 [T2-T7] 复制 references/\*.md（38 文件）到 `references/`；plan.md / tasks.md / execute.md / SKILL.md 追加 mermaid.md 引用；index.json 新增 mermaid 模块元数据，验收通过
- 2026-06-27 [T8] package.json 加入 `mermaid@^11`，pnpm install 成功（v11.16.0）
- 2026-06-27 [T9] markdown.ts 覆盖 fence rule，mermaid 代码块输出 `<div class="mermaid">` 占位容器
- 2026-06-27 [T10] 新增 mermaid.ts（懒加载 / 暗色主题 / mermaid.run / 主题变化重渲染）
- 2026-06-27 [T11] SpecDetail.tsx 新增 mermaid createEffect，onCleanup 取消监听
- 2026-06-27 [T12] styles.css 新增 .mermaid 容器样式 + 暗色适配 + overflow-x: auto
- 2026-06-27 [T13] pnpm test 通过（23 文件 182 测试全绿）
- 2026-06-27 [T14] pnpm build 成功（CLI 704KB + GUI 2209 模块，mermaid.core 懒加载 chunk 621KB）
