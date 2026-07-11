---
stage: done
last_action: 三处 bug 修复完成并通过 GUI 构建，任务全部完成，标记 done
updated_at: '2026-07-11 17:45:00'
summary: 修复 GUI 三处问题：review 页容器不应整体滚动而由文件列表/文档区各自独立滚动；spec 相关页增加面包屑并清理详情页 header 重复的 specId 与 summary 边距；追加任务弹窗溢出到页面左侧、应定位在按钮正下方。
---

# GUI 页面与交互 Bug 修复

## 1. 背景

当前 GUI 在 review 页、spec 详情/日志页、追加任务弹窗三处存在布局与交互缺陷，影响可用性。

## 2. 需求

修复以下 GUI 页面或交互的 bug：

1. review 页面主容器和页面不应该出现滚动条，期望弹性占满高度；git 文件变更列表和 review.md 渲染区域如果超出高度，应该是各自独立的滚动条。
2. spec 相关页面需要面包屑：需求列表 > spec id（详情页） > review｜执行日志；详情页 header 区域移除 specId（与面包屑、文档内容标题重复）；summary 下方与按钮操作区稍微增加一点边距，别靠太近。
3. spec 详情页「追加任务」弹窗可能溢出到页面左侧边界之外，弹窗应在按钮正下方即可。

## 3. 现状分析

三处问题分属「布局高度约束链断裂」「缺少面包屑 + header 冗余」「弹窗定位锚点错误」，均在 `src/gui` 前端层，不涉及 Service / CLI。

### 3.1 布局与页面壳层

`AppShell` 的 `<main>` 是唯一内容容器，页面根节点均以 `flex min-h-0 flex-1 flex-col` 期望「弹性占满、内部各自滚动」。但 `<main>` 自身是块级滚动容器（`overflow-auto`），并非 flex column，导致子节点 `flex-1` 无法拿到受约束高度，内容超高时由 `<main>` 整体滚动（页面级滚动条），review 页内部已设好的独立滚动区反而拿不到有界高度。

```mermaid
flowchart TB
    body["body h-full overflow-hidden"] --> shell["AppShell div flex h-full flex-col"]
    shell --> row["div flex min-h-0 flex-1"]
    row --> sidebar["ProjectsSidebar"]
    row --> main["main flex-1 overflow-auto（块级，非 flex-col）"]
    main --> sec["页面 section flex min-h-0 flex-1 flex-col（flex-1 失效）"]
    sec --> inner["内部 overflow-auto 区（拿不到有界高度）"]
    classDef breaking fill:#ffdddd,stroke:#e03131,color:#c92a2a
    classDef affected fill:#fff3bf,stroke:#f08c00,color:#e67700
    class main breaking
    class sec affected
    class inner affected
```

<details>
<summary>精确层：涉及的容器与滚动区</summary>

- `src/gui/src/AppShell.tsx:76` — `<main class="min-w-0 flex-1 overflow-auto">`，根因所在。
- `src/gui/src/pages/SpecReview.tsx:268` 根 `section flex min-h-0 flex-1 flex-col`；:291 双列容器 `flex min-h-0 flex-1`；:389 文件列表 `min-h-0 flex-1 overflow-auto`；:457 review.md `flex-1 overflow-auto`。内部滚动结构已就绪，仅缺上游有界高度。
- `src/gui/src/pages/Home.tsx:131` 根 `section overflow-y-auto p-4`（自带滚动，非 flex-1）；`src/gui/src/pages/SpecAgentLogs.tsx:34` 根 `section flex min-h-0 flex-1 flex-col`，日志列表段无 overflow，依赖页面级滚动。
- `src/gui/src/__e2e__/body-no-overflow.spec.ts` 校验首页 `body` 不产生垂直溢出，改动不得破坏该约束。

</details>

### 3.2 spec 相关页面导航与 header

三个 spec 页面各自有一套 header，均把 specId 塞进标题/返回链接，无统一面包屑：

- `SpecDetail`：header 内 `<code>{s().id}</code>`（:232）与文档正文 `# 标题`、以及待加的面包屑三重重复；summary `<p>`（:236）与其下操作按钮区 `<div>`（:240）在 `flex flex-col` 中无间距，贴得过近。
- `SpecReview`：header 用 `ArrowLeft` 返回链接 + `<h1>Review · {{id}}</h1>`（:279），id 冗余。
- `SpecAgentLogs`：header 用文字返回链接 + `<h1>执行日志 · {{id}}</h1>`（:41）。

三页均无 `Breadcrumb` 组件，`components/` 下不存在可复用面包屑。

### 3.3 追加任务弹窗定位

`AppendTaskDialog` 以按钮为锚点定位，但锚的是**右边缘**并让弹窗向左展开：`setPos({ left: rect.right })` 后样式用 `right: calc(100vw - left)`，弹窗宽 `w-96`(384px) 会从按钮右缘向左延伸 384px，按钮偏左或视口较窄时溢出到页面左侧边界之外，且视觉上不在按钮「正下方」。

```mermaid
flowchart LR
    open["props.open 变 true"] --> anchor["读取 anchorEl rect"]
    anchor --> pos["setPos 记录 left 为 rect.right"]
    style2["样式 right 为 calc 100vw 减 left"]
    pos --> style2
    style2 --> bug["弹窗右缘贴按钮右缘，向左展开 384px，溢出左边界"]
    classDef breaking fill:#ffdddd,stroke:#e03131,color:#c92a2a
    class bug breaking
```

<details>
<summary>精确层：定位代码</summary>

- `src/gui/src/components/AppendTaskDialog.tsx:37-38` — `const rect = anchor.getBoundingClientRect(); setPos({ top: rect.bottom + 8, left: rect.right })`。
- 同文件 :95-98 — `style={ pos() ? { top: ..px, right: 'calc(100vw - ${left}px)' } : undefined }`。
- 弹窗宽度：:92 `w-96 max-w-[calc(100vw-2rem)]`。
- 锚点按钮：`src/gui/src/pages/SpecDetail.tsx:255-263` 追加任务按钮 `ref={appendBtnEl}`。

</details>

## 4. 技术实现方案

按三处 bug 独立修复，改动集中在 `src/gui` 前端，无 Service / API 改动。

### 4.1 Bug 1：review 页弹性占满、内部独立滚动

将 `AppShell` 的 `<main>` 由「块级滚动容器」改为「flex column 容器」，让页面根 `section` 的 `flex-1 + min-h-0` 高度约束链贯通，从而 review 页内部两个 `overflow-auto` 区各自独立滚动、`<main>` 不再产生页面级滚动。保留 `overflow-auto` 作为不自管滚动页面（Home 自带滚动、AgentLogs 依赖页面滚动）的兜底，避免回归。

```mermaid
flowchart TB
    main["main flex min-h-0 min-w-0 flex-1 flex-col overflow-auto"] --> sec["review section flex-1 min-h-0（撑满 main）"]
    sec --> cols["双列 flex min-h-0 flex-1"]
    cols --> files["文件列表 min-h-0 overflow-auto（独立滚动）"]
    cols --> md["review.md flex-1 overflow-auto（独立滚动）"]
    classDef ok fill:#d3f9d8,stroke:#2f9e44,color:#2b8a3e
    class main,sec,files,md ok
```

- 仅改 `src/gui/src/AppShell.tsx:76`：`class="min-w-0 flex-1 overflow-auto"` → `class="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto"`。
- Home 根 section 自带 `overflow-y-auto`、AgentLogs 依赖兜底 `overflow-auto`，`<main>` 仍可整体滚动，`body-no-overflow` e2e 不受影响。

### 4.2 Bug 2：spec 面包屑 + detail header 清理 + summary 间距

新增通用 `Breadcrumb` 组件（`src/gui/src/components/Breadcrumb.tsx`），接收 `items: { label, href? }[]`，最后一段为当前页（无链接）。三个 spec 页在 header 顶部接入：

- 详情页：`需求列表 > {specId}`（specId 为当前段，无链接）。
- review 页：`需求列表 > {specId}（链接回详情）> Review`。
- 执行日志页：`需求列表 > {specId}（链接回详情）> 执行日志`。

`需求列表` 段链接到项目 spec 列表（`projectHref('specs')` 或项目根）。同时：

- 详情页 header 移除 `<code>{s().id}</code>`（与面包屑、正文标题重复）。
- review / 日志页移除原 `ArrowLeft`/文字返回链接与带 id 的 `<h1>`，由面包屑承载导航与页面上下文（review.md / agentLogs 渲染区、summary 保留）。
- 详情页操作按钮区 `<div>`（SpecDetail.tsx:240）增加上边距 `mt-2`，与 summary 拉开一点距离。

新增 i18n：`breadcrumb.specList`（'需求列表' / 'Spec List'）；面包屑末段复用现有 `specDetail.review`、`specDetail.agentLogs`。

```mermaid
classDiagram
    class Breadcrumb {
      +items: BreadcrumbItem[]
    }
    class BreadcrumbItem {
      +label: string
      +href?: string
    }
    Breadcrumb --> BreadcrumbItem
    class SpecDetail { 面包屑: 列表>id ; 移除 code#id ; 操作区 mt-2 }
    class SpecReview { 面包屑: 列表>id>Review ; 移除 h1#id }
    class SpecAgentLogs { 面包屑: 列表>id>日志 ; 移除 h1#id }
    Breadcrumb <.. SpecDetail
    Breadcrumb <.. SpecReview
    Breadcrumb <.. SpecAgentLogs
    classDef affected fill:#fff3bf,stroke:#f08c00,color:#e67700
    class SpecDetail:::affected
    class SpecReview:::affected
    class SpecAgentLogs:::affected
```

<details>
<summary>精确层：Breadcrumb 组件与接入点</summary>

- 新文件 `src/gui/src/components/Breadcrumb.tsx`：solid `Component<{ items: { label: string; href?: string }[] }>`，用 `@solidjs/router` 的 `A` 渲染带 `href` 的段，`lucide-solid` 的 `ChevronRight` 作分隔符，末段纯文本；样式沿用 `text-sm text-muted-foreground`，当前段 `text-foreground`。
- `SpecDetail.tsx`：header 顶部插入面包屑；删除 :232 `<code>`；:240 操作区 div 加 `mt-2`。
- `SpecReview.tsx`：替换 :271-283 返回链接 + `<h1>` 为面包屑（`需求列表 > id(链接) > Review`），保留 summary 与 lastReview。
- `SpecAgentLogs.tsx`：替换 :38-41 返回链接 + `<h1>` 为面包屑。
- `src/gui/src/i18n/zh-CN.ts` 与 `en.ts` 新增 `breadcrumb: { specList }`。
- `需求列表` 段 href：复用 `projectHref('specs')`（Home 路由，见 `home.specList='需求列表'`）。

</details>

### 4.3 Bug 3：追加任务弹窗定位到按钮正下方

把锚点从「右缘 + 向左展开」改为「左缘对齐按钮 + 视口夹取」，弹窗落在按钮正下方且不越界：

- `setPos` 改为记录 `left: rect.left`，并在 JS 内夹取：`left = max(16, min(rect.left, innerWidth - 384 - 16))`（384 = `w-96`，16 = 1rem 边距）。
- 样式由 `right: calc(100vw - left)` 改为直接 `left: ${clampedLeft}px`。

```mermaid
flowchart LR
    open["props.open 变 true"] --> rect["读取 anchor rect"]
    rect --> clamp["left 夹取到 16 与 innerWidth 减 384 减 16 之间"]
    clamp --> style3["样式 top 为 rect.bottom 加 8，left 为夹取值"]
    style3 --> ok["弹窗在按钮正下方，两侧不越界"]
    classDef okc fill:#d3f9d8,stroke:#2f9e44,color:#2b8a3e
    class ok okc
```

<details>
<summary>精确层：AppendTaskDialog 定位改动</summary>

- `src/gui/src/components/AppendTaskDialog.tsx:37-38`：改为读取 rect 后 `const width = 384; const left = Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)); setPos({ top: rect.bottom + 8, left })`。
- 同文件 :95-98 style：`pos() ? { top: '${pos()!.top}px', left: '${pos()!.left}px' } : undefined`。
- 保留 `max-w-[calc(100vw-2rem)]` 兜底，`w-96` 宽度常量与夹取的 384 保持一致。

</details>

### 4.4 验证方式

- 单元/构建：`pnpm -C src/gui build` 或仓库既有 `tsc --noEmit`（若配置）通过。
- e2e：`src/gui/src/__e2e__/append-task.spec.ts`、`body-no-overflow.spec.ts` 通过；必要时补断言。
- 手动：review 页无页面级滚动条、文件列表与 review.md 各自独立滚动；三个 spec 页面包屑正确、详情页无重复 id、summary 与按钮有间距；窄视口下追加任务弹窗在按钮正下方且不越界。

## 5. 待确认问题

_暂无_

## 6. 任务清单

- [x] 修改 src/gui/src/AppShell.tsx main 容器为 flex 列布局（验收：class 含 flex min-h-0 flex-1 flex-col overflow-auto）
- [x] 新增 src/gui/src/components/Breadcrumb.tsx 通用面包屑组件（验收：接收 items 数组，末段无链接，用 ChevronRight 分隔）
- [x] 在 SpecDetail 接入面包屑并移除 header 中 code#specId、操作区加 mt-2（验收：无 `<code>{s().id}</code>`，操作区 div 含 mt-2，面包屑为 需求列表>id）
- [x] 在 SpecReview 用面包屑替换返回链接与带 id 的 h1（验收：面包屑为 需求列表>id>Review，无 review.heading 的 h1）
- [x] 在 SpecAgentLogs 用面包屑替换返回链接与带 id 的 h1（验收：面包屑为 需求列表>id>执行日志）
- [x] 在 i18n zh-CN.ts 与 en.ts 新增 breadcrumb.specList（验收：两文件均含该键）
- [x] 修改 AppendTaskDialog 定位为按钮左缘对齐并视口夹取（验收：setPos 用 rect.left 夹取，style 用 left 而非 right）
- [x] 运行 GUI 构建/类型检查（验收：pnpm -C src/gui 构建或 tsc 无报错）
- [x] 同步更新 append-task e2e 断言为「正下方+不越界」以匹配新定位（验收：assertion 校验 below/left/no-overflow）
- [ ] [manual] 浏览器人工核验三处 bug 修复效果（验收：review 页无页面滚动条+内部独立滚动、面包屑正确、弹窗在按钮正下方不越界）

## 7. 执行记录

- Bug 1：`src/gui/src/AppShell.tsx:76` main 由 `min-w-0 flex-1 overflow-auto` 改为 `flex min-h-0 min-w-0 flex-1 flex-col overflow-auto`，使页面根 section 的 `flex-1 + min-h-0` 高度链贯通；review 页文件列表与 review.md 各自独立滚动，overflow-auto 兜底不自管滚动的页面。验证：GUI 构建通过。
- Bug 2：新增 `src/gui/src/components/Breadcrumb.tsx`（items 数组，末段纯文本，ChevronRight 分隔）；`SpecDetail` 顶部接入面包屑（需求列表>id）、移除 `<code>{s().id}</code>`、操作区 div 加 `mt-2`；`SpecReview`/`SpecAgentLogs` 用面包屑（需求列表>id(链接)>Review｜执行日志）替换原返回链接与带 id 的 h1，并移除随之未用的 `A`、`ArrowLeft` 导入；`i18n/zh-CN.ts`、`en.ts` 新增 `breadcrumb.specList`。验证：GUI 构建通过。
- Bug 3：`src/gui/src/components/AppendTaskDialog.tsx` 定位改为按钮左缘对齐并夹取 `Math.max(16, Math.min(rect.left, innerWidth-384-16))`，style 由 `right: calc(100vw - left)` 改为 `left`，弹窗落在按钮正下方且两侧不越界。验证：GUI 构建通过。
- 测试：同步改写 `src/gui/src/__e2e__/append-task.spec.ts` 定位断言（旧断言校验右缘对齐，与新需求冲突），改为校验「在按钮下方 + 左缘不在按钮右侧 + 两侧不越出视口」。
- 构建：`pnpm run build`（CLI+GUI）成功，无类型/打包错误（`tsc --noEmit` 报的 `@/lib/cn` 系既有路径别名问题，vite 构建正常解析，与本次改动无关）。
- e2e 未能在当前环境运行：Playwright webServer 依赖隔离的单项目 `.tmp-e2e`，但本机全局 YorZ 项目注册表含 4 个真实项目，导致 `/specs/:id`（无 projectId 前缀）无法自动跳转到种子项目，页面元素定位失败；未改动的 `body-no-overflow` 用例同样失败，证明属环境隔离问题而非代码缺陷。修复需改动用户全局注册表（移除真实项目），不擅自执行。留待 `[manual]` 浏览器人工核验。
- 收尾：非 manual 任务全部完成，待确认问题为空、无批注、无追加任务 `[open]`，标记 done（`[manual]` 浏览器核验项按规则忽略）。
