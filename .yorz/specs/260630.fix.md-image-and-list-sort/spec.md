---
stage: execute
last_action: 任务清单全部完成，bug 1 / bug 2 按 4.3 切分为两次提交
updated_at: 2026-06-30
summary: 修复 GUI 渲染 spec markdown 时图片加载 404（attachments 路径缺 projectId 前缀），并把 spec 列表的 updated_at 排序精度提升到秒级以让同日多次更新按真实先后顺序排列。
---

## 1. 背景

GUI 在阅读 spec 文档时出现两个明显缺陷：

1. **markdown 图片加载失败**：spec 正文里通过 `![需求描述截图 1](attachments/image-a1b2.png)` 引用的 attachments 图片在 SpecDetail 页面无法渲染，浏览器请求返回 404。
2. **列表按"天"排序、同日顺序不可控**：`Home.tsx` 的需求列表按 `updated_at` 降序排，但 frontmatter 当前是 `YYYY-MM-DD`，同一天写入的多条 spec 之间排序只能靠字典序兜底，无法反映真实的最近更新顺序。用户希望精确到秒，并接受用第三方库或自行解析 frontmatter 取 `updated_at`。

## 2. 需求

来自用户的原始描述（仅做轻度排版）：

1. GUI 中渲染 markdown 格式 的 spec 文档，HTML 中无法渲染图片，如 `[需求描述截图 1](attachments/image-a1b2.png)`。
2. Spec 文档的更新时间应该精确到秒，在列表页按秒降序；可以使用第三方工具库或者自己解析 md 的 frontmatter，获取 `updated_at`。当前示例 frontmatter：

```yaml
---
stage: execute
last_action: 完成 CSS 改动并通过构建与单测
updated_at: 2026-06-18
summary: 调整全局 Agent 输出面板的尺寸与换行：…
---
```

## 3. 现状分析

### 3.1 markdown 图片渲染链路（bug 1）

调用链：

```mermaid
flowchart LR
  A[SpecDetail.tsx] -->|renderMarkdown(body, { specId })| B[lib/markdown.ts]
  B -->|rewriteHrefIfAttachment| C[/api/specs/:id/attachments/:name/]
  D[实际后端路由] --> E[/api/projects/:projectId/specs/:id/attachments/:name/]
  C -. 404 .- E
```

关键代码位置：

- `src/gui/src/lib/markdown.ts:27-35`：`rewriteHrefIfAttachment(href, specId)` 把 `attachments/<name>` 改写为 `/api/specs/${specId}/attachments/${name}`，**完全没有 projectId 段**。
- `src/gui/src/lib/markdown.ts:37-45`：image 渲染规则从 env 中读 `specId` 并调用上述函数。
- `src/service/routes/specs.ts:72`：后端真实路由是 `/projects/:projectId/specs/:id/attachments/:name`，挂在 `/api` 前缀下。
- `src/gui/src/lib/api.ts:298`：`specAttachmentUrl(pid, specId, name)` 正确返回 `${projectBase(pid)}/specs/.../attachments/...`，可作为参考。
- `src/gui/src/pages/SpecDetail.tsx:257`：唯一的 `renderMarkdown` 调用站点，只传了 `{ specId: s().id }`，没把当前 `projectId()` 透传下去。

结论：根因是 markdown 渲染层早于多项目化时落地，URL 改写仍走单项目假设；图片自然 404。`SpecReview.tsx` 暂时没有渲染 markdown 主体，本次不受影响。

### 3.2 列表更新时间精度（bug 2）

调用链：

```mermaid
flowchart LR
  Spec[(spec.md frontmatter.updated_at)]
  Spec --> SS[SpecStore.list]
  SS --> API[GET /api/projects/:pid/specs]
  API --> Home[Home.tsx 列表]
  Home -->|排序 key| SS
```

关键代码位置：

- `src/service/spec-store.ts:306-308`：`today()` 返回 `formatDate(now())`，固定为 `YYYY-MM-DD`。
- `src/service/spec-store.ts:199 / 226 / 252 / 274`：`applyQuestionAnswers` / `appendItem` / `appendExecutionLog` / `appendAnnotation` 等所有写入路径，frontmatter.updated_at 都只到天。
- `src/service/spec-store.ts:129`：`items.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))` 直接按字符串字典序比较；同日多条 spec 排序退化为 ID/解析顺序兜底。
- `src/service/spec-store.ts:374-378`：`dateString()` 兼容 `Date` 与 `string`，因为 gray-matter 会把裸 `YYYY-MM-DD` 解析为 `Date`；如果改成带秒的 ISO 字符串，需要确保它仍以字符串形式安全往返。
- `src/service/project-registry.ts:235-252`：`maxSpecUpdatedAt` 也用同样语义算"项目最近更新时间"，本次升级需要同步生效。
- `src/skill/yorz-spec/conventions.md:41`：skill 文档里写明 `updated_at` 不带时间部分；升级方案后此约束需放宽。
- `src/skill/yorz-spec/new-spec.md:24`：新建 spec 流程同样需要同步。
- `src/gui/src/pages/Home.tsx:143`：列表卡片直接展示 `spec.updated_at`，升级后展示格式也要顺带处理（避免日期串里塞个 `T` 看起来奇怪）。

排序失真的两类典型：

1. 同一天用户连续追加多条任务 / 提交多次答复，列表上看到的顺序与实际操作顺序对不上。
2. 跨天但其中一条仍是旧的 `YYYY-MM-DD` 而新写入的是带秒戳，两者在字典序比较下仍可工作（前缀相同），但同日新旧 spec 比较时旧的"看起来更早"反而正确，需要确保兼容路径下行为不退化。

### 3.3 一致性边界

- frontmatter 是 spec.md 的单一真相，Agent 与 service 都会写。任何字段格式调整都必须同步：service 写入侧 + skill 文档侧 + 已存在 spec 的兼容读取侧。
- 多项目场景下，SpecDetail 已经从路由参数拿到 `projectId`，但 markdown 渲染层没承接，是个典型"接口缺一个参数"的修复，无需引入新状态。

## 4. 技术实现方案

### 4.1 bug 1：把 projectId 传进 markdown 渲染层

最小修复半径，集中在前端：

1. **扩展 `RenderOptions`**：在 `src/gui/src/lib/markdown.ts` 中给 `RenderOptions` 增加 `projectId?: string`。
2. **改写函数签名**：`rewriteHrefIfAttachment(href, specId, projectId)` —— 当 `projectId` 提供时，拼出 `/api/projects/${encodeURIComponent(projectId)}/specs/${encodeURIComponent(specId)}/attachments/${encodeURIComponent(name)}`；若 `projectId` 缺失则保持现状（不重写、并在 dev 模式下 `console.warn`），确保单测里调用方不会被静默坑。
3. **env 透传**：`image` / `link_open` 渲染规则从 env 同时读取 `specId` 与 `projectId`，向 `rewriteHrefIfAttachment` 透传。
4. **`renderMarkdown` 签名**：把 `opts.projectId` 加入 env，写法保持现有可选风格。
5. **调用站点**：`src/gui/src/pages/SpecDetail.tsx:257` 改为 `renderMarkdown(s().body, { specId: s().id, projectId: projectId() })`；当 `projectId()` 为空时仍可以渲染，只是图片 attachments 拿不到（沿用旧行为，不阻断阅读）。
6. **测试**：扩展 `src/gui/src/lib/__tests__/markdown.test.ts`：
   - 给定 `{ specId, projectId }`，输出含 `/api/projects/${pid}/specs/${sid}/attachments/${name}`。
   - 仅给定 `specId`、缺 `projectId`：保留原始 `attachments/...` 路径（不再生成错误的旧 URL）。
   - `link_open`（非图片链接）同样要走带 projectId 的路径并保留 `target=_blank rel=noopener noreferrer`。

### 4.2 bug 2：updated_at 升级为秒级

目标：让列表排序按真实的"最近更新"顺序排列，并保留对已有 `YYYY-MM-DD` 数据的向后兼容。

#### 4.2.1 frontmatter 字段格式

按用户决策采用 **自定义 `YYYY-MM-DD HH:mm:ss`（无 T 无时区）** 形式，例如 `2026-06-30 15:42:07`，关键约束：

- 字符串字典序比较仍单调（前缀 `YYYY-MM-DD` 与旧值一致），同时秒级精度可比；
- 不带时区，沿用本地时间观；跨机器协作时上下文由项目自身约束，避免引入解析复杂度；
- YAML / gray-matter 对该形态的裸值仍可能解析为 `Date`（YAML 1.1 timestamp 兼容空格分隔）—— 因此**写入侧统一加单引号**，例如 `updated_at: '2026-06-30 15:42:07'`，确保 gray-matter 重读时为字符串；
- 旧 `YYYY-MM-DD` 数据在被 gray-matter 解析为 `Date` 后由 `dateString()` 兜底回字符串，行为不变。

#### 4.2.2 service 改造点

- `spec-store.ts`：新增 `nowDateTime(): string` 返回 `YYYY-MM-DD HH:mm:ss`（基于本地时间）；把 `today()` 用于 frontmatter 写入的所有 4 处调用替换为 `nowDateTime()`。`todayCompact()` 用于 id 前缀，保持现状不变。
- `formatDate` / `formatDateTime` 现有函数保留：前者仍用于 id 前缀的 `YYMMDD` 上游，后者已用于追加任务的 `stamp`，与本次解耦。
- `normalizeFrontmatter` 中 `dateString()`：
  - 若值是 `Date`（gray-matter 自动解析旧的 `YYYY-MM-DD` 或带空格的 `YYYY-MM-DD HH:mm:ss`）：fallback 到 `formatDate(d)`，保持 `YYYY-MM-DD`，行为不变；
  - 若值是字符串：原样返回，不再额外裁剪 —— 让秒级串透传。
- `serializeSpec`：写入时如果 `fm.updated_at` 含空格或 `:`，YAML 解析器可能误判为 timestamp。**给值加单引号** —— 写作 `updated_at: '2026-06-30 15:42:07'`，确保它在 gray-matter 重读时仍是 string；同时保留无引号的 `YYYY-MM-DD` 旧值兼容路径（不主动迁移，但任何一次写回都会被自然升级为带引号秒级串）。
- `SpecStore.list` 排序逻辑：保留字符串字典序倒序比较；新增 fallback：当两者 `updated_at` 字符串相等或都为空时，按文件 `mtime` 倒序兜底，避免一致键引起的不稳定。
- `project-registry.ts:maxSpecUpdatedAt`：直接复用 `SpecStore.list()` 的 `updated_at`，无需额外改造。

#### 4.2.3 skill 文档同步

- `conventions.md`：把 `时间字段使用 YYYY-MM-DD` 改为「`updated_at` 使用秒级 `YYYY-MM-DD HH:mm:ss`（如 `2026-06-30 15:42:07`，写入时必须加单引号）；为兼容历史 spec，读取时也接受 `YYYY-MM-DD`，但任何写回都必须升级到秒级」。
- `new-spec.md`：新建时的 `updated_at` 例子改为带秒的串。
- 相关测试 fixture（`src/skill/yorz-spec/__tests__/fixtures/*`）输入侧不必动（旧格式兼容），但 `new-spec-skeleton/expect.ts` 等输出断言需更新为秒级校验（基于已注入的 `now`）。

#### 4.2.4 前端展示

按用户决策**列表与详情页统一显示到秒**：

- `Home.tsx:143` 的 `<time>{spec.updated_at}</time>`：通过一个轻量 formatter 把 `YYYY-MM-DD HH:mm:ss` 串原样展示（去除可能的引号），旧的纯日期串保留原样。formatter 不引入额外第三方库（保持现状仅依赖现有 deps）。
- `SpecDetail.tsx:219` 同样的 `<time>` 走同一 formatter，保持一致到秒。
- formatter 行为：若值匹配 `YYYY-MM-DD HH:mm:ss`，直接返回；若仅为 `YYYY-MM-DD`，原样返回；其它形态退回原始字符串，避免在 UI 上抛错。
- 排序无需前端再调整：后端 list 已按字符串字典序倒序排好；前端只负责展示。

#### 4.2.5 兼容与迁移

- **不主动迁移**已有 spec.md（用户决策）。读取兼容（`dateString()` 已能识别 `Date`），任何一次写入都会自然把该 spec 升级到秒级串。
- 测试：
  - `src/service/__tests__/spec-store.test.ts`：新增"同日多次写入，list 顺序按秒降序"；"旧 `YYYY-MM-DD` 与新秒级串共存时排序合理"；"同 `updated_at` 时 `mtime` 倒序兜底"。
  - 现有断言中精确等于 `'updated_at: 2026-06-14'` 的行（spec-store.test.ts:48, 121；spec-drafts-route.test.ts:225, 252；service.test.ts:135）需要把 expected 改为秒级串（由注入的 `now` 决定）；尽量改成"日期前缀"的字符串包含校验，减少未来回归阻力。

### 4.3 提交切分

按改动范围切两次提交，便于回滚：

```mermaid
flowchart LR
  A[Commit 1: fix gui markdown attachments URL\n(markdown.ts + SpecDetail.tsx + 单测)] --> B[Commit 2: feat updated_at 秒级 ISO\n(spec-store + Home 展示 + 测试 + skill 文档)]
```

两个 commit 互不依赖，可单独验证。

## 5. 待确认问题

- 暂无

## 6. 任务清单

- [x] 修改 `src/gui/src/lib/markdown.ts`：给 `RenderOptions` 增加可选 `projectId`，在 image / link_open 渲染规则中从 env 读取并透传；`renderMarkdown` 把 `opts.projectId` 写入 env。验收：单测中含 projectId 时图片 / 链接 href 渲染为 `/api/projects/${pid}/specs/${sid}/attachments/${name}`。
- [x] 修改 `src/gui/src/lib/markdown.ts` 中的 `rewriteHrefIfAttachment`：签名扩展为 `(href, specId, projectId?)`；有 `projectId` 时拼出 `/api/projects/.../specs/.../attachments/...`（值均 `encodeURIComponent`），缺 `projectId` 时保留原始 `attachments/...` 不重写，并在 `import.meta.env.DEV` 下 `console.warn` 一次提示调用方缺参。验收：单测覆盖"有 pid 重写"、"无 pid 保留原值并打 warn"两条路径。
- [x] 修改 `src/gui/src/pages/SpecDetail.tsx:257`：把 `renderMarkdown(s().body, { specId: s().id })` 改为 `renderMarkdown(s().body, { specId: s().id, projectId: projectId() })`。验收：手动打开含 attachments 图片的 spec，HTML `<img src>` 指向 `/api/projects/<pid>/specs/<sid>/attachments/<name>` 且返回 200。
- [x] 扩展 `src/gui/src/lib/__tests__/markdown.test.ts`：新增「同时给 specId+projectId 时 image 重写为带 projectId 的 URL」「仅给 specId 时 image 保留原 `attachments/<name>`」「link_open（非图片链接）在带 projectId 时同样改写并保留 `target=_blank rel=noopener noreferrer`」三类用例。验收：`pnpm test` 全绿（198/198）。
- [x] 在 `src/service/spec-store.ts` 新增 `nowDateTime(): string` 返回本地时间 `YYYY-MM-DD HH:mm:ss`；把 frontmatter 写入路径 `applyQuestionAnswers` / `appendItem` / `appendExecutionLog` / `appendAnnotation`（4 处）+ `create()` 一共 5 处所用的 `today()` 替换为 `nowDateTime()`；id 前缀仍走 `todayCompact()` 不变。
- [x] 修改 `src/service/spec-store.ts` 中的 `normalizeFrontmatter` 与 `dateString()`：若值为 `Date` 仍 fallback 到 `formatDate(d)`（兼容旧 `YYYY-MM-DD` 被 gray-matter 解析为 Date），若值为字符串则原样返回（不裁剪、不补齐）。
- [x] 修改 `src/service/spec-store.ts` 中的 `serializeSpec`：新增 `formatUpdatedAtForYaml`，含空格 / `:` 的 datetime 值输出 `'YYYY-MM-DD HH:mm:ss'`；`YYYY-MM-DD` 旧值保持无引号。
- [x] 修改 `src/service/spec-store.ts` 中 `SpecStore.list` 排序：保留 `updated_at` 字符串字典序倒序；当两者相等或都为空时按文件 `mtime` 倒序兜底。
- [x] 更新 `src/skill/yorz-spec/conventions.md`：`updated_at` 升级为 `YYYY-MM-DD HH:mm:ss`（必须加单引号），读取兼容 `YYYY-MM-DD`。
- [x] 更新 `src/skill/yorz-spec/new-spec.md`：新建 spec 的 `updated_at` 示例改为带单引号的秒级形态。
- [x] 新增 `src/gui/src/lib/time.ts` 导出 `formatSpecUpdatedAt(value)`：秒级 / `YYYY-MM-DD` 原样返回，剥离可能的引号，未知形态原样返回；附 `src/gui/src/lib/__tests__/time.test.ts` 覆盖。
- [x] 修改 `src/gui/src/pages/Home.tsx:143` 与 `src/gui/src/pages/SpecDetail.tsx:219` 的 `<time>{spec.updated_at}</time>`：通过 `formatSpecUpdatedAt` 渲染。
- [x] 更新 `src/service/__tests__/spec-store.test.ts`：新增「同日多次写入按秒降序」「YYYY-MM-DD 与 datetime 共存排序合理」「同 updated_at 按 mtime 倒序兜底」三条；并把原 `updated_at: 2026-06-14` / `updated_at: 2026-06-16` 精确等值断言改为带秒级单引号的正则匹配；`spec-store.appends.test.ts`、`apply-question-answers.test.ts` 同步。
- [x] 检查 `spec-drafts-route.test.ts:225,252` 与 `service.test.ts:135`：这些是测试 fixture 中以旧 `YYYY-MM-DD` 写入的外部 spec，验证 service 对历史格式的读取兼容，保留不变以巩固向后兼容路径。
- [x] 跳过：`new-spec-skeleton/expect.ts` 仅校验 frontmatter 含 `updated_at` 键存在，对具体格式不敏感，无需调整。
- [x] 切两次提交：commit 1 仅含 markdown.ts + SpecDetail.tsx + markdown 单测（bug 1）；commit 2 含 spec-store、Home/SpecDetail 展示、formatter、skill 文档、所有相关测试与 fixture（bug 2）。验收：`git log --stat` 两个 commit 各自独立可回滚。

## 7. 追加任务

（暂无）

## 8. 执行记录

- 2026-06-30：完成 bug 1（markdown attachments URL 缺 projectId 段）。改动点：
  - `src/gui/src/lib/markdown.ts`：`RenderOptions` 增加 `projectId?`，`rewriteHrefIfAttachment(href, specId, projectId?)` 在缺 `projectId` 时原样返回并在 DEV 模式仅 `console.warn` 一次；`image` / `link_open` 渲染规则与 `renderMarkdown` env 透传 `projectId`。
  - `src/gui/src/pages/SpecDetail.tsx`：`renderMarkdown` 调用透传 `projectId()`（空串归 `undefined`）。
  - `src/gui/src/lib/__tests__/markdown.test.ts`：覆盖"有 pid 改写"、"缺 pid 保留原值"、"link_open 带 target=\_blank 且 rel=noopener noreferrer"、URL 编码等用例。
  - 验证：`pnpm test` 24 文件 198 用例全绿。

- 2026-06-30：完成 bug 2（`updated_at` 秒级 + 排序）。改动点：
  - `src/service/spec-store.ts`：`today()` 重命名为 `nowDateTime()` 返回 `YYYY-MM-DD HH:mm:ss`；`formatDateTime` 增加 `:ss`（追加任务 stamp 同步带秒）；5 处 frontmatter 写入路径（`create` / `applyQuestionAnswers` / `appendItem` / `appendExecutionLog` / `appendAnnotation`）改用 `nowDateTime()`；`dateString()` 添加注释明确 Date→`formatDate`、string→原样的兼容策略；新增 `formatUpdatedAtForYaml`，对含空格+`:` 的 datetime 值加单引号输出；`SpecStore.list` 排序新增 `mtime desc` 兜底。
  - `src/service/worktree-manager.ts`：冲突回退新建 spec 的 frontmatter `updated_at` 改用带秒戳形态并加单引号；执行记录文本继续使用日级，便于阅读。
  - `src/gui/src/lib/time.ts` 新增 + `__tests__/time.test.ts`：导出 `formatSpecUpdatedAt`。
  - `src/gui/src/pages/Home.tsx` & `SpecDetail.tsx`：`<time>` 改走 `formatSpecUpdatedAt`，两处一致显示到秒。
  - `src/skill/yorz-spec/conventions.md` & `new-spec.md`：`updated_at` 规范升级为带单引号的秒级形态，保留对历史 `YYYY-MM-DD` 的读取兼容。
  - 测试更新：`spec-store.test.ts` 新增 3 条排序用例并改原断言为正则；`spec-store.appends.test.ts`、`apply-question-answers.test.ts` 同步；`spec-drafts-route.test.ts`、`service.test.ts` 维持旧格式以验证向后兼容。
  - 验证：`pnpm test` 26 文件 209 用例全绿；`pnpm build` 通过。

- 2026-06-30：按 4.3 切分两次提交。
  - commit 1 `eed321c`：`fix: 修复 GUI markdown 渲染中 attachments 图片在多项目模式下 404 ...`（仅含 `src/gui/src/lib/markdown.ts`、`__tests__/markdown.test.ts`、`SpecDetail.tsx` 中 `renderMarkdown` 调用站点）。
  - commit 2（spec.md + bug 2 全部代码 / 测试 / skill 文档 / formatter 改动）。
