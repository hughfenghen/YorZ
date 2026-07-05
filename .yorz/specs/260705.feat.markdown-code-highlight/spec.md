---
stage: done
last_action: 任务全部完成，标记 done
updated_at: '2026-07-05 22:09:59'
summary: 为 GUI spec 详情页与 review 页的 markdown-it 渲染接入 highlight.js，为代码块增加语法高亮并适配明暗主题。
---

# 260705.feat.markdown-code-highlight

## 1. 背景

GUI 的 spec 详情页（`SpecDetail.tsx`）与 review 页（`SpecReview.tsx`）均通过 `src/gui/src/lib/markdown.ts` 的 `renderMarkdown()` 渲染 spec / review 的 Markdown 文档，结果以 `innerHTML` 注入 `<article class="markdown">`。当前代码块（fenced code）除 `mermaid` 被特殊处理外，其余一律走 markdown-it 默认 `<pre><code>` 输出，仅有一层灰底，无任何语法着色，可读性差。

## 2. 需求

为上述两页渲染出的代码块提供语法高亮能力：按代码块声明的语言（```lang）对关键字、字符串、注释、数字等 token 着色，并兼顾应用现有的 `prefers-color-scheme` 明暗主题切换。

## 3. 现状分析

### 3.1 渲染入口与调用方

- 核心渲染器：`src/gui/src/lib/markdown.ts`
  - 构造：`new MarkdownIt({ html:false, linkify:true, breaks:false })`（markdown.ts:4-8），未配置 `highlight` 选项。
  - 已挂载插件：`markdown-it-task-lists`（markdown.ts:114）。
  - 自定义 `fence` 规则（markdown.ts:103-112）：仅当 `info === 'mermaid'` 时改写为 `<div class="mermaid" data-mermaid-source="...">`；其余调用 `defaultFenceRender`（即构造期捕获的默认 fence 规则）。
- 调用方：
  - `SpecDetail.tsx:279-282`：`innerHTML={renderMarkdown(s().body, { specId, projectId })}`；渲染后在 article 上执行 `renderMermaidIn(el)`（SpecDetail.tsx:94-107）。
  - `SpecReview.tsx:86-90`：通过 `createMemo` 得到 `reviewHtml()`，注入 `<article class="markdown review-md">`（SpecReview.tsx:429）；review 页未接入 mermaid 渲染。
- 全仓库无任何语法高亮库（`highlight.js` / `shiki` / `prism` / `lowlight` 搜索结果为空）。

### 3.2 样式现状

- `.markdown code`（styles.css:1010-1016）：统一灰底圆角，等宽字体。
- `.markdown pre`（styles.css:1018-1023）：灰底（`color-mix(in srgb, var(--text) 8%, transparent)`，随明暗主题自适应）、1rem 内边距、横向滚动。
- `.markdown .mermaid`（styles.css:1025-1034）：居中容器，独立样式。
- 应用整体通过 CSS 变量 `--surface`/`--text`/`--border`/`--accent` 与 `@media (prefers-color-scheme: dark)` 实现明暗主题。

### 3.3 构建与依赖

- `markdown-it` 当前为 `devDependencies`（package.json:42），由 GUI 构建打包进前端产物；CLI 构建在 `vite.config.ts:30-31` 将其 external。
- `highlight.js` 尚未安装，需新增依赖。

### 3.4 关键约束

- 自定义 `fence` 规则拦截了 `mermaid`，必须保留该优先级，避免 mermaid 源码被当作普通代码高亮而破坏 `renderMermaidIn` 的后续处理。
- markdown-it 的 `highlight` 构造选项由其默认 fence 规则消费；当前非 mermaid 分支回落到 `defaultFenceRender`（即默认规则），因此只要在构造器注入 `highlight` 函数，非 mermaid 代码块即可自动获得高亮，无需改写 fence 规则主体。

## 4. 技术实现方案

### 4.1 库选型：highlight.js

采用 **highlight.js**（通过 `highlight.js/lib/common` 入口，覆盖约 40 种常用语言，体积/覆盖平衡），理由：

- markdown-it 官方文档推荐搭配，集成最直接（构造器 `highlight` 选项）。
- 纯运行时、无异步加载，与现有同步 `renderMarkdown()` 契合，不引入 SSR/构建复杂度。
- `common` 入口可 tree-shake 友好，避免全量语言膨胀。

不选 shiki（需异步加载语法、体积大、与同步渲染流程不匹配）、不选 prism（markdown-it-prism 维护活跃度低、API 不如官方选项统一）。

### 4.2 集成点：markdown.ts

1. 新增导入：`import hljs from 'highlight.js/lib/common'`。
2. 构造器增加 `highlight` 选项：
   ```ts
   const md = new MarkdownIt({
     html: false,
     linkify: true,
     breaks: false,
     highlight(str, lang) {
       const language = lang && hljs.getLanguage(lang)
       if (language) {
         try {
           return `<pre><code class="hljs language-${lang}">${hljs.highlight(str, { language: lang }).value}</code></pre>`
         } catch {
           /* fallthrough */
         }
       }
       return '' // 交给 markdown-it 默认转义输出（无高亮）
     },
   })
   ```
   - 返回空串时，markdown-it 使用默认转义生成 `<pre><code class="language-X">">`，行为与现状一致。
   - `mermaid` 分支在自定义 `fence` 规则中先行拦截，不会进入 `highlight`，互不干扰。
3. 不改动 `defaultFenceRender` 的捕获逻辑与非 mermaid 回落路径——构造期注入的 `highlight` 会被默认 fence 规则自动调用。

### 4.3 主题与明暗适配

- 高亮容器 `.hljs` 背景置为 `transparent`，沿用现有 `.markdown pre` 的自适应灰底，避免双重背景。
- token 着色采用双主题方案，跟随应用现有 `prefers-color-scheme` 机制：
  - 浅色：`highlight.js/styles/github.css` 的 token 颜色。
  - 深色：`highlight.js/styles/github-dark.css` 的 token 颜色，置于 `@media (prefers-color-scheme: dark)` 下覆盖。
- 落地形态（已决）：**手动将 github.css / github-dark.css 中的 token 颜色规则搬运进 `src/gui/src/styles.css` 的 `.markdown` 作用域**，深色部分包入 `@media (prefers-color-scheme: dark)`。零额外构建配置、完全自控、与现有 mermaid 等内联样式风格一致；只影响文档渲染区，不污染全局。

### 4.4 验证策略

- GUI 构建：`pnpm run build:gui` 通过。
- 现有测试：`pnpm test`（vitest）与 `pnpm test:e2e`（playwright）通过。
- 视觉：dev 模式人工核验明暗主题下 `ts / `bash / ```yaml 等代码块着色正确（`[manual]`）。

## 5. 待确认问题

_暂无_

## 6. 任务清单

- [x] 安装 highlight.js 到 devDependencies（验收：package.json devDependencies 出现 `highlight.js`，pnpm-lock.yaml 更新，`import hljs from 'highlight.js/lib/common'` 类型解析通过）
- [x] 修改 src/gui/src/lib/markdown.ts：导入 `highlight.js/lib/common` 并在 MarkdownIt 构造器中注入 `highlight` 选项；保留 mermaid 拦截与 defaultFenceRender 回落（验收：tsc 通过；```ts 代码块经 renderMarkdown 输出含 `code.hljs.language-ts`与`hljs-\*` token span）
- [x] 更新 src/gui/src/styles.css：在 `.markdown` 作用域下追加 github.css 浅色 token 颜色规则；在 `@media (prefers-color-scheme: dark)` 中覆盖为 github-dark.css 深色 token 颜色规则；`.markdown .hljs` 背景置 transparent（验收：仅影响 `.markdown` 内 code；明/暗色差与现有 --text/--surface 一致，无双重背景）
- [x] 运行 pnpm run build:gui 与 pnpm test 全套校验（验收：build 与 vitest 均通过）
- [ ] [manual] 在 dev 模式人工核验 spec 详情页 / review 页在明暗主题下 ts / bash / yaml 代码块着色（验收：人工确认关键字/字符串/注释/数字 token 着色符合预期）

## 7. 执行记录

- 2026-07-05 22:06 · 安装依赖：`pnpm add -D highlight.js` 成功，devDependencies 新增 `highlight.js@11.11.1`；node_modules/highlight.js/styles/github.css 与 github-dark.css 就位可作为 token 颜色参考源。
- 2026-07-05 22:07 · 修改 `src/gui/src/lib/markdown.ts`：新增 `import hljs from 'highlight.js/lib/common'`，在 MarkdownIt 构造器内注入 `highlight(str, lang)`，命中语言时返回 `<pre><code class="hljs language-<lang>">...token span...</code></pre>`，未命中/异常返回空串走默认转义。既有 mermaid fence 拦截与 defaultFenceRender 回落链路保持不变。
- 2026-07-05 22:08 · 更新 `src/gui/src/styles.css`：在 `.markdown pre` 之后追加浅色 hljs token 规则（选择器全部收敛到 `.markdown` 作用域），`.markdown .hljs` 背景设为 transparent 复用 pre 灰底；在 `@media (prefers-color-scheme: dark)` 中覆盖为 github-dark 的 token 颜色。
- 2026-07-05 22:08 · 构建校验：`pnpm run build:gui` 通过（4.39s；chunk 大小告警为既有现象，与本次无关）。
- 2026-07-05 22:09 · 测试校验：`pnpm test` 274/275 通过；唯一失败为 `src/service/__tests__/service.test.ts > SSE pushes updated event when underlying file changes`，属于并行下 chokidar fs watch 时序 flake：单独运行该测试通过；stash 本次改动后基线复测同样 flake，说明与本 spec 改动无因果关系（本改动仅动 GUI markdown/styles，未触及 service 层）。
- 2026-07-05 22:09 · 收尾：所有非 manual 任务完成，`## 待确认问题` 为空，无 `！！！` 批注、无 `## 追加任务` `[open]` 条目，将 stage 置为 `done`。剩余 `[manual]` 人工视觉核验按规则不阻塞收尾，待用户自行确认。
