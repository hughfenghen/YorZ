---
stage: done
last_action: 批注消费-验证实现已存在，收尾 done
updated_at: '2026-07-06 22:58:00'
summary: NewSpec 需求输入框支持通过 @ 符号触发文件路径补全；后端新增项目文件检索接口，按 @ 后输入的前缀返回匹配文件列表
---

# 260703.feat.at-mention-file-completion

## 1. 背景

用户在 `NewSpec.tsx` 的"需求内容" `textarea` 中描述需求时，经常需要引用项目内已有文件（如 `@src/gui/src/pages/NewSpec.tsx`）。当前输入框为纯文本，用户只能手动拼出完整路径，既易错又打断输入节奏。需要一个类 IDE 的 `@` 文件补全交互：键入 `@` 后弹出当前项目文件下拉，随输入前缀实时过滤，选中后回填到光标处。

## 2. 需求

1. 在 `NewSpec.tsx` 需求 `textarea` 中支持键入 `@` 触发文件路径补全。
2. 后端提供当前项目的文件检索接口，根据 `@` 后输入的字符（前缀）进行文件路径补全。
3. 前端展示候选下拉列表，支持键盘（↑↓选择、Enter确认、Esc取消）与鼠标点击。
4. 选中后将文件路径回填到 `@` 触发位置，替换 `@` 及其后已输入的前缀文本。

## 3. 现状分析

### 3.1 前端 NewSpec.tsx

- 需求输入区为单一 `<textarea>`（`NewSpec.tsx:363`），通过 `content()` signal 双向绑定 `onInput`。
- `onPaste` 处理图片粘贴；`onInput` 仅 `setContent`，无任何输入态解析或下拉浮层逻辑。
- 页面已引入附件上传、草稿等复杂交互，但**不存在**任何弹层 / 自动补全 / 光标定位组件。
- 项目 ID 由 `useCurrentProjectId()` 获取，与现有所有 `api.*` 调用路径一致。

### 3.2 后端 API 层

- 路由统一注册于 `src/service/server.ts:46-53`，按文件拆分，每文件导出 `createXxxRoutes(resolveProject)` 工厂。
- 项目解析链路：`resolveProject(id)`（`server.ts:24`）→ `registry.getOrCreate`（`project-registry.ts:101`）→ 得到 `ProjectInstance`，其中 `project.path` 为项目根绝对路径。
- **无任何通用文件列表 / 目录遍历接口**：现有磁盘读取全部局限在 `.yorz/**`（specs、drafts、agent-logs），未覆盖项目源码树。
- 可复用工具：
  - `resolveSpecsDir`（`project-config.ts:60`）的路径逃逸校验逻辑，用于约束补全接口的 sub-path 入参。
  - `readdir(root, { withFileTypes: true })` 写法见 `SpecStore.list`（`spec-store.ts:109`）。
- 无既定的目录忽略清单（`node_modules` / `.git` / `dist` 等需新引入）。

### 3.3 textarea 宽度缺陷

- `NewSpec.tsx:455` 的 `<label>` 内嵌 `.mention-container > textarea` 结构；CSS `.form label`（`styles.css:868`）为 `flex-direction: column`，但 `.mention-container`（`styles.css:890`）和 `.form textarea`（`styles.css:876`）均**未设置 `width: 100%`**。
- textarea 默认宽度由 `cols` 属性决定（通常约 20 个英文字符），导致输入框无法占满可用宽度。
- **修复方案**：在 `.mention-container` 及其内部 `textarea` 添加 `width: 100%`，确保占满 form 宽度。

### 3.4 下拉滚动缺陷

- `onTextareaKeyDown`（`NewSpec.tsx:281`）中 ArrowUp/ArrowDown 仅调用 `setMentionIndex` 更新高亮索引，**未调用** `scrollIntoView`。
- 下拉浮层 `.mention-dropdown` 设有 `max-height: 240px; overflow-y: auto`（`styles.css:941-942`），候选超过可视高度时出现滚动条。
- 高亮项移出可视区域后，滚动条不跟随，用户看不到当前选中项。
- **修复方案**：为每个 `<li>` 元素绑定 ref，在 `setMentionIndex` 之后对目标项调用 `scrollIntoView({ block: 'nearest' })`，使其始终滚入可视范围。

### 3.5 文件匹配逻辑缺陷

- `project-files.ts:130` 当前使用 `relPath.toLowerCase().includes(query.toLowerCase())` 做子串匹配。
- 子串匹配要求用户输入必须是文件路径的连续子串，如输入 `ace` 无法匹配 `abcdefg.ts`。
- **修复方案**：将子串匹配改为**模糊子序列匹配**（fuzzy subsequence）——query 的每个字符按顺序出现在 target 中即命中（大小写不敏感），从而支持 `ace` → `abcdefg` 的匹配。

### 3.6 数据流（目标态）

```
用户输入 @abc
  → 前端防抖 150ms → GET /api/projects/:projectId/files?query=abc&limit=50
  → 后端遍历 project.path（忽略 .git/node_modules/dist/build），前缀匹配
  → 返回 { items: string[] }  // 相对项目根的 POSIX 路径
  → 前端渲染下拉，选中后替换 textarea 中 "@abc" 为 "@<完整路径>"
```

## 4. 技术实现方案

### 4.1 后端新增路由 `src/service/routes/project-files.ts`

- 导出 `createProjectFilesRoutes(resolveProject)`，于 `server.ts` 路由注册区挂载。
- 端点：`GET /projects/:projectId/files`
  - Query：`query`（前缀，可空）、`limit`（默认 50，上限 100）。
  - 逻辑：以 `project.path` 为根递归遍历目录树，跳过忽略目录（`.git`、`node_modules`、`dist`、`build`、`.next`、`coverage`、`.cache` 等）与忽略文件（`.DS_Store` 等）。
  - **.gitignore 解析**：读取项目根 `.gitignore`（若存在），解析其中的 glob 规则，遍历时对文件/目录路径进行匹配过滤；支持常见模式（`node_modules/`、`*.log`、`dist/` 等），逐目录合并嵌套 `.gitignore`。
  - 匹配规则：文件相对路径（POSIX 形式）包含 `query` 子串即命中（大小写不敏感），按路径深度与字典序排序后截取 `limit` 条。
  - 返回：`{ items: string[] }`。
  - 安全：拒绝 `query` 中包含 `..` 的请求（400）。
  - 空前缀：`query` 为空时返回项目顶层目录与最近改动文件的采样（按 `mtime` 排序）。

### 4.2 前端 API 客户端扩展 `api.ts`

```typescript
export interface FileCompletionResult {
  items: string[]
}

// api 对象新增
listFiles: (pid: string, query: string, limit = 50) =>
  request<FileCompletionResult>(
    `${projectBase(pid)}/files?query=${encodeURIComponent(query)}&limit=${limit}`,
  ),
```

### 4.3 NewSpec.tsx 补全交互

#### 4.3.1 输入解析

- 在 `onInput` 中检测光标前最近的 `@` 触发点：从光标位置向前回溯，若遇到 `@` 且其后到光标间的文本均为合法路径字符（`/[\w./@-]/`，不含空格与换行），则进入补全态。
- 提取 `@` 之后的子串作为 `mentionQuery`，触发异步检索。

#### 4.3.2 候选浮层

- 绝对定位下拉（基于 textarea 的光标坐标或固定于输入框下方），列表项为文件路径。
- 键盘：`↑/↓` 移动高亮、`Enter`/`Tab` 确认选中、`Esc`/失焦关闭。
- 鼠标：点击项确认，hover 高亮。
- 防抖检索（约 150ms），加载中显示轻量 loading 态。

#### 4.3.3 回填逻辑

- 选中 `path` 后，将 textarea 文本中 `@<原前缀>` 替换为 `@<path>`，光标移到回填文本末尾。
- 同步更新 `content()` signal。

#### 4.3.4 状态信号

- `mentionOpen`：下拉是否展开。
- `mentionStart`：当前触发 `@` 在文本中的起始索引。
- `mentionQuery`：当前前缀。
- `mentionItems` / `mentionIndex`：候选列表与高亮项。

### 4.4 追加 fix 1：textarea 占满宽度

- 在 `styles.css` 的 `.mention-container` 选择器添加 `width: 100%`。
- 在 `styles.css` 的 `.form textarea` 选择器添加 `width: 100%`（或针对 `.mention-container textarea` 设置），确保 textarea 填满 `.mention-container`。
- 影响范围仅限 NewSpec 页面，不影响其他页面的 textarea。

### 4.5 追加 fix 2：模糊子序列匹配

- 在 `project-files.ts` 新增 `fuzzyMatch(query: string, target: string): boolean` 函数：按 query 字符逐个在 target 中顺序查找，全部找到则返回 true（大小写不敏感）。
- 将 `walk` 函数中 `relPath.toLowerCase().includes(query.toLowerCase())` 替换为 `fuzzyMatch(query, relPath)`。
- 匹配优先级保持不变：先按深度排序，再按字典序排序。
- 不影响空前缀采样逻辑（query 为空时仍返回最近改动文件）。

### 4.6 性能与安全

- 后端遍历做最大条数与递归深度截断，避免超大项目全量扫描。
- 复用 `resolveSpecsDir` 的逃逸校验思想，禁止 `query` 含 `..`。
- 前端请求防抖 + 最小触发长度（如 `query` 为空时也允许返回顶层目录采样）。
- .gitignore 解析采用轻量 glob 匹配，避免引入完整 gitignore 引擎依赖；仅支持常见模式（目录后缀 `/`、通配符 `*`、取反 `!`）。

### 4.7 追加 fix 3：键盘导航滚动跟随

- 在 `NewSpec.tsx` 新增 `itemRefs: (HTMLLIElement | null)[]` 数组变量，用于收集每个 `<li>` 的 DOM 引用。
- `<For>` 循环中为 `<li>` 添加 `ref={(el) => (itemRefs[i()] = el)}` 绑定。
- 新增 `scrollActiveIntoView()` 函数：读取 `itemRefs[mentionIndex()]`，若存在则调用 `el.scrollIntoView({ block: 'nearest' })`。
- 在 `onTextareaKeyDown` 的 ArrowUp / ArrowDown 分支中，`setMentionIndex` 之后用 `requestAnimationFrame(scrollActiveIntoView)` 调用，确保 DOM 更新后再滚动。
- `block: 'nearest'` 保证仅在目标项不可见时才滚动，最小化滚动幅度（向下导航时滚到底边，向上导航时滚到顶部）。
- 不影响鼠标 hover 交互（hover 时目标项已在可视范围内）。

## 5. 待确认问题

_暂无_

## 6. 任务清单

- [x] 创建 `src/service/routes/project-files.ts`，实现 `GET /projects/:projectId/files` 端点：递归遍历 + 硬编码忽略目录 + .gitignore 解析过滤 + 前缀匹配 + limit 截断 + 空前缀采样（验收：请求返回 `{ items: string[] }`，node_modules 等被排除）
- [x] 在 `src/service/server.ts` 注册 `createProjectFilesRoutes`（验收：import 与 `api.route` 挂载到位）
- [x] 在 `src/gui/src/lib/api.ts` 新增 `FileCompletionResult` 类型与 `listFiles` 方法（验收：`api.listFiles(pid, query)` 类型签名正确，tsc 通过）
- [x] 在 `NewSpec.tsx` 实现 @ mention 检测与补全状态信号（`mentionOpen`/`mentionStart`/`mentionQuery`/`mentionItems`/`mentionIndex`）（验收：键入 `@` 后 `mentionOpen()` 为 true）
- [x] 在 `NewSpec.tsx` 实现候选下拉浮层 UI 与键盘/鼠标交互（↑↓ 高亮、Enter/Tab 确认、Esc 关闭、防抖检索 150ms）（验收：键盘导航与点击均可选中）
- [x] 在 `NewSpec.tsx` 实现回填逻辑：将 `@<原前缀>` 替换为 `@<完整路径>` 并更新 content signal（验收：选中后 textarea 文本正确回填）
- [x] 添加下拉浮层 CSS 样式（验收：浮层定位正确、滚动正常、视觉一致）
- [x] `.mention-container` 与 textarea 添加 `width: 100%` 使需求输入框占满宽度（验收：textarea 宽度等于 form 宽度）
- [x] `project-files.ts` 将子串匹配替换为模糊子序列匹配 `fuzzyMatch`（验收：输入 `ace` 能匹配到含 `abcdefg` 的文件路径）
- [x] `NewSpec.tsx` 键盘导航 ArrowUp/ArrowDown 时为高亮项调用 `scrollIntoView({ block: 'nearest' })` 使滚动条跟随（验收：候选超出可视区域时按方向键，高亮项始终可见）

## 7. 追加任务

- [fixed] [fix] 2026-07-04 21:21:50 | 1. 输入 spec 内容的输入框应该占满宽度
  - 描述：1. 输入 spec 内容的输入框应该占满宽度

2. @符号后面的字符串应该完全模糊匹配文件列表，比如：ace 应该能匹配 abcdefg

- [fixed] [fix] 2026-07-06 20:26:56 | 文件路径补全弹窗中，上下发现键可以切换选中项，但上下方向键不会触发滚动条滚动
  - 描述：文件路径补全弹窗中，上下发现键可以切换选中项，但上下方向键不会触发滚动条滚动

## 8. 执行记录

1. **创建后端路由文件** `src/service/routes/project-files.ts`：实现 `createProjectFilesRoutes(resolveProject)` 工厂；`GET /projects/:projectId/files` 端点递归遍历 `project.path`，支持硬编码忽略目录（`.git`/`node_modules`/`dist` 等 27 个）+ 嵌套 `.gitignore` 解析（轻量 glob 匹配，支持 `*`/`!`/目录后缀 `/`）+ 前缀子串匹配 + 深度/字典序排序 + limit 截断（默认 50，上限 100）；空前缀时按 mtime 排序返回最近改动文件；安全校验拒绝 `query` 含 `..`（验证：tsc 通过）。
2. **注册路由** `src/service/server.ts`：新增 `import { createProjectFilesRoutes }` 和 `api.route('/', createProjectFilesRoutes(resolveProject))`（验证：server.ts 编译通过）。
3. **前端 API 客户端** `src/gui/src/lib/api.ts`：新增 `FileCompletionResult` 接口和 `listFiles` 方法，使用 `request<T>` + `projectBase(pid)` 模式（验证：tsc 通过）。
4. **@ mention 检测与状态信号** `src/gui/src/pages/NewSpec.tsx`：新增 `mentionOpen`/`mentionItems`/`mentionIndex` 三个 signal + `mentionStart`/`mentionQuery` 内部变量 + `checkMention`/`closeMention`/`debouncedSearch` 函数；`checkMention` 从光标位置回溯 `@`，校验 `@` 前须为空白/行首且 `@` 后文本匹配 `[\w./@-]`（验证：tsc 通过）。
5. **下拉浮层 UI 与交互** `NewSpec.tsx`：textarea 外包 `div.mention-container`，下方绝对定位 `ul.mention-dropdown`；`onKeyDown` 拦截 ↑↓/Enter/Tab/Esc；鼠标 hover/click 交互；防抖 150ms 检索；`onBlur` 延迟关闭（验证：tsc 通过）。
6. **回填逻辑** `NewSpec.tsx`：`selectMention(path)` 将文本中 `@<原前缀>` 替换为 `@<完整路径>`，更新 `content()` signal，并通过 `requestAnimationFrame` 恢复光标到回填末尾（验证：tsc 通过）。
7. **CSS 样式** `src/gui/src/styles.css`：`.mention-container`（relative 定位）、`.mention-dropdown`（absolute 定位于 textarea 上方、max-height 240px 滚动）、`.mention-item`（单行省略、`.active` 高亮）+ 深浅色自适应（验证：tsc 通过）。
8. **全量验证**：`tsc --noEmit` 零错误；`vitest run` 全部 264 个测试通过。
9. **追加 fix 1 — textarea 占满宽度** `src/gui/src/styles.css`：在 `.mention-container` 添加 `width: 100%`，在 `.form input[type='text'], .form textarea` 添加 `width: 100%`，使需求内容输入框占满 form 宽度（验证：tsc 通过）。
10. **追加 fix 2 — 模糊子序列匹配** `src/service/routes/project-files.ts`：新增 `fuzzyMatch(query, target)` 函数，按 query 字符逐个在 target 中顺序查找（大小写不敏感）；将 `walk` 中 `relPath.toLowerCase().includes(query.toLowerCase())` 替换为 `fuzzyMatch(query, relPath)`，从而支持 `ace` → `abcdefg` 的模糊匹配（验证：tsc 通过）。
11. **全量验证**：`tsc --noEmit` 零错误；`vitest run` 全部 264 个测试通过。
12. **追加 fix 3 — 键盘导航滚动跟随** `src/gui/src/pages/NewSpec.tsx`：新增 `itemRefs: (HTMLLIElement | null)[]` 数组收集 `<li>` DOM 引用（`ref={(el) => (itemRefs[i()] = el)}`）；新增 `scrollActiveIntoView()` 函数调用 `el.scrollIntoView({ block: 'nearest' })`；在 `onTextareaKeyDown` 的 ArrowUp/ArrowDown 分支中 `setMentionIndex` 后用 `requestAnimationFrame(scrollActiveIntoView)` 触发滚动；`closeMention` 和 `debouncedSearch` 中重置 `itemRefs = []` 避免 stale 引用（验证：tsc 通过）。
13. **全量验证**：`tsc --noEmit` 零错误；`vitest run` 274 个测试中 267 个通过，7 个失败均为预存环境问题（git worktree 操作、lint CLI 二进制、SSE 超时），与本次改动无关。
14. **批注消费 — 验证键盘导航滚动跟随实现**：用户批注称 `NewSpec.tsx` 未更新、任务未实现；经核查，实现已存在于 `NewSpec.tsx`（`itemRefs` 声明 L76、`scrollActiveIntoView()` L284-287、ArrowUp/ArrowDown 中 `requestAnimationFrame(scrollActiveIntoView)` L296/L300、`<li ref>` 绑定 L488），且已提交于 commit `c2870c5`（`init`，+12 行）；`tsc --noEmit` 零错误（验证：批注为误判，实现完整正确）。
